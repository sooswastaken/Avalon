"""Pydantic data schemas used across the backend service.

This module centralises all models so that other packages can import
from a single location instead of sprinkling the definitions across
multiple files.
"""
from __future__ import annotations

from typing import Dict, List, Optional
from pydantic import BaseModel, Field

# -----------------------------
# Runtime & Lobby               
# -----------------------------

class Player(BaseModel):
    """Represents a user inside a lobby/game at runtime."""

    user_id: str
    name: str
    ready: bool = False
    role: Optional[str] = None  # set once game starts

    # Aggregate wins across all games (good + evil)
    wins: int = 0

    # Fields only used once the game has begun
    alive: bool = True  # placeholder for potential future mechanics


class RoomConfig(BaseModel):
    """Lobby configuration toggles selected by the host."""

    merlin: bool = True
    # Evil role toggles (all evil players share a collective vote during the assassination phase).
    mordred: bool = True
    morgana: bool = True
    percival: bool = True
    oberon: bool = False

    # --- Lady of the Lake configuration --- #
    lady_enabled: bool = True  # master toggle for the expansion rule
    # Quest numbers (1-indexed) after which the Lady of the Lake occurs.
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
    phase: str  # lobby | in_game | assassination | finished
    quest_history: List[dict] = []
    current_leader: Optional[str] = None
    consecutive_rejections: int = 0
    config: RoomConfig
    round_number: int = 0
    good_wins: int = 0
    evil_wins: int = 0
    subphase: Optional[str] = None  # proposal|voting|quest|lady|assassination
    current_team: List[str] = []
    votes: Dict[str, bool] = {}
    winner: Optional[str] = None  # "good" | "evil"
    submissions: Dict[str, str] = {}
    proposal_leader: Optional[str] = None
    round_leaders: List[Optional[str]] = []
    assassin_candidates: List[str] = []
    evil_players: List[str] = []
    assassin_votes: Dict[str, str] = {}
    lady_holder: Optional[str] = None
    lady_history: List[str] = []
    lady_after_rounds: List[int] = []

# -----------------------------
# REST request / response models
# -----------------------------

class RoomResponse(BaseModel):
    room_id: str
    user_id: str


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


# ------ Lobby helpers ------ #

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


__all__ = [
    # runtime
    "Player",
    "RoomConfig",
    "VoteRecord",
    "QuestRecord",
    "RoomState",
    # auth / lobby
    "RoomResponse",
    "SignupRequest",
    "LoginRequest",
    "AuthResponse",
    "ProfileResponse",
    "UpdateProfileRequest",
    "LeaderboardEntry",
    "CreateRoomRequest",
    "JoinRoomRequest",
    "LobbySummary",
] 