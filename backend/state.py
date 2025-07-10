"""Centralised in-memory runtime state.

This keeps the singletons that are shared across the whole application so
other modules can simply import them without worrying about circular
imports.
"""
from __future__ import annotations

from typing import Dict, Optional

from fastapi import WebSocket

# NOTE: The `Room` class is defined in ``backend.room``. We use a forward
# reference here to avoid an import cycle. The objects stored are *actual*
# ``Room`` instances, but ``Room`` itself is imported lazily by the
# runtime when needed.

rooms: Dict[str, "Room"] = {}

# Mapping active lobby websocket connections → optionally authenticated user_id
lobby_connections: Dict[WebSocket, Optional[str]] = {}

__all__ = ["rooms", "lobby_connections"] 