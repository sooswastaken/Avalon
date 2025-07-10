from __future__ import annotations

import asyncio
import base64
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from ..auth_utils import verify_password
from ..game_logic import handle_ws_message, send_private_info
from ..lobby import broadcast_lobbies
from ..models import User
from ..room import Room
from ..state import lobby_connections, rooms

router = APIRouter(prefix="", tags=["ws"])


@router.websocket("/lobbies_ws")
async def lobbies_ws_endpoint(ws: WebSocket, auth: Optional[str] = Query(default=None)):
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
    await broadcast_lobbies()
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        lobby_connections.pop(ws, None)
    except Exception:
        lobby_connections.pop(ws, None)


@router.websocket("/ws/{room_id}")
async def websocket_endpoint(ws: WebSocket, room_id: str, auth: Optional[str] = Query(None)):
    await ws.accept()
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
    room: Optional[Room] = rooms.get(room_id)
    if not room or user_id not in room.players:
        await ws.close(code=4002)
        return

    # Kick previous connection of same user
    prev = room.connections.get(user_id)
    if prev is not None:
        try:
            await prev.send_json({"type": "kicked", "reason": "Logged in elsewhere"})
            await prev.close(code=4003)
        except Exception:
            pass

    room.connections[user_id] = ws

    if user_id in room.disconnected_players:
        room.disconnected_players.discard(user_id)
        await room.broadcast({
            "type": "pause",
            "players": [room.players[pid].name for pid in room.disconnected_players],
        })

    await room.broadcast_state()
    await send_private_info(room, user_id)

    if getattr(room, "cleanup_task", None) and not room.cleanup_task.done():
        room.cleanup_task.cancel()
        room.cleanup_task = None

    try:
        while True:
            data = await ws.receive_json()
            await handle_ws_message(room, user_id, data)
    except WebSocketDisconnect:
        room.connections.pop(user_id, None)
        player = room.players.get(user_id)
        if player and room.phase == "lobby":
            player.ready = False
        if room.phase != "lobby":
            room.disconnected_players.add(user_id)
            await room.broadcast({
                "type": "pause",
                "players": [room.players[pid].name for pid in room.disconnected_players],
            })
        await room.broadcast_state()
        if not room.connections:
            if room.phase == "lobby":
                rooms.pop(room.room_id, None)
                await broadcast_lobbies()
                return
            if room.cleanup_task is None or room.cleanup_task.done():
                async def _prune_after_delay(rid: str, delay: int = 300):
                    try:
                        await asyncio.sleep(delay)
                        room_ref = rooms.get(rid)
                        if room_ref and not room_ref.connections:
                            rooms.pop(rid, None)
                            await broadcast_lobbies()
                    except asyncio.CancelledError:
                        pass
                room.cleanup_task = asyncio.create_task(_prune_after_delay(room.room_id))
    except Exception as e:
        print("WebSocket error", e)
        room.connections.pop(user_id, None) 