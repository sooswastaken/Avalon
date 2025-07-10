from __future__ import annotations

import base64
import uuid
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException

from ..auth_utils import get_current_user
from ..lobby import broadcast_lobbies
from ..room import Room
from ..schemas import (
    CreateRoomRequest,
    JoinRoomRequest,
    LobbySummary,
    Player,
    RoomResponse,
)
from ..state import rooms
from ..models import User

router = APIRouter(prefix="", tags=["rooms"])


@router.post("/rooms", response_model=RoomResponse)
async def create_room(
    req: CreateRoomRequest = Body(default=CreateRoomRequest()),
    current_user: User = Depends(get_current_user),
):
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
    await broadcast_lobbies()
    return RoomResponse(room_id=room_id, user_id=str(current_user.id))


@router.post("/rooms/{room_id}/join", response_model=RoomResponse)
async def join_room(
    room_id: str,
    req: JoinRoomRequest = Body(default=JoinRoomRequest()),
    current_user: User = Depends(get_current_user),
):
    room = rooms.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    user_id = str(current_user.id)
    if user_id in room.players:
        return RoomResponse(room_id=room_id, user_id=user_id)
    if user_id != room.host_id and not room.check_password(req.password):
        raise HTTPException(status_code=403, detail="Incorrect or missing room password")
    player = Player(
        user_id=user_id,
        name=current_user.display_name,
        wins=current_user.good_wins + current_user.evil_wins,
    )
    room.add_player(player)
    await room.broadcast_state()
    return RoomResponse(room_id=room_id, user_id=user_id)


# ---------------------------------------------------------------------------
# Lobby listing
# ---------------------------------------------------------------------------


def _optional_user(authorization: Optional[str] = Header(default=None)) -> Optional[User]:
    # This function is synchronous by FastAPI design, so we cannot use "await" directly.
    # Therefore we perform the DB check synchronously using Tortoise's .get_or_none,
    # which is compatible with sync contexts via the built-in "_execute_sync" helper.
    # If you migrate to an async context, switch back to the previous async/await style.
    import anyio

    if not authorization or not authorization.lower().startswith("basic "):
        return None
    try:
        token = authorization.split(" ", 1)[1]
        decoded = base64.b64decode(token).decode()
        username, password = decoded.split(":", 1)
    except Exception:
        return None

    from ..auth_utils import verify_password  # local import

    # Run DB access in a blocking portal so we remain sync
    async def _lookup() -> Optional[User]:
        return await User.filter(username=username).first()

    # "anyio.from_thread.run" can directly execute an async function from a synchronous context.
    # Wrapping it with "asyncio.run" causes a nested event loop and raises
    # "RuntimeError: asyncio.run() cannot be called from a running event loop".
    user = anyio.from_thread.run(_lookup)  # type: ignore[arg-type]
    if not user or not verify_password(password, user.password_hash):
        return None
    return user


@router.get("/rooms", response_model=List[LobbySummary])
async def list_rooms(current_user: Optional[User] = Depends(_optional_user)):
    requester_id = str(current_user.id) if current_user else None
    result: List[LobbySummary] = []
    for rid, room in rooms.items():
        is_member = requester_id in room.players if requester_id else False
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