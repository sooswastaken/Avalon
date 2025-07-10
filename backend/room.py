from __future__ import annotations

import asyncio
from typing import Dict, List, Optional, Set

from fastapi import HTTPException, WebSocket

from .constants import EVIL_ROLES
from .schemas import Player, RoomConfig, RoomState

# NOTE: ``Room`` deliberately lives in its own module to avoid circular
# imports between game logic, routers, and utility helpers.


class Room:
    """Encapsulates runtime state and active websocket connections for a lobby / game."""

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
        self.assassin_candidates: List[str] = []
        self.assassin_votes: Dict[str, str] = {}
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
        self.cleanup_task: Optional[asyncio.Task] = None

    # ---------------------------------------------------------------------
    # Helper utilities
    # ---------------------------------------------------------------------

    def check_password(self, password_attempt: Optional[str]) -> bool:
        """Return *True* if *password_attempt* is valid for this room."""
        if self.password is None:
            return True  # public lobby
        if password_attempt is None:
            return False
        return self.password == password_attempt

    # -------------------- Player management -------------------- #

    def add_player(self, player: Player) -> None:
        if self.phase != "lobby":
            raise HTTPException(status_code=400, detail="Game already started")
        self.players[player.user_id] = player

    def remove_player(self, user_id: str) -> None:
        self.players.pop(user_id, None)
        self.connections.pop(user_id, None)
        # Transfer host if host leaves
        if user_id == self.host_id and self.players:
            self.host_id = next(iter(self.players))

    def all_ready(self) -> bool:
        """Every player has toggled *ready* and there are at least 5 players."""
        return all(p.ready for p in self.players.values()) and len(self.players) >= 5

    # -------------------- Leader rotation helper -------------------- #

    def _compute_round_leaders(self) -> List[Optional[str]]:
        """Return a 5-element list of leader names (or ``None``) for quests 1-5."""
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
        idx = order.index(self.current_leader) if self.current_leader in order else 0
        current_idx = self.round_number - 1 if self.round_number else 0
        for offset in range(current_idx + 1, 5):
            steps_ahead = offset - current_idx
            future_pid = order[(idx + steps_ahead) % len(order)]
            leaders[offset] = name_map.get(future_pid)

        return leaders

    # -------------------- Broadcasting helpers -------------------- #

    async def broadcast_state(self) -> None:
        """Send the *entire* room state snapshot to all connected clients."""
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

    async def broadcast(self, payload: dict) -> None:
        """Broadcast *payload* to every active websocket connection in the room."""
        for ws in list(self.connections.values()):
            await ws.send_json(payload)

__all__ = ["Room"] 