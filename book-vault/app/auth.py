"""Accounts and login sessions.

Passwords are hashed with Argon2id. Logging in creates a random session token that is
sent to the browser in an httpOnly cookie (JavaScript can't read it); the database only
stores its SHA-256 hash. Logging out deletes the session, so the token stops working.
"""

import hashlib
import os
import secrets
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AuthSession, Book, User
from app.schemas import ErrorResponse, LoginRequest, RegisterRequest, UserRead

SESSION_COOKIE = "bv_session"


def positive_int_env(name: str, default: int) -> int:
    """Read a whole number > 0 from the environment, or stop startup with a clear message."""
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    if not raw.isdigit() or int(raw) == 0:
        raise RuntimeError(f"{name} must be a whole number greater than 0, got {raw!r}")
    return int(raw)


SESSION_DAYS = positive_int_env("SESSION_DAYS", 30)
# Set COOKIE_SECURE=true when served over HTTPS so the cookie is never sent over plain HTTP.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() in {"1", "true", "yes"}

NOT_AUTHENTICATED = "Not authenticated"
INVALID_CREDENTIALS = "Invalid username or password"
USERNAME_TAKEN = "Username already taken"

UNAUTHORIZED_RESPONSE = {status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse}}

hasher = PasswordHasher()
# Verified against when the username doesn't exist, so a login attempt takes about the
# same time either way and doesn't reveal which usernames are registered.
_DUMMY_HASH = hasher.hash("not-a-real-password")


def hash_password(password: str) -> str:
    return hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> datetime:
    # Naive UTC, matching how SQLite hands datetimes back.
    return datetime.now(UTC).replace(tzinfo=None)


def start_session(db: Session, user: User, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    db.add(
        AuthSession(
            token_hash=_token_hash(token),
            user_id=user.id,
            expires_at=_now() + timedelta(days=SESSION_DAYS),
        )
    )
    db.commit()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 24 * 3600,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def _session_for(db: Session, token: str | None) -> AuthSession | None:
    if not token:
        return None
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == _token_hash(token)))
    if session is None or session.expires_at <= _now():
        return None
    return session


def current_user(
    db: Session = Depends(get_db),
    bv_session: str | None = Cookie(default=None),
) -> User:
    """Dependency: the logged-in user, or 401."""
    session = _session_for(db, bv_session)
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=NOT_AUTHENTICATED)
    return session.user


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_409_CONFLICT: {"model": ErrorResponse}},
)
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)) -> User:
    """Create an account and log it in."""
    if db.scalar(select(User).where(User.username == payload.username)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=USERNAME_TAKEN)
    is_first_user = db.scalar(select(func.count(User.id))) == 0
    user = User(
        username=payload.username,
        display_name=payload.display_name or payload.username,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.flush()
    if is_first_user:
        # Books created before accounts existed belong to whoever sets the app up.
        db.execute(update(Book).where(Book.owner_id.is_(None)).values(owner_id=user.id))
    db.commit()
    db.refresh(user)
    start_session(db, user, response)
    return user


@router.post("/login", response_model=UserRead, responses=UNAUTHORIZED_RESPONSE)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> User:
    user = db.scalar(select(User).where(User.username == payload.username.strip().lower()))
    if user is None:
        verify_password(_DUMMY_HASH, payload.password)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)
    if not verify_password(user.password_hash, payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)
    if hasher.check_needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
    start_session(db, user, response)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    db: Session = Depends(get_db),
    bv_session: str | None = Cookie(default=None),
) -> Response:
    """End the current session (if any) and clear the cookie. Always succeeds."""
    session = _session_for(db, bv_session)
    if session is not None:
        db.delete(session)
        db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        SESSION_COOKIE, path="/", httponly=True, secure=COOKIE_SECURE, samesite="lax"
    )
    return response


@router.get("/me", response_model=UserRead, responses=UNAUTHORIZED_RESPONSE)
def me(user: User = Depends(current_user)) -> User:
    return user
