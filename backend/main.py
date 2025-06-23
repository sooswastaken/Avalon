import uuid
from typing import Dict, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

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
    session_id: str
    name: str
    ready: bool = False
    role: Optional[str] = None  # filled after game starts

    # fields only used once game has begun
    alive: bool = True  # placeholder for potential future mechanics

class RoomConfig(BaseModel):
    merlin: bool = True
    assassin: bool = True
    mordred: bool = True
    morgana: bool = False
    percival: bool = False
    oberon: bool = False

class VoteRecord(BaseModel):
    approvals: Dict[str, bool]  # session_id -> True/False

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
    subphase: Optional[str] = None  # proposal|voting|quest|assassination
    current_team: List[str] = []
    votes: Dict[str, bool] = {}
    winner: Optional[str] = None  # "good" | "evil"
    submissions: Dict[str, str] = {}
    proposal_leader: Optional[str] = None  # session id of who proposed current team


# ---- In-memory stores ---- #
rooms: Dict[str, "Room"] = {}


# ---- Helper objects ---- #
class Room:
    """Encapsulates runtime state and active websocket connections for a room."""

    def __init__(self, room_id: str, host_player: Player):
        self.room_id = room_id
        self.host_id = host_player.session_id
        self.players: Dict[str, Player] = {host_player.session_id: host_player}
        self.config = RoomConfig()  # default config
        self.phase = "lobby"
        self.quest_history: List[dict] = []
        self.current_leader: Optional[str] = None
        self.consecutive_rejections: int = 0
        # active websocket connections: session_id -> websocket
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

    # ---- Player management ---- #
    def add_player(self, player: Player):
        if self.phase != "lobby":
            raise HTTPException(status_code=400, detail="Game already started")
        self.players[player.session_id] = player

    def remove_player(self, session_id: str):
        self.players.pop(session_id, None)
        self.connections.pop(session_id, None)
        # Transfer host if host leaves
        if session_id == self.host_id and self.players:
            self.host_id = next(iter(self.players))

    def all_ready(self) -> bool:
        return all(p.ready for p in self.players.values()) and len(self.players) >= 5

    # ---- Broadcasting ---- #
    async def broadcast_state(self):
        """Send entire room state snapshot to all connected clients."""
        state_payload = RoomState(
            room_id=self.room_id,
            host_id=self.host_id,
            players=list(self.players.values()),
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
        ).model_dump()
        for ws in list(self.connections.values()):
            await ws.send_json({"type": "state", "data": state_payload})

    async def broadcast(self, payload: dict):
        for ws in list(self.connections.values()):
            await ws.send_json(payload)


# ---- REST Endpoints ---- #

class CreateRoomRequest(BaseModel):
    name: str


class RoomJoinRequest(BaseModel):
    name: str


class SimpleResponse(BaseModel):
    room_id: str
    session_id: str


@app.post("/rooms", response_model=SimpleResponse)
async def create_room(req: CreateRoomRequest):
    room_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    host_player = Player(session_id=session_id, name=req.name)
    room = Room(room_id, host_player)
    rooms[room_id] = room
    return SimpleResponse(room_id=room_id, session_id=session_id)


@app.post("/rooms/{room_id}/join", response_model=SimpleResponse)
async def join_room(room_id: str, req: RoomJoinRequest):
    room = rooms.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    session_id = str(uuid.uuid4())
    player = Player(session_id=session_id, name=req.name)
    room.add_player(player)
    await room.broadcast_state()
    return SimpleResponse(room_id=room_id, session_id=session_id)


@app.get("/self")
async def get_self(session_id: str, room_id: str):
    room = rooms.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    player = room.players.get(session_id)
    if not player:
        raise HTTPException(status_code=404, detail="Unknown session")
    # Provide private info (role) only
    return {"role": player.role, "config": room.config.model_dump()}


# ---- WebSocket ---- #

@app.websocket("/ws/{room_id}/{session_id}")
async def websocket_endpoint(ws: WebSocket, room_id: str, session_id: str):
    await ws.accept()
    room = rooms.get(room_id)
    if not room:
        await ws.close(code=4000)
        return

    if session_id not in room.players:
        await ws.close(code=4001)
        return

    room.connections[session_id] = ws

    # Send initial state
    await room.broadcast_state()

    try:
        while True:
            data = await ws.receive_json()
            await handle_ws_message(room, session_id, data)
    except WebSocketDisconnect:
        room.connections.pop(session_id, None)
        # Mark not ready on disconnect during lobby
        player = room.players.get(session_id)
        if player is not None and room.phase == "lobby":
            player.ready = False
        await room.broadcast_state()
    except Exception as e:
        print("WebSocket error", e)
        room.connections.pop(session_id, None)


# ---- Game & Lobby Logic ---- #
async def handle_ws_message(room: Room, session_id: str, data: dict):
    msg_type = data.get("type")
    if msg_type == "toggle_ready":
        player = room.players.get(session_id)
        if player is None:
            return
        player.ready = not player.ready
        await room.broadcast_state()
    elif msg_type == "kick":
        target_id = str(data.get("target")) if data.get("target") else ""
        if session_id != room.host_id:
            return  # ignore unauthorized
        if target_id == session_id:
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
        if session_id != room.host_id or not room.all_ready():
            return
        await start_game(room)
        await room.broadcast_state()
    elif msg_type == "propose_team":
        await handle_propose_team(room, session_id, data)
    elif msg_type == "vote_team":
        await handle_vote_team(room, session_id, data)
    elif msg_type == "submit_card":
        await handle_submit_card(room, session_id, data)
    elif msg_type == "assassin_guess":
        await handle_assassin_guess(room, session_id, data)
    elif msg_type == "set_config":
        await handle_set_config(room, session_id, data)
    elif msg_type == "restart_game":
        await handle_restart_game(room, session_id)
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
    room.current_leader = shuffled_players[0].session_id

    # Init quest data
    room.round_number = 1
    room.good_wins = 0
    room.evil_wins = 0
    room.subphase = "proposal"
    room.current_team = []
    room.votes = {}
    room.quest_history = []
    room.consecutive_rejections = 0


async def distribute_initial_info(room: Room):
    """Send private info to players according to roles."""
    evil_players = [p for p in room.players.values() if p.role in {"Assassin", "Mordred", "Morgana", "Minion of Mordred"}]
    evil_names = [p.name for p in evil_players]
    # Merlin sees all evil except Mordred and Oberon
    merlin_ids = [p.session_id for p in room.players.values() if p.role == "Merlin"]
    for mid in merlin_ids:
        ws = room.connections.get(mid)
        if ws:
            await ws.send_json({"type": "info", "evil": evil_names})
    # Evil players (except Oberon) see each other
    for eid in [p.session_id for p in evil_players]:
        player_role = room.players[eid].role
        if player_role == "Oberon":
            continue
        ws = room.connections.get(eid)
        if ws:
            await ws.send_json({"type": "info", "evil_team": evil_names})
    # Percival sees Merlin + Morgana if present
    percival_ids = [p.session_id for p in room.players.values() if p.role == "Percival"]
    merlin_like_names = [p.name for p in room.players.values() if p.role in {"Merlin", "Morgana"}]
    for pid in percival_ids:
        ws = room.connections.get(pid)
        if ws:
            await ws.send_json({"type": "info", "merlin_like": merlin_like_names})


# ---- Role Logic ---- #

def build_role_deck(num_players: int, config: RoomConfig) -> List[str]:
    """Generate role list respecting player count and config."""
    num_evil_required = {5:2,6:2,7:3,8:3,9:3,10:4}[num_players]

    # Mandatory evil
    evil_roles: List[str] = ["Assassin", "Mordred"]

    remaining_evil = num_evil_required - len(evil_roles)

    # add optional evil roles
    optional_evil_queue: List[str] = []
    if config.morgana:
        optional_evil_queue.append("Morgana")
    if config.oberon:
        optional_evil_queue.append("Oberon")

    for r in optional_evil_queue:
        if remaining_evil == 0:
            break
        evil_roles.append(r)
        remaining_evil -=1

    # fill leftover with generic minions
    evil_roles.extend(["Minion of Mordred"]*remaining_evil)

    # Good roles
    good_roles: List[str] = ["Merlin"]
    if config.percival:
        good_roles.append("Percival")

    remaining_good = num_players - (len(good_roles)+len(evil_roles))
    good_roles.extend(["Loyal Servant of Arthur"]*remaining_good)

    roles = good_roles + evil_roles
    import random; random.shuffle(roles)
    return roles


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


async def handle_propose_team(room: Room, session_id: str, data: dict):
    if room.subphase != "proposal" or room.current_leader != session_id:
        return
    team: List[str] = data.get("team", [])
    required = QUEST_SIZES[len(room.players)][room.round_number - 1]
    # validate
    if len(team) != required or not all(p in room.players for p in team):
        return
    room.current_team = team
    room.proposal_leader = session_id
    room.subphase = "voting"
    room.votes = {}
    await room.broadcast_state()


async def handle_vote_team(room: Room, session_id: str, data: dict):
    if room.subphase != "voting":
        return
    approve = bool(data.get("approve"))
    room.votes[session_id] = approve
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
            else:
                next_leader(room)
                room.subphase = "proposal"
        await room.broadcast_state()
    else:
        await room.broadcast_state()


async def handle_submit_card(room: Room, session_id: str, data: dict):
    if room.subphase != "quest" or session_id not in room.current_team:
        return
    card = data.get("card")  # "S" or "F"
    if card not in {"S", "F"}:
        return
    # enforce good must play Success
    player_role = room.players[session_id].role
    if player_role in {"Merlin", "Percival", "Loyal Servant of Arthur"} and card == "F":
        return
    room.submissions = getattr(room, "submissions", {})
    room.submissions[session_id] = card
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
        elif room.evil_wins >= 3:
            room.phase = "finished"
            room.winner = "evil"
        else:
            # next round
            room.round_number += 1
            next_leader(room)
            history_entry["next_leader"] = room.players[room.current_leader].name if room.current_leader else None
            room.subphase = "proposal"

        # append record only after next leader computed (if applicable)
        room.quest_history.append(history_entry)
        await room.broadcast({"type": "quest_result", "data": history_entry})
        await room.broadcast_state()
    else:
        await room.broadcast_state()


async def handle_assassin_guess(room: Room, session_id: str, data: dict):
    if room.phase != "assassination":
        return
    player_role = room.players[session_id].role
    if player_role != "Assassin":
        return
    target = data.get("target")
    if target not in room.players:
        return
    if room.players[target].role == "Merlin":
        room.winner = "evil"
    else:
        room.winner = "good"
    room.phase = "finished"
    await room.broadcast_state()


# ---- Config handling ---- #
async def handle_set_config(room: Room, session_id: str, data: dict):
    """Allow host to toggle role options in lobby."""
    if room.phase != "lobby" or session_id != room.host_id:
        return
    morgana = bool(data.get("morgana", room.config.morgana))
    percival = bool(data.get("percival", room.config.percival))
    oberon = bool(data.get("oberon", room.config.oberon))

    # optional roles require 7+ players
    if len(room.players) < 7:
        morgana = percival = oberon = False

    # enforce Morgana & Percival paired
    if morgana != percival:
        morgana = percival = morgana or percival

    room.config.morgana = morgana
    room.config.percival = percival
    room.config.oberon = oberon
    await room.broadcast_state()


async def handle_restart_game(room: Room, session_id: str):
    """Reset room to lobby so players can play again."""
    if room.phase != "finished" or session_id != room.host_id:
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
    await room.broadcast_state()


# ---- Mount Frontend Static Files ---- #
app.mount("/images", StaticFiles(directory="images"), name="images")
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")


# ---- Dev entrypoint ---- #
# Run with: uvicorn backend.main:app --reload (from project root) 