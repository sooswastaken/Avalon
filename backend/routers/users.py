from __future__ import annotations

from typing import Dict, List, cast

from fastapi import APIRouter, HTTPException, status, Depends

from ..auth_utils import hash_password, verify_password, get_current_user
from ..models import User
from ..schemas import (
    AuthResponse,
    LoginRequest,
    ProfileResponse,
    SignupRequest,
    UpdateProfileRequest,
    LeaderboardEntry,
)
from ..state import rooms
from ..lobby import broadcast_lobbies

router = APIRouter(prefix="", tags=["users"])


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def signup(req: SignupRequest):
    if await User.filter(username=req.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    user = await User.create(
        username=req.username,
        password_hash=hash_password(req.password),
        display_name=req.display_name,
    )
    return AuthResponse(user_id=str(user.id), display_name=user.display_name)


@router.post("/login", response_model=AuthResponse)
async def login(req: LoginRequest):
    user = await User.filter(username=req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return AuthResponse(user_id=str(user.id), display_name=user.display_name)


@router.get("/profile", response_model=ProfileResponse)
async def get_profile(current_user: User = Depends(get_current_user)):
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


@router.put("/profile", response_model=ProfileResponse)
async def update_profile(req: UpdateProfileRequest, current_user: User = Depends(get_current_user)):
    if req.username and req.username != current_user.username:
        if await User.filter(username=req.username).first():
            raise HTTPException(status_code=400, detail="Username already taken")
        current_user.username = req.username
    if req.display_name:
        current_user.display_name = req.display_name
    await current_user.save()

    # Propagate display name changes to active rooms
    for room in rooms.values():
        if str(current_user.id) in room.players:
            room.players[str(current_user.id)].name = current_user.display_name
            await room.broadcast_state()
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


@router.get("/profile/{username}", response_model=ProfileResponse)
async def get_profile_by_username(username: str, current_user: User = Depends(get_current_user)):
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


@router.get("/leaderboard", response_model=List[LeaderboardEntry])
async def get_leaderboard(limit: int = 20, current_user: User = Depends(get_current_user)):
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