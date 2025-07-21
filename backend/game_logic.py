"""Core Avalon game mechanics.

This module implements the rules of Avalon while remaining completely
framework-agnostic. All functions operate only on in-memory
`backend.room.Room` instances; FastAPI routers import them to drive the
runtime behaviour of the game without interacting with HTTP specifics.
"""
from __future__ import annotations

import random
from collections import Counter
from math import ceil
from typing import Dict, List, Optional

from fastapi import HTTPException

from .constants import EVIL_ROLES, GOOD_ROLES, QUEST_SIZES
from .lobby import broadcast_lobbies
from .models import User  # DB model
from .room import Room
from .schemas import Player, RoomConfig
from .state import rooms

# ---------------------------------------------------------------------------
# Role deck generation & night-phase information
# ---------------------------------------------------------------------------

def build_role_deck(num_players: int, config: RoomConfig) -> List[str]:
    """Return a shuffled list of roles according to *num_players* & *config*."""

    # Minimum number of evil players so that evil ≥ 33 % of the table (can be a bit above)
    num_evil_required = max(2, ceil(num_players / 3))

    # Mandatory evil roles
    evil_roles: List[str] = ["Mordred"]

    # Optional evil roles based on config
    if config.morgana:
        evil_roles.append("Morgana")
    if config.oberon:
        evil_roles.append("Oberon")

    # Pad remaining evil slots with generic minions
    remaining_evil = num_evil_required - len(evil_roles)
    evil_roles.extend(["Minion of Mordred"] * remaining_evil)

    # Good roles – Merlin is mandatory. Percival only makes sense with Morgana.
    good_roles: List[str] = ["Merlin"]
    if config.percival:
        good_roles.append("Percival")

    remaining_good = num_players - (len(good_roles) + len(evil_roles))
    good_roles.extend(["Loyal Servant of Arthur"] * remaining_good)

    roles = good_roles + evil_roles
    random.shuffle(roles)
    return roles


async def distribute_initial_info(room: Room) -> None:
    """Send night-phase information to each player (Merlin, evil team, Percival)."""
    # Evil players that know each other (exclude Oberon)
    evil_players = [p for p in room.players.values() if p.role in {"Mordred", "Morgana", "Minion of Mordred"}]
    evil_names = [p.name for p in evil_players]

    # Merlin sees ALL evil EXCEPT Mordred and Oberon
    merlin_visible_names = [p.name for p in room.players.values() if p.role in EVIL_ROLES and p.role not in {"Mordred", "Oberon"}]

    # Merlin info
    for mid in [p.user_id for p in room.players.values() if p.role == "Merlin"]:
        ws = room.connections.get(mid)
        if ws:
            await ws.send_json({"type": "info", "merlin_knows": merlin_visible_names})

    # Evil players (except Oberon) see each other
    for eid in [p.user_id for p in evil_players]:
        player_role = room.players[eid].role
        if player_role == "Oberon":
            continue
        ws = room.connections.get(eid)
        if ws:
            await ws.send_json({"type": "info", "evil": evil_names})

    # Percival sees Merlin & Morgana
    percival_ids = [p.user_id for p in room.players.values() if p.role == "Percival"]
    merlin_like_names = [p.name for p in room.players.values() if p.role in {"Merlin", "Morgana"}]
    for pid in percival_ids:
        ws = room.connections.get(pid)
        if ws:
            await ws.send_json({"type": "info", "percival_knows": merlin_like_names})


async def send_private_info(room: Room, user_id: str):
    """Send role-specific private info to *user_id* (used on reconnect)."""
    player = room.players.get(user_id)
    if not player or player.role is None:
        return

    ws = room.connections.get(user_id)
    if ws is None:
        return

    evil_players = [p for p in room.players.values() if p.role in {"Mordred", "Morgana", "Minion of Mordred"}]
    evil_names = [p.name for p in evil_players]
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


# ---------------------------------------------------------------------------
# Game flow helpers
# ---------------------------------------------------------------------------

def next_leader(room: Room) -> None:
    order = list(room.players.keys())
    if room.current_leader not in order:
        room.current_leader = order[0]
        return
    idx = order.index(room.current_leader)
    room.current_leader = order[(idx + 1) % len(order)]


def majority_approved(votes: Dict[str, bool]) -> bool:
    return sum(1 for v in votes.values() if v) > (len(votes) / 2)


def quest_requires_two_fails(room: Room) -> bool:
    if len(room.players) < 7:
        return False
    return room.round_number == 4


# ---------------------------------------------------------------------------
# WebSocket message handlers (single public entry point below)
# ---------------------------------------------------------------------------

async def handle_propose_team(room: Room, user_id: str, data: dict):
    if room.subphase != "proposal" or room.current_leader != user_id:
        return
    team: List[str] = data.get("team", [])
    required = QUEST_SIZES[len(room.players)][room.round_number - 1]
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
    if player_role in GOOD_ROLES and card == "F":
        return
    room.submissions[user_id] = card
    if len(room.submissions) == len(room.current_team):
        fail_count = list(room.submissions.values()).count("F")
        required_fails = 2 if quest_requires_two_fails(room) else 1
        success = fail_count < required_fails
        if success:
            room.good_wins += 1
        else:
            room.evil_wins += 1

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

        room.submissions = {}
        room.current_team = []
        room.votes = {}
        room.proposal_leader = None

        if room.good_wins >= 3:
            room.phase = "assassination"
            room.subphase = "assassination"
            room.assassin_candidates = [pid for pid, pl in room.players.items() if pl.role in GOOD_ROLES]
            room.assassin_votes = {}
        elif room.evil_wins >= 3:
            room.phase = "finished"
            room.winner = "evil"
            await record_game_stats(room)
        else:
            current_round_completed = room.round_number
            room.round_number += 1
            next_leader(room)
            history_entry["next_leader"] = room.players[room.current_leader].name if room.current_leader else None

            if (
                room.config.lady_enabled
                and current_round_completed in room.config.lady_after_rounds
                and room.lady_holder is not None
            ):
                room.subphase = "lady"
            else:
                room.subphase = "proposal"

        room.quest_history.append(history_entry)
        await room.broadcast({"type": "quest_result", "data": history_entry})
        await room.broadcast_state()
    else:
        await room.broadcast_state()


async def handle_assassination_vote(room: Room, user_id: str, data: dict):
    if room.phase != "assassination":
        return
    voter_role = room.players[user_id].role
    if voter_role not in EVIL_ROLES:
        return
    target = data.get("target")
    if target not in room.assassin_candidates:
        return
    room.assassin_votes[user_id] = target
    evil_player_ids = [pid for pid, p in room.players.items() if p.role in EVIL_ROLES]
    if len(room.assassin_votes) < len(evil_player_ids):
        await room.broadcast_state()
        return

    counts = Counter(room.assassin_votes.values())
    max_votes = max(counts.values())
    top_ids = [pid for pid, cnt in counts.items() if cnt == max_votes]
    if len(top_ids) == 1:
        chosen_id = top_ids[0]
        room.winner = "evil" if room.players[chosen_id].role == "Merlin" else "good"
        room.phase = "finished"
        await record_game_stats(room)
        await room.broadcast_state()
    else:
        room.assassin_candidates = top_ids
        room.assassin_votes = {}
        await room.broadcast({
            "type": "assassination_tie",
            "candidates": [room.players[pid].name for pid in top_ids],
        })
        await room.broadcast_state()


async def handle_set_config(room: Room, user_id: str, data: dict):
    if room.phase != "lobby" or user_id != room.host_id:
        return
    morgana = bool(data.get("morgana", room.config.morgana))
    percival = bool(data.get("percival", room.config.percival))
    oberon = bool(data.get("oberon", room.config.oberon))

    if len(room.players) < 7:
        oberon = False

    if morgana != percival:
        morgana = percival = morgana or percival

    room.config.morgana = morgana
    room.config.percival = percival
    room.config.oberon = oberon

    lady_enabled = bool(data.get("lady_enabled", room.config.lady_enabled))
    lady_after_rounds_in = data.get("lady_after_rounds")
    if isinstance(lady_after_rounds_in, list) and all(isinstance(r, int) for r in lady_after_rounds_in):
        lady_rounds = [r for r in lady_after_rounds_in if 1 <= r <= 5]
        if lady_rounds:
            room.config.lady_after_rounds = sorted(set(lady_rounds))

    room.config.lady_enabled = lady_enabled

    await room.broadcast_state()


async def handle_restart_game(room: Room, user_id: str):
    if room.phase != "finished" or user_id != room.host_id:
        return
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
    room.lady_holder = None
    room.lady_history = []
    await room.broadcast_state()
    await broadcast_lobbies()


async def handle_reset_lobby(room: Room, user_id: str):
    if user_id != room.host_id:
        return
    for p in room.players.values():
        p.ready = False
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
    room.lady_holder = None
    room.lady_history = []
    await room.broadcast_state()
    await broadcast_lobbies()


async def handle_lady_choose(room: Room, user_id: str, data: dict):
    if room.subphase != "lady" or room.lady_holder != user_id:
        return
    target_id: str = str(data.get("target")) if data.get("target") else ""
    if target_id not in room.players or target_id == user_id or target_id in room.lady_history:
        return

    target_role = room.players[target_id].role or ""
    loyalty = "good" if target_role in GOOD_ROLES else "evil"
    ws = room.connections.get(user_id)
    if ws:
        await ws.send_json({
            "type": "lady_result",
            "target": room.players[target_id].name,
            "loyalty": loyalty,
        })
        await room.broadcast({
            "type": "lady_inspect",
            "inspector": room.players[user_id].name,
            "target": room.players[target_id].name,
        })

    room.lady_holder = target_id
    room.lady_history.append(target_id)
    room.subphase = "proposal"
    await room.broadcast_state()

# ---------------------------------------------------------------------------
# Statistics helpers
# ---------------------------------------------------------------------------

async def _update_player_stats(user_id: str, role: str | None, winner: str):
    if role is None:
        return
    user = await User.filter(id=user_id).first()
    if user is None:
        return
    user.total_games += 1
    side = "good" if role in GOOD_ROLES else "evil"
    is_win = winner == side
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
    stats_dict: Dict[str, Dict[str, int]] = user.role_stats if isinstance(user.role_stats, dict) else {}
    role_entry = stats_dict.get(role, {"wins": 0, "losses": 0})
    if is_win:
        role_entry["wins"] += 1
    else:
        role_entry["losses"] += 1
    stats_dict[role] = role_entry
    user.role_stats = stats_dict
    await user.save()


async def record_game_stats(room: Room):
    if getattr(room, "stats_recorded", False):
        return
    if room.phase != "finished" or not room.winner:
        return
    for player in room.players.values():
        await _update_player_stats(player.user_id, player.role, room.winner)
        user_obj = await User.filter(id=player.user_id).first()
        if user_obj:
            player.wins = user_obj.good_wins + user_obj.evil_wins
    room.stats_recorded = True

# ---------------------------------------------------------------------------
# Game initialisation
# ---------------------------------------------------------------------------

async def start_game(room: Room):
    room.phase = "in_game"
    roles = build_role_deck(len(room.players), room.config)
    shuffled_players = list(room.players.values())
    random.shuffle(shuffled_players)
    for player, role in zip(shuffled_players, roles):
        player.role = role

    # Reorder the room.players dict to match the newly shuffled order so that
    # turn rotation (leader clockwise) and Lady-of-the-Lake progression are
    # randomised every time the game starts (even after resetting/restarting).
    room.players = {p.user_id: p for p in shuffled_players}
    await distribute_initial_info(room)
    room.current_leader = shuffled_players[0].user_id
    if room.config.lady_enabled:
        room.lady_holder = shuffled_players[-1].user_id
        room.lady_history = [room.lady_holder]
    room.round_number = 1
    room.good_wins = 0
    room.evil_wins = 0
    room.subphase = "proposal"
    room.current_team = []
    room.votes = {}
    room.quest_history = []
    room.consecutive_rejections = 0
    await broadcast_lobbies()

# ---------------------------------------------------------------------------
# Primary dispatcher used by websocket endpoint
# ---------------------------------------------------------------------------

async def handle_ws_message(room: Room, user_id: str, data: dict):
    msg_type = data.get("type")
    if msg_type == "toggle_ready":
        player = room.players.get(user_id)
        if player:
            player.ready = not player.ready
            await room.broadcast_state()
    elif msg_type == "kick":
        target_id = str(data.get("target")) if data.get("target") else ""
        if user_id != room.host_id or target_id == user_id:
            return
        target_ws = room.connections.get(target_id)
        if target_ws:
            await target_ws.send_json({"type": "kicked", "target": target_id})
            await target_ws.close(code=4002)
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

__all__ = [
    "build_role_deck",
    "distribute_initial_info",
    "send_private_info",
    "start_game",
    "handle_ws_message",
    "handle_assassination_vote",
    "handle_propose_team",
    "handle_vote_team",
    "handle_submit_card",
    "handle_set_config",
    "handle_restart_game",
    "handle_reset_lobby",
    "handle_lady_choose",
    "record_game_stats",
] 