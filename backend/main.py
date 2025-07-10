import uuid
import asyncio  # NEW: for delayed room cleanup scheduling
from typing import Dict, List, Optional, cast, Set, Tuple

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Header, status, Depends, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from passlib.context import CryptContext
from tortoise.contrib.fastapi import register_tortoise
from .models import User
from fastapi.security import HTTPBasic, HTTPBasicCredentials
import base64

app = FastAPI()

# Allow all origins for simplicity during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Data Models ---- #

class Player(BaseModel):
    user_id: str
    name: str
    ready: bool = False
    role: Optional[str] = None  # filled after game starts

    # Aggregate wins across all games (good + evil)
    wins: int = 0

    # fields only used once game has begun
    alive: bool = True  # placeholder for potential future mechanics

class RoomConfig(BaseModel):
    merlin: bool = True
    # Assassin role has been removed – evil players now share a collective vote.
    mordred: bool = True
    # Enable Morgana & Percival by default; hosts can still disable them
    morgana: bool = True
    percival: bool = True
    oberon: bool = False
    # --- Lady of the Lake configuration --- #
    lady_enabled: bool = True  # Master toggle for the expansion rule
    # Quest numbers (1-indexed) after which Lady of the Lake occurs. Defaults to 2, 3 & 4.
    lady_after_rounds: List[int] = Field(default_factory=lambda: [2, 3, 4])

class VoteRecord(BaseModel):
    approvals: Dict[str, bool]  # user_id -> True/False

class QuestRecord(BaseModel):
    round_num: int
    team: List[str]
    votes: Dict[str, bool]
    fails: int
    success: bool

class RoomState(BaseModel):
    room_id: str
    host_id: str
    players: List[Player]
    phase: str  # "lobby" | "in_game" | "assassination" | "finished"
    quest_history: List[dict] = []  # populated once game starts
    current_leader: Optional[str] = None
    consecutive_rejections: int = 0
    config: RoomConfig
    round_number: int = 0
    good_wins: int = 0
    evil_wins: int = 0
    subphase: Optional[str] = None  # lobby|proposal|voting|quest|lady|assassination
    current_team: List[str] = []
    votes: Dict[str, bool] = {}
    winner: Optional[str] = None  # "good" | "evil"
    submissions: Dict[str, str] = {}
    proposal_leader: Optional[str] = None  # user id of who proposed current team
    # Leader for each quest (index 0-4). Value is player name or None if not yet determined/predicted.
    round_leaders: List[Optional[str]] = []
    # Candidates remaining in the current assassination voting round (player IDs of GOOD team)
    assassin_candidates: List[str] = []
    # List of player names that belong to the evil team. Populated only during the assassination phase so that all clients can see who the evil players are.
    evil_players: List[str] = []
    # Map of evil player user_id -> voted target user_id (only visible to clients for pending vote tracking)
    assassin_votes: Dict[str, str] = {}
    # --- Lady of the Lake runtime fields --- #
    lady_holder: Optional[str] = None  # user_id of current token holder
    lady_history: List[str] = []  # all user_ids that have ever held the token
    lady_after_rounds: List[int] = []  # convenience copy from config for clients


# ---- In-memory stores ---- #
rooms: Dict[str, "Room"] = {}

# ---- Global lobby websocket connections ---- #
# Map WebSocket -> optional user_id (None if unauthenticated)
lobby_connections: Dict[WebSocket, Optional[str]] = {}


# ---- Helper objects ---- #
class Room:
    """Encapsulates runtime state and active websocket connections for a room."""

    def __init__(self, room_id: str, host_player: Player, password: Optional[str] = None):
        self.room_id = room_id
        self.host_id = host_player.user_id
        self.players: Dict[str, Player] = {host_player.user_id: host_player}
        self.config = RoomConfig()  # default config
        self.phase = "lobby"
        self.quest_history: List[dict] = []
        self.current_leader: Optional[str] = None
        self.consecutive_rejections: int = 0
        # active websocket connections: user_id -> websocket
        self.connections: Dict[str, WebSocket] = {}
        # Game progression fields
        self.round_number: int = 0
        self.good_wins: int = 0
        self.evil_wins: int = 0
        self.subphase: Optional[str] = None
        self.current_team: List[str] = []
        self.votes: Dict[str, bool] = {}
        self.winner: Optional[str] = None
        self.submissions: Dict[str, str] = {}
        self.proposal_leader: Optional[str] = None
        # Assassination phase voting data
        self.assassin_candidates: List[str] = []  # remaining possible Merlin candidates (player IDs)
        self.assassin_votes: Dict[str, str] = {}  # evil player id -> voted target id
        # Flag to ensure we only write stats once per finished game
        self.stats_recorded: bool = False
        # Optional lobby password (plain-text for now; could be hashed in future)
        self.password: Optional[str] = password

        # --- Lady of the Lake runtime state --- #
        self.lady_holder: Optional[str] = None  # user_id of the player currently holding the token
        self.lady_history: List[str] = []  # track all previous holders to enforce uniqueness

        # Track temporarily disconnected players (only relevant once game has started)
        self.disconnected_players: Set[str] = set()

        # Task created when the room becomes empty; used to prune after a delay
        self.cleanup_task: Optional[asyncio.Task] = None  # NEW

    # helper to check password validity
    def check_password(self, password_attempt: Optional[str]) -> bool:
        if self.password is None:
            return True  # public lobby
        if password_attempt is None:
            return False
        return self.password == password_attempt

    # ---- Player management ---- #
    def add_player(self, player: Player):
        if self.phase != "lobby":
            raise HTTPException(status_code=400, detail="Game already started")
        self.players[player.user_id] = player

    def remove_player(self, user_id: str):
        self.players.pop(user_id, None)
        self.connections.pop(user_id, None)
        # Transfer host if host leaves
        if user_id == self.host_id and self.players:
            self.host_id = next(iter(self.players))

    def all_ready(self) -> bool:
        return all(p.ready for p in self.players.values()) and len(self.players) >= 5

    # NEW: helper to compute leaders for each quest round (names) at the current moment
    def _compute_round_leaders(self) -> List[Optional[str]]:
        # Always return a 5-element list of leader names (or None) for quests 1-5
        if not self.players:
            return [None] * 5

        order: List[str] = list(self.players.keys())
        name_map: Dict[str, str] = {pid: p.name for pid, p in self.players.items()}

        leaders: List[Optional[str]] = [None] * 5

        # Fill in leaders for completed quests from history (these are authoritative)
        for rec in self.quest_history:
            rnd = rec.get("round")
            if isinstance(rnd, int) and 1 <= rnd <= 5:
                leaders[rnd - 1] = rec.get("leader")

        # Current round leader (proposal/voting/quest phase)
        if self.round_number and 1 <= self.round_number <= 5 and self.current_leader:
            leaders[self.round_number - 1] = name_map.get(self.current_leader)

        # Predict leaders for future rounds assuming default clockwise rotation
        if self.current_leader in order:
            idx = order.index(self.current_leader)
        else:
            idx = 0
        current_idx = self.round_number - 1 if self.round_number else 0
        for offset in range(current_idx + 1, 5):
            steps_ahead = offset - current_idx
            future_pid = order[(idx + steps_ahead) % len(order)]
            leaders[offset] = name_map.get(future_pid)

        return leaders

    # ---- Broadcasting ---- #
    async def broadcast_state(self):
        """Send entire room state snapshot to all connected clients."""
        # Compute visible evil player list for assassination phase (now includes Oberon by name)
        evil_players: List[str] = []
        if self.phase == "assassination":
            for p in self.players.values():
                if p.role in EVIL_ROLES:
                    evil_players.append(p.name)

        # Personalise the state so that only the recipient sees their own role until the game is over.
        for uid, ws in list(self.connections.items()):
            players_view: List[Player] = []
            for p in self.players.values():
                # Deep-copy to avoid mutating the canonical Player objects
                p_copy: Player = p.copy(deep=True)
                if self.phase != "finished" and p.user_id != uid:
                    # Hide everyone else's role while the game is still in progress
                    p_copy.role = None
                players_view.append(p_copy)

            state_payload = RoomState(
                room_id=self.room_id,
                host_id=self.host_id,
                players=players_view,
                phase=self.phase,
                quest_history=self.quest_history,
                current_leader=self.current_leader,
                consecutive_rejections=self.consecutive_rejections,
                config=self.config,
                round_number=self.round_number,
                good_wins=self.good_wins,
                evil_wins=self.evil_wins,
                subphase=self.subphase,
                current_team=self.current_team,
                votes=self.votes,
                winner=self.winner,
                submissions=self.submissions,
                proposal_leader=self.proposal_leader,
                round_leaders=self._compute_round_leaders(),
                assassin_candidates=self.assassin_candidates,
                evil_players=evil_players,
                assassin_votes=self.assassin_votes,
                lady_holder=self.lady_holder,
                lady_history=self.lady_history,
                lady_after_rounds=self.config.lady_after_rounds,
            ).model_dump()

            await ws.send_json({"type": "state", "data": state_payload})

    async def broadcast(self, payload: dict):
        for ws in list(self.connections.values()):
            await ws.send_json(payload)


# ---- REST Endpoints ---- #

# Response returned after creating or joining a room
class RoomResponse(BaseModel):
    room_id: str
    user_id: str


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return pwd_context.verify(password, hashed)


class SignupRequest(BaseModel):
    username: str
    password: str
    display_name: str


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    user_id: str
    display_name: str


# ---- Profile & Stats Models ---- #

class ProfileResponse(BaseModel):
    user_id: str
    username: str
    display_name: str
    total_games: int
    good_wins: int
    good_losses: int
    evil_wins: int
    evil_losses: int
    role_stats: Dict[str, Dict[str, int]]


class UpdateProfileRequest(BaseModel):
    username: Optional[str] = None
    display_name: Optional[str] = None


class LeaderboardEntry(BaseModel):
    """Slim representation of a player for leaderboard listings."""
    user_id: str
    username: str
    display_name: str
    wins: int
    total_games: int
    good_wins: int
    evil_wins: int


security = HTTPBasic()

async def get_current_user(credentials: HTTPBasicCredentials = Depends(security)) -> User:
    """Validate Basic-Auth credentials and return the corresponding User object."""
    user = await User.filter(username=credentials.username).first()
    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return user


@app.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def signup(req: SignupRequest):
    existing = await User.filter(username=req.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")
    user = await User.create(
        username=req.username,
        password_hash=hash_password(req.password),
        display_name=req.display_name,
    )
    return AuthResponse(user_id=str(user.id), display_name=user.display_name)


@app.post("/login", response_model=AuthResponse)
async def login(req: LoginRequest):
    """Plain login endpoint – returns the user's id & display name when credentials are valid.
    Clients should subsequently use HTTP Basic Auth for all other requests."""
    user = await User.filter(username=req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return AuthResponse(user_id=str(user.id), display_name=user.display_name)


@app.get("/profile", response_model=ProfileResponse)
async def get_profile(current_user: User = Depends(get_current_user)):
    """Return the authenticated user's profile and accumulated statistics."""
    return ProfileResponse(
        user_id=str(current_user.id),
        username=current_user.username,
        display_name=current_user.display_name,
        total_games=current_user.total_games,
        good_wins=current_user.good_wins,
        good_losses=current_user.good_losses,
        evil_wins=current_user.evil_wins,
        evil_losses=current_user.evil_losses,
        role_stats=cast(Dict[str, Dict[str, int]], current_user.role_stats or {}),
    )


@app.put("/profile", response_model=ProfileResponse)
async def update_profile(req: UpdateProfileRequest, current_user: User = Depends(get_current_user)):
    """Allow a user to update their username and/or display name."""
    # Update username if requested
    if req.username and req.username != current_user.username:
        existing = await User.filter(username=req.username).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already taken")
        current_user.username = req.username

    # Update display name if provided
    if req.display_name:
        current_user.display_name = req.display_name

    await current_user.save()

    # --- Propagate updated display name to all active rooms --- #
    # If the user is currently present in any in-memory room instances, update the
    # cached Player.name field so that other clients immediately see the change.
    # We then broadcast an updated state snapshot for each affected room and also
    # refresh the global lobby listing in case the user is a host.
    for room in rooms.values():
        if str(current_user.id) in room.players:
            # Update the name stored in the Player object
            room.players[str(current_user.id)].name = current_user.display_name
            # If this player is the current leader/proposal leader/etc., no extra
            # handling is needed because broadcast_state recomputes labels based
            # on the Player objects.
            await room.broadcast_state()

    # Push updated lobby summaries (host name may have changed)
    await broadcast_lobbies()

    return ProfileResponse(
        user_id=str(current_user.id),
        username=current_user.username,
        display_name=current_user.display_name,
        total_games=current_user.total_games,
        good_wins=current_user.good_wins,
        good_losses=current_user.good_losses,
        evil_wins=current_user.evil_wins,
        evil_losses=current_user.evil_losses,
        role_stats=cast(Dict[str, Dict[str, int]], current_user.role_stats or {}),
    )


@app.get("/profile/{username}", response_model=ProfileResponse)
async def get_profile_by_username(username: str, current_user: User = Depends(get_current_user)):
    """Retrieve another player's public statistics by username."""
    user = await User.filter(username=username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return ProfileResponse(
        user_id=str(user.id),
        username=user.username,
        display_name=user.display_name,
        total_games=user.total_games,
        good_wins=user.good_wins,
        good_losses=user.good_losses,
        evil_wins=user.evil_wins,
        evil_losses=user.evil_losses,
        role_stats=cast(Dict[str, Dict[str, int]], user.role_stats or {}),
    )


@app.get("/leaderboard", response_model=List[LeaderboardEntry])
async def get_leaderboard(limit: int = 20, current_user: User = Depends(get_current_user)):
    """Return the top players ordered by total wins (good + evil)."""
    users = await User.all()
    entries = [
        LeaderboardEntry(
            user_id=str(u.id),
            username=u.username,
            display_name=u.display_name,
            wins=u.good_wins + u.evil_wins,
            total_games=u.total_games,
            good_wins=u.good_wins,
            evil_wins=u.evil_wins,
        )
        for u in users
    ]
    entries.sort(key=lambda e: e.wins, reverse=True)
    return entries[:limit]


# Request/response models for lobby password feature & listing
class CreateRoomRequest(BaseModel):
    password: Optional[str] = None

class JoinRoomRequest(BaseModel):
    password: Optional[str] = None

class LobbySummary(BaseModel):
    room_id: str
    host_id: str
    host_name: str
    player_count: int
    requires_password: bool
    member: bool = False
    phase: str = "lobby"


# Helper to build lobby summaries (same data shape as /rooms endpoint)
def _collect_lobby_summaries() -> List[LobbySummary]:
    summaries: List[LobbySummary] = []
    for rid, room in rooms.items():
        if room.phase != "lobby":
            continue
        host_player = room.players.get(room.host_id)
        summaries.append(
            LobbySummary(
                room_id=rid,
                host_id=room.host_id,
                host_name=host_player.name if host_player else "Unknown",
                player_count=len(room.players),
                requires_password=room.password is not None,
                member=False,
                phase="lobby",
            )
        )
    return summaries


async def broadcast_lobbies():
    """Push the current lobby list to all listeners."""
    if not lobby_connections:
        return

    # Build personalised payloads per connection (so each user sees their own in-progress games)
    for ws, uid in list(lobby_connections.items()):
        try:
            data: List[LobbySummary] = []
            for rid, room in rooms.items():
                is_member = uid in room.players if uid else False
                if room.phase == "lobby" or is_member:
                    host_player = room.players.get(room.host_id)
                    data.append(
                        LobbySummary(
                            room_id=rid,
                            host_id=room.host_id,
                            host_name=host_player.name if host_player else "Unknown",
                            player_count=len(room.players),
                            requires_password=room.password is not None,
                            member=is_member,
                            phase=room.phase,
                        )
                    )
            await ws.send_json({"type": "lobbies", "data": [s.model_dump() for s in data]})
        except Exception:
            lobby_connections.pop(ws, None)


@app.websocket("/lobbies_ws")
async def lobbies_ws_endpoint(ws: WebSocket, auth: Optional[str] = Query(default=None)):
    """WebSocket that streams lobby list updates in real-time.
    Optionally accepts ?auth=<base64(username:password)> to personalise results."""
    await ws.accept()

    user_id: Optional[str] = None
    if auth:
        try:
            decoded = base64.b64decode(auth).decode()
            username, password = decoded.split(":", 1)
            user = await User.filter(username=username).first()
            if user and verify_password(password, user.password_hash):
                user_id = str(user.id)
        except Exception:
            user_id = None

    lobby_connections[ws] = user_id

    # Send initial personalised snapshot
    await broadcast_lobbies()

    try:
        while True:
            # We don't expect messages from the client; just keep connection alive.
            await ws.receive_text()
    except WebSocketDisconnect:
        lobby_connections.pop(ws, None)
    except Exception:
        lobby_connections.pop(ws, None)


@app.post("/rooms", response_model=RoomResponse)
async def create_room(req: CreateRoomRequest = Body(default=CreateRoomRequest()), current_user: User = Depends(get_current_user)):
    # Prevent a user from spawning multiple lobbies at once – they must reuse or finish the existing one first.
    for existing in rooms.values():
        if existing.host_id == str(current_user.id) and existing.phase == "lobby":
            raise HTTPException(status_code=400, detail="You already have an active lobby – reconnect to it instead.")

    room_id = str(uuid.uuid4())
    host_player = Player(
        user_id=str(current_user.id),
        name=current_user.display_name,
        wins=current_user.good_wins + current_user.evil_wins,
    )
    room = Room(room_id, host_player, password=req.password)
    rooms[room_id] = room
    # Broadcast new lobby list to all listeners
    await broadcast_lobbies()
    return RoomResponse(room_id=room_id, user_id=str(current_user.id))


@app.post("/rooms/{room_id}/join", response_model=RoomResponse)
async def join_room(room_id: str, req: JoinRoomRequest = Body(default=JoinRoomRequest()), current_user: User = Depends(get_current_user)):
    room = rooms.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    user_id = str(current_user.id)
    # If already present (re-join)
    if user_id in room.players:
        return RoomResponse(room_id=room_id, user_id=user_id)
    # Password validation (skip for host)
    if user_id != room.host_id:
        if not room.check_password(req.password):
            raise HTTPException(status_code=403, detail="Incorrect or missing room password")
    player = Player(
        user_id=user_id,
        name=current_user.display_name,
        wins=current_user.good_wins + current_user.evil_wins,
    )
    room.add_player(player)
    await room.broadcast_state()
    return RoomResponse(room_id=room_id, user_id=user_id)


@app.get("/self")
async def get_self(room_id: str, current_user: User = Depends(get_current_user)):
    room = rooms.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    player = room.players.get(str(current_user.id))
    if not player:
        raise HTTPException(status_code=404, detail="User not in room")
    return {"role": player.role, "config": room.config.model_dump()}


# ---- WebSocket (auth via ?auth=<base64(username:password)>) ---- #

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(ws: WebSocket, room_id: str, auth: Optional[str] = Query(None)):
    await ws.accept()

    # ---- Authenticate via query-string Basic token ---- #
    if not auth:
        await ws.close(code=4000)
        return
    try:
        decoded = base64.b64decode(auth).decode()
        username, password = decoded.split(":", 1)
    except Exception:
        await ws.close(code=4000)
        return

    user = await User.filter(username=username).first()
    if not user or not verify_password(password, user.password_hash):
        await ws.close(code=4001)
        return

    user_id = str(user.id)

    room = rooms.get(room_id)
    if not room or user_id not in room.players:
        await ws.close(code=4002)
        return

    # Kick any existing connection from same user
    prev = room.connections.get(user_id)
    if prev is not None:
        try:
            await prev.send_json({"type": "kicked", "reason": "Logged in elsewhere"})
            await prev.close(code=4003)
        except Exception:
            pass

    room.connections[user_id] = ws

    # Handle reconnection – if previously marked disconnected, remove and notify others
    if user_id in room.disconnected_players:
        room.disconnected_players.discard(user_id)
        await room.broadcast({
            "type": "pause",
            "players": [room.players[pid].name for pid in room.disconnected_players],
        })

    # Send initial state
    await room.broadcast_state()

    # Send role-specific info (covers reconnect scenarios)
    await send_private_info(room, user_id)

    # --- If a cleanup task was scheduled because the room became empty, cancel it on reconnect --- #
    if getattr(room, "cleanup_task", None) and not room.cleanup_task.done(): # type: ignore[reportOptionalMemberAccess]
        room.cleanup_task.cancel() # type: ignore[reportOptionalMemberAccess]
        room.cleanup_task = None

    try:
        while True:
            data = await ws.receive_json()
            await handle_ws_message(room, user_id, data)
    except WebSocketDisconnect:
        room.connections.pop(user_id, None)
        player = room.players.get(user_id)
        if player is not None and room.phase == "lobby":
            player.ready = False

        # Mark as disconnected during active game and broadcast pause info
        if room.phase != "lobby":
            room.disconnected_players.add(user_id)
            await room.broadcast({
                "type": "pause",
                "players": [room.players[pid].name for pid in room.disconnected_players],
            })

        await room.broadcast_state()
        # --- Auto-delete empty lobbies (no active websocket connections) ---
        if not room.connections:
            # Existing behaviour: immediately remove empty lobbies
            if room.phase == "lobby":
                rooms.pop(room.room_id, None)
                await broadcast_lobbies()
                return

            # For in-game (or finished) rooms, schedule a delayed cleanup to allow brief reconnections
            if room.cleanup_task is None or room.cleanup_task.done():
                async def _prune_after_delay(rid: str, delay: int = 300):
                    try:
                        await asyncio.sleep(delay)
                        room_ref = rooms.get(rid)
                        if room_ref and not room_ref.connections:
                            rooms.pop(rid, None)
                            await broadcast_lobbies()
                    except asyncio.CancelledError:
                        # Cleanup was cancelled due to player reconnection
                        pass

                room.cleanup_task = asyncio.create_task(_prune_after_delay(room.room_id))
    except Exception as e:
        print("WebSocket error", e)
        room.connections.pop(user_id, None)


# ---- Game & Lobby Logic ---- #
async def handle_ws_message(room: Room, user_id: str, data: dict):
    msg_type = data.get("type")
    if msg_type == "toggle_ready":
        player = room.players.get(user_id)
        if player is None:
            return
        player.ready = not player.ready
        await room.broadcast_state()
    elif msg_type == "kick":
        target_id = str(data.get("target")) if data.get("target") else ""
        if user_id != room.host_id:
            return  # ignore unauthorized
        if target_id == user_id:
            return
        # notify target first
        target_ws = room.connections.get(target_id)
        if target_ws:
            await target_ws.send_json({"type": "kicked", "target": target_id})
            await target_ws.close(code=4002)
        # now remove player
        room.remove_player(target_id)
        await room.broadcast({"type": "kicked", "target": target_id})
        await room.broadcast_state()
    elif msg_type == "start_game":
        if user_id != room.host_id or not room.all_ready():
            return
        await start_game(room)
        await room.broadcast_state()
    elif msg_type == "propose_team":
        await handle_propose_team(room, user_id, data)
    elif msg_type == "vote_team":
        await handle_vote_team(room, user_id, data)
    elif msg_type == "submit_card":
        await handle_submit_card(room, user_id, data)
    elif msg_type == "assassin_guess":
        # Legacy support – treat as a direct vote from an evil player
        await handle_assassination_vote(room, user_id, {"target": data.get("target")})
    elif msg_type == "assassination_vote":
        await handle_assassination_vote(room, user_id, data)
    elif msg_type == "set_config":
        await handle_set_config(room, user_id, data)
    elif msg_type == "restart_game":
        await handle_restart_game(room, user_id)
        await room.broadcast_state()
    elif msg_type == "reset_lobby":
        await handle_reset_lobby(room, user_id)
        await room.broadcast_state()
    elif msg_type == "lady_choose":
        await handle_lady_choose(room, user_id, data)
    else:
        # TODO: handle in-game messages (team proposals, votes, etc.)
        pass


# ---- Game Setup ---- #
async def start_game(room: Room):
    """Assign roles and initialize first leader, round state."""
    room.phase = "in_game"
    # Determine roles list based on config and player count
    roles = build_role_deck(len(room.players), room.config)
    shuffled_players = list(room.players.values())
    import random

    random.shuffle(shuffled_players)
    for player, role in zip(shuffled_players, roles):
        player.role = role

    # Night phase info distribution
    await distribute_initial_info(room)

    # Pick first leader (first in shuffled order for simplicity)
    room.current_leader = shuffled_players[0].user_id

    # Assign Lady of the Lake token (if enabled) – goes to the player to the right
    if room.config.lady_enabled:
        room.lady_holder = shuffled_players[-1].user_id  # player to the right (counter-clockwise)
        room.lady_history = [room.lady_holder]

    # Init quest data
    room.round_number = 1
    room.good_wins = 0
    room.evil_wins = 0
    room.subphase = "proposal"
    room.current_team = []
    room.votes = {}
    room.quest_history = []
    room.consecutive_rejections = 0
    # Notify lobby listeners that this room is no longer in the lobby list
    await broadcast_lobbies()


async def distribute_initial_info(room: Room):
    """Send private info to players according to roles."""
    # Evil players that know each other (exclude Oberon)
    evil_players = [p for p in room.players.values() if p.role in {"Mordred", "Morgana", "Minion of Mordred"}]
    evil_names = [p.name for p in evil_players]

    # Merlin sees ALL evil EXCEPT Mordred and Oberon
    merlin_visible_names = [p.name for p in room.players.values() if p.role in EVIL_ROLES and p.role not in {"Mordred", "Oberon"}]

    merlin_ids = [p.user_id for p in room.players.values() if p.role == "Merlin"]
    for mid in merlin_ids:
        ws = room.connections.get(mid)
        if ws:
            await ws.send_json({"type": "info", "merlin_knows": merlin_visible_names})

    # Evil players (except Oberon) see each other – key: "evil"
    for eid in [p.user_id for p in evil_players]:
        player_role = room.players[eid].role
        if player_role == "Oberon":
            continue
        ws = room.connections.get(eid)
        if ws:
            await ws.send_json({"type": "info", "evil": evil_names})

    # Percival sees Merlin and Morgana – key: "percival_knows"
    percival_ids = [p.user_id for p in room.players.values() if p.role == "Percival"]
    merlin_like_names = [p.name for p in room.players.values() if p.role in {"Merlin", "Morgana"}]
    for pid in percival_ids:
        ws = room.connections.get(pid)
        if ws:
            await ws.send_json({"type": "info", "percival_knows": merlin_like_names})


# ---- Reconnection private info helper ---- #
async def send_private_info(room: Room, user_id: str):
    """Send role-specific private information to a single player (used on reconnect)."""
    player = room.players.get(user_id)
    if not player or player.role is None:
        return  # nothing to send yet

    ws = room.connections.get(user_id)
    if ws is None:
        return

    evil_players = [p for p in room.players.values() if p.role in {"Mordred", "Morgana", "Minion of Mordred"}]
    evil_names = [p.name for p in evil_players]
    # Recompute Merlin's visible evil players (excludes Mordred & Oberon)
    merlin_visible_names = [p.name for p in room.players.values() if p.role in EVIL_ROLES and p.role not in {"Mordred", "Oberon"}]

    payload: Dict[str, List[str]] = {}

    if player.role == "Merlin":
        payload["merlin_knows"] = merlin_visible_names
    if player.role == "Percival":
        merlin_like_names = [p.name for p in room.players.values() if p.role in {"Merlin", "Morgana"}]
        payload["percival_knows"] = merlin_like_names
    if player.role in {"Mordred", "Morgana", "Minion of Mordred"}:
        payload["evil"] = evil_names

    if payload:
        await ws.send_json({"type": "info", **payload})


# ---- Role Logic ---- #

def build_role_deck(num_players: int, config: RoomConfig) -> List[str]:
    """Generate a shuffled list of roles according to player count and lobby config.

    The evil side must make up roughly one-third of the table (at least 33 %).
    We always include *Mordred* so that there is at least one evil player hidden from Merlin.
    Any optional evil roles (Morgana, Oberon) are added when toggled by the host (and
    player count ≥ 7 as enforced elsewhere). After that we pad with generic *Minion of
    Mordred* roles until we reach the required evil quota. Good roles are then filled
    the rest of the way, always containing Merlin (and Percival when Morgana is
    enabled).
    """

    from math import ceil

    # Minimum number of evil players so that evil ≥ 33 % of the table (can be a bit above)
    num_evil_required = max(2, ceil(num_players / 3))

    # Mandatory evil roles
    evil_roles: List[str] = ["Mordred"]

    # Queue optional evil roles based on config
    if config.morgana:
        evil_roles.append("Morgana")
    if config.oberon:
        evil_roles.append("Oberon")

    # Pad remaining evil slots with generic minions
    remaining_evil = num_evil_required - len(evil_roles)
    if remaining_evil > 0:
        evil_roles.extend(["Minion of Mordred"] * remaining_evil)

    # Good roles – Merlin is mandatory. Percival only makes sense when Morgana is in play.
    good_roles: List[str] = ["Merlin"]
    if config.percival:
        good_roles.append("Percival")

    # Fill the table with generic loyal servants
    remaining_good = num_players - (len(good_roles) + len(evil_roles))
    good_roles.extend(["Loyal Servant of Arthur"] * remaining_good)

    roles = good_roles + evil_roles
    import random
    random.shuffle(roles)
    return roles


# ---- Statistics recording helpers ---- #

GOOD_ROLES = {"Merlin", "Percival", "Loyal Servant of Arthur"}
EVIL_ROLES = {"Mordred", "Morgana", "Oberon", "Minion of Mordred"}


async def _update_player_stats(user_id: str, role: str | None, winner: str):
    """Update a single user's aggregated statistics after a game concludes."""
    if role is None:
        # Should not happen, but guard against missing role assignments.
        return

    user = await User.filter(id=user_id).first()
    if user is None:
        return

    # Increment total games counter
    user.total_games += 1

    side = "good" if role in GOOD_ROLES else "evil"
    is_win = winner == side

    # Team-based stats
    if side == "good":
        if is_win:
            user.good_wins += 1
        else:
            user.good_losses += 1
    else:
        if is_win:
            user.evil_wins += 1
        else:
            user.evil_losses += 1

    # Ensure we work with a dictionary – JSONField can technically store any JSON type.
    stats_dict: Dict[str, Dict[str, int]]
    if isinstance(user.role_stats, dict):
        stats_dict = cast(Dict[str, Dict[str, int]], user.role_stats)
    else:
        stats_dict = {}

    role_entry = stats_dict.get(role, {"wins": 0, "losses": 0})
    if is_win:
        role_entry["wins"] += 1
    else:
        role_entry["losses"] += 1
    stats_dict[role] = role_entry
    user.role_stats = stats_dict

    await user.save()


async def record_game_stats(room: Room):
    """Persist aggregated stats for all players in a room once per finished game."""
    if getattr(room, "stats_recorded", False):
        return

    if room.phase != "finished" or not room.winner:
        return

    # Update every player sequentially (SQLite can't handle too many concurrent writes).
    for player in room.players.values():
        await _update_player_stats(player.user_id, player.role, room.winner)
        # Refresh in-memory wins counter so lobby UI sees updated value without reload
        user_obj = await User.filter(id=player.user_id).first()
        if user_obj:
            player.wins = user_obj.good_wins + user_obj.evil_wins

    room.stats_recorded = True


# ---- Quest configuration helper ---- #
QUEST_SIZES = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5],
}


def next_leader(room: Room):
    """Rotate leader to next player clockwise based on players list order."""
    order = list(room.players.keys())
    if room.current_leader not in order:
        room.current_leader = order[0]
        return
    idx = order.index(room.current_leader)
    room.current_leader = order[(idx + 1) % len(order)]


def majority_approved(votes: Dict[str, bool]) -> bool:
    approves = sum(1 for v in votes.values() if v)
    return approves > (len(votes) / 2)


def quest_requires_two_fails(room: Room) -> bool:
    """Return True if current quest (#4 in 7+ player) needs 2 fails"""
    if len(room.players) < 7:
        return False
    return room.round_number == 4


async def handle_propose_team(room: Room, user_id: str, data: dict):
    if room.subphase != "proposal" or room.current_leader != user_id:
        return
    team: List[str] = data.get("team", [])
    required = QUEST_SIZES[len(room.players)][room.round_number - 1]
    # validate
    if len(team) != required or not all(p in room.players for p in team):
        return
    room.current_team = team
    room.proposal_leader = user_id
    room.subphase = "voting"
    room.votes = {}
    await room.broadcast_state()


async def handle_vote_team(room: Room, user_id: str, data: dict):
    if room.subphase != "voting":
        return
    approve = bool(data.get("approve"))
    room.votes[user_id] = approve
    # once all votes in
    if len(room.votes) == len(room.players):
        approved = majority_approved(room.votes)
        if approved:
            room.subphase = "quest"
            room.consecutive_rejections = 0
        else:
            room.consecutive_rejections += 1
            if room.consecutive_rejections >= 5:
                room.phase = "finished"
                room.winner = "evil"
                await record_game_stats(room)
            else:
                next_leader(room)
                room.subphase = "proposal"
        await room.broadcast_state()
    else:
        await room.broadcast_state()


async def handle_submit_card(room: Room, user_id: str, data: dict):
    if room.subphase != "quest" or user_id not in room.current_team:
        return
    card = data.get("card")  # "S" or "F"
    if card not in {"S", "F"}:
        return
    # enforce good must play Success
    player_role = room.players[user_id].role
    if player_role in {"Merlin", "Percival", "Loyal Servant of Arthur"} and card == "F":
        return
    room.submissions = getattr(room, "submissions", {})
    room.submissions[user_id] = card
    if len(room.submissions) == len(room.current_team):
        # compute result
        import random

        fail_count = list(room.submissions.values()).count("F")
        required_fails = 2 if quest_requires_two_fails(room) else 1
        success = fail_count < required_fails
        # update scores
        if success:
            room.good_wins += 1
        else:
            room.evil_wins += 1
        # Prepare history record (will set next_leader later if game continues)
        history_entry = {
            "round": room.round_number,
            "team": [room.players[p].name for p in room.current_team],
            "votes": {room.players[pid].name: v for pid, v in room.votes.items()},
            "fails": fail_count,
            "success": success,
            "proposer": room.players[room.proposal_leader].name if room.proposal_leader else None,
            "leader": room.players[room.current_leader].name if room.current_leader else None,
            "next_leader": None,
        }
        # clear temp data
        room.submissions = {}
        room.current_team = []
        room.votes = {}
        room.proposal_leader = None

        # check victory conditions
        if room.good_wins >= 3:
            room.phase = "assassination"
            room.subphase = "assassination"
            # Initialize assassination voting
            room.assassin_candidates = [pid for pid, pl in room.players.items() if pl.role in GOOD_ROLES]
            room.assassin_votes = {}
        elif room.evil_wins >= 3:
            room.phase = "finished"
            room.winner = "evil"
            await record_game_stats(room)
        else:
            # next round (but Lady of the Lake may interject before proposals)
            current_round_completed = room.round_number  # capture before incrementing

            room.round_number += 1
            next_leader(room)
            history_entry["next_leader"] = room.players[room.current_leader].name if room.current_leader else None

            # Determine if Lady of the Lake action should occur now
            if (
                room.config.lady_enabled
                and current_round_completed in room.config.lady_after_rounds
                and room.lady_holder is not None
            ):
                room.subphase = "lady"
            else:
                room.subphase = "proposal"

        # append record only after next leader computed (if applicable)
        room.quest_history.append(history_entry)
        await room.broadcast({"type": "quest_result", "data": history_entry})
        await room.broadcast_state()
    else:
        await room.broadcast_state()


async def handle_assassination_vote(room: Room, user_id: str, data: dict):
    """Collect votes from all evil players to identify Merlin.

    Voting continues until a single candidate receives the most votes (no tie).
    """
    if room.phase != "assassination":
        return

    voter_role = room.players[user_id].role
    if voter_role not in EVIL_ROLES:
        # Only evil players participate in the assassination vote
        return

    target = data.get("target")
    if target not in room.assassin_candidates:
        # Invalid target (either not good or not in current candidate pool)
        return

    room.assassin_votes[user_id] = target

    # Check if all eligible evil players have voted
    evil_player_ids = [pid for pid, p in room.players.items() if p.role in EVIL_ROLES]
    if len(room.assassin_votes) < len(evil_player_ids):
        await room.broadcast_state()
        return  # still waiting for remaining votes

    # Tally votes
    from collections import Counter

    counts = Counter(room.assassin_votes.values())
    max_votes = max(counts.values())
    top_ids = [pid for pid, cnt in counts.items() if cnt == max_votes]

    if len(top_ids) == 1:
        # Final decision reached
        chosen_id = top_ids[0]
        if room.players[chosen_id].role == "Merlin":
            room.winner = "evil"
        else:
            room.winner = "good"
        room.phase = "finished"
        await record_game_stats(room)
        await room.broadcast_state()
    else:
        # Tie – narrow candidate pool and restart voting
        room.assassin_candidates = top_ids
        room.assassin_votes = {}
        # Inform players of tie so UI can prompt a re-vote
        await room.broadcast({
            "type": "assassination_tie",
            "candidates": [room.players[pid].name for pid in top_ids],
        })
        await room.broadcast_state()


# ---- Config handling ---- #
async def handle_set_config(room: Room, user_id: str, data: dict):
    """Allow host to toggle role options in lobby."""
    if room.phase != "lobby" or user_id != room.host_id:
        return
    morgana = bool(data.get("morgana", room.config.morgana))
    percival = bool(data.get("percival", room.config.percival))
    oberon = bool(data.get("oberon", room.config.oberon))

    # Oberon still requires 7+ players; Morgana & Percival are always allowed
    if len(room.players) < 7:
        oberon = False

    # enforce Morgana & Percival paired
    if morgana != percival:
        morgana = percival = morgana or percival

    room.config.morgana = morgana
    room.config.percival = percival
    room.config.oberon = oberon

    lady_enabled = bool(data.get("lady_enabled", room.config.lady_enabled))
    lady_after_rounds_in = data.get("lady_after_rounds")
    if isinstance(lady_after_rounds_in, list) and all(isinstance(r, int) for r in lady_after_rounds_in):
        # ensure values between 2 and 4 if provided
        lady_rounds = [r for r in lady_after_rounds_in if 1 <= r <= 5]
        if lady_rounds:
            room.config.lady_after_rounds = sorted(set(lady_rounds))

    room.config.lady_enabled = lady_enabled

    await room.broadcast_state()


async def handle_restart_game(room: Room, user_id: str):
    """Reset room to lobby so players can play again."""
    if room.phase != "finished" or user_id != room.host_id:
        return
    # reset players ready flags
    for p in room.players.values():
        p.ready = False
        p.role = None
    room.phase = "lobby"
    room.quest_history = []
    room.round_number = 0
    room.good_wins = 0
    room.evil_wins = 0
    room.subphase = None
    room.current_team = []
    room.votes = {}
    room.winner = None
    room.current_leader = None
    room.proposal_leader = None
    room.consecutive_rejections = 0
    room.stats_recorded = False
    room.assassin_candidates = []
    room.assassin_votes = {}
    # Reset Lady of the Lake data
    room.lady_holder = None
    room.lady_history = []
    await room.broadcast_state()
    # Room has returned to lobby phase – update listing
    await broadcast_lobbies()


async def handle_reset_lobby(room: Room, user_id: str):
    """Force-reset the room back to lobby regardless of current phase (host only)."""
    if user_id != room.host_id:
        return

    # Reset per-player fields – everyone becomes not ready
    for p in room.players.values():
        p.ready = False

    # Reset room-wide state
    room.phase = "lobby"
    room.quest_history = []
    room.round_number = 0
    room.good_wins = 0
    room.evil_wins = 0
    room.subphase = None
    room.current_team = []
    room.votes = {}
    room.winner = None
    room.current_leader = None
    room.proposal_leader = None
    room.consecutive_rejections = 0
    room.stats_recorded = False
    room.assassin_candidates = []
    room.assassin_votes = {}
    # Reset Lady of the Lake data
    room.lady_holder = None
    room.lady_history = []

    # Broadcast updated lobby state and update listing
    await room.broadcast_state()
    await broadcast_lobbies()


# ---- Lady of the Lake handling ---- #
async def handle_lady_choose(room: Room, user_id: str, data: dict):
    """Process the Lady of the Lake choice from the current token holder."""
    if room.subphase != "lady" or room.lady_holder != user_id:
        return

    target_id = str(data.get("target")) if data.get("target") else ""

    # Basic validations
    if (
        target_id not in room.players
        or target_id == user_id
        or target_id in room.lady_history  # cannot choose someone who held the token before
    ):
        return

    # Reveal loyalty privately to the Lady holder
    target_role = room.players[target_id].role or ""
    loyalty = "good" if target_role in GOOD_ROLES else "evil"
    ws = room.connections.get(user_id)
    if ws:
        await ws.send_json({
            "type": "lady_result",
            "target": room.players[target_id].name,
            "loyalty": loyalty,
        })

        # NEW: Announce the inspection to everyone (without revealing loyalty)
        await room.broadcast({
            "type": "lady_inspect",
            "inspector": room.players[user_id].name,
            "target": room.players[target_id].name,
        })

    # Transfer token
    room.lady_holder = target_id
    room.lady_history.append(target_id)

    # Proceed to next proposal phase
    room.subphase = "proposal"
    await room.broadcast_state()


# ---- Mount Frontend Static Files ---- #
app.mount("/images", StaticFiles(directory="images"), name="images")

# Note: Mounting at root path must be AFTER all explicit API routes to avoid shadowing.

# Register Tortoise ORM on startup
register_tortoise(
    app,
    db_url="sqlite://database.db",
    modules={"models": ["backend.models"]},
    generate_schemas=True,
    add_exception_handlers=True,
)

# ---- Lobby listing ---- #

from typing import Optional as _Optional


# Helper dependency that returns the authenticated user if Authorization header with valid
# Basic credentials is supplied; otherwise returns None without raising.
async def _optional_user(authorization: _Optional[str] = Header(default=None)) -> _Optional[User]:
    if not authorization or not authorization.lower().startswith("basic "):
        return None
    try:
        token = authorization.split(" ", 1)[1]
        decoded = base64.b64decode(token).decode()
        username, password = decoded.split(":", 1)
    except Exception:
        return None

    user = await User.filter(username=username).first()
    if not user or not verify_password(password, user.password_hash):
        return None
    return user


@app.get("/rooms", response_model=List[LobbySummary])
async def list_rooms(current_user: _Optional[User] = Depends(_optional_user)):
    """Return lobbies plus any in-progress rooms the requester is already part of."""
    requester_id = str(current_user.id) if current_user else None
    result: List[LobbySummary] = []

    for rid, room in rooms.items():
        is_member = requester_id in room.players if requester_id else False
        # include lobby rooms for everyone, or in-progress rooms only for members
        if room.phase == "lobby" or is_member:
            host_player = room.players.get(room.host_id)
            result.append(
                LobbySummary(
                    room_id=rid,
                    host_id=room.host_id,
                    host_name=host_player.name if host_player else "Unknown",
                    player_count=len(room.players),
                    requires_password=room.password is not None,
                    member=is_member,
                    phase=room.phase,
                )
            )
    return result

# ---- Mount frontend last ---- #

# --- Custom StaticFiles subclass that disables caching for served files (except images) --- #
# We'll mount this for the root frontend directory so browsers always fetch the latest
# HTML/CSS/JS assets. Images remain served via the regular StaticFiles instance at
# "/images" and may therefore still be cached by the client.

class NoCacheStaticFiles(StaticFiles):
    """StaticFiles variant that sends headers to prevent client-side caching."""

    async def get_response(self, path: str, scope):  # type: ignore[override]
        response = await super().get_response(path, scope)

        # Inject no-cache headers so browsers revalidate on every request.
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"

        return response

# Mount the frontend with caching disabled so that clients always retrieve the latest assets.
app.mount("/", NoCacheStaticFiles(directory="frontend", html=True), name="frontend") 