from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from tortoise.contrib.fastapi import register_tortoise

from .routers import users as users_router
from .routers import rooms as rooms_router
from .routers import websockets as ws_router
from .lobby import broadcast_lobbies  # imported for side-effects / completeness

# -----------------------------
# FastAPI app instance
# -----------------------------

app = FastAPI(title="Avalon Backend")

# Allow all origins during development – adjust for production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(users_router.router)
app.include_router(rooms_router.router)
app.include_router(ws_router.router)

# -----------------------------
# Static file mounting
# -----------------------------

# Mount images at /images (caching allowed)
app.mount("/images", StaticFiles(directory="images"), name="images")

# Custom StaticFiles variant that disables caching for the SPA assets.
class NoCacheStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):  # type: ignore[override]
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

# Mount the frontend (index.html etc.) at root path.
app.mount("/", NoCacheStaticFiles(directory="frontend", html=True), name="frontend")

# -----------------------------
# Database (Tortoise ORM)
# -----------------------------

register_tortoise(
    app,
    db_url="sqlite://database.db",
    modules={"models": ["backend.models"]},
    generate_schemas=True,
    add_exception_handlers=True,
)

__all__ = ["app"] 