from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from passlib.context import CryptContext

from .models import User

# -----------------------------
# Password hashing helpers
# -----------------------------

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    """Return a secure bcrypt hash of *password*."""
    return pwd_context.hash(password)

def verify_password(password: str, hashed: str) -> bool:
    """Verify *password* against *hashed* bcrypt digest."""
    return pwd_context.verify(password, hashed)

# -----------------------------
# FastAPI dependency helpers
# -----------------------------

security = HTTPBasic()

async def get_current_user(credentials: HTTPBasicCredentials = Depends(security)) -> User:
    """Validate HTTP Basic credentials and return the matching *User* instance.

    Raises
    ------
    HTTPException
        If the credentials are invalid.
    """
    user: Optional[User] = await User.filter(username=credentials.username).first()
    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return user

__all__ = [
    "pwd_context",
    "hash_password",
    "verify_password",
    "security",
    "get_current_user",
] 