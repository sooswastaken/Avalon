"""Utility helpers for maintaining and broadcasting the live lobby list."""
from __future__ import annotations

from typing import List

from .schemas import LobbySummary
from .state import lobby_connections, rooms


def _collect_lobby_summaries() -> List[LobbySummary]:
    """Return *all* lobbies that are still in the *lobby* phase."""
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


async def broadcast_lobbies() -> None:
    """Push the current lobby list to *all* websocket listeners."""
    if not lobby_connections:
        return

    # Build personalised payloads per connection (each user sees their own in-progress games)
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
            # Client disconnected unexpectedly
            lobby_connections.pop(ws, None)

__all__ = ["broadcast_lobbies", "_collect_lobby_summaries"] 