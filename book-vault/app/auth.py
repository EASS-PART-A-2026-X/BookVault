"""Accounts, login sessions and password resets.

Passwords are hashed with Argon2id. Logging in creates a random session token that is
sent to the browser in an httpOnly cookie (JavaScript can't read it); the database only
stores its SHA-256 hash. Logging out deletes the session, so the token stops working.

Password reset: POST /auth/password-reset emails a single-use link (random token, only
its hash stored, expires after PASSWORD_RESET_MINUTES). The answer never says whether the
address has an account. Setting the new password ends every session of that account.
"""

import hashlib
import logging
import os
import secrets
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.mailer import Email, Mailer, base_url_from_env, mailer_from_env, send_quietly
from app.models import AuthSession, Book, PasswordReset, User
from app.schemas import (
    EmailChange,
    ErrorResponse,
    LoginRequest,
    MessageResponse,
    PasswordChange,
    PasswordResetConfirm,
    PasswordResetRequest,
    RegisterRequest,
    UserRead,
)

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

PASSWORD_RESET_MINUTES = positive_int_env("PASSWORD_RESET_MINUTES", 30)
# Reset emails per account per hour; more requests get the same answer but no email,
# so nobody can flood someone's inbox.
RESET_EMAILS_PER_HOUR = 3
MAILER = mailer_from_env()
APP_BASE_URL = base_url_from_env()

NOT_AUTHENTICATED = "Not authenticated"
INVALID_CREDENTIALS = "Invalid username or password"
USERNAME_TAKEN = "Username already taken"
EMAIL_TAKEN = "Email already in use by another account"
WRONG_PASSWORD = "Current password is incorrect"
RESET_INVALID = "This reset link is invalid or has expired. Ask for a new one."
RESET_REQUESTED = (
    "If an account uses that email, we've sent it a link to reset the password. "
    f"The link works for {PASSWORD_RESET_MINUTES} minutes."
)

logger = logging.getLogger("bookvault.auth")

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


def get_mailer() -> Mailer:
    """Dependency, so tests can swap in a MemoryMailer."""
    return MAILER


def _end_sessions(db: Session, user: User, keep: AuthSession | None = None) -> None:
    query = delete(AuthSession).where(AuthSession.user_id == user.id)
    if keep is not None:
        query = query.where(AuthSession.id != keep.id)
    db.execute(query)


def _email_taken(db: Session, email: str, user: User | None = None) -> bool:
    owner = db.scalar(select(User).where(User.email == email))
    return owner is not None and owner is not user


def reset_email(user: User, token: str) -> Email:
    link = f"{APP_BASE_URL}/reset-password?token={token}"
    body = (
        f"Hi {user.display_name},\n\n"
        f'Someone (hopefully you) asked to reset the password of your Book Vault account "'
        f'{user.username}". Open this link within {PASSWORD_RESET_MINUTES} minutes to choose '
        f"a new one:\n\n{link}\n\n"
        "If you didn't ask for this, ignore this email: your password stays the same.\n"
    )
    return Email(to=user.email or "", subject="Reset your Book Vault password", body=body)


BAD_REQUEST_RESPONSE = {status.HTTP_400_BAD_REQUEST: {"model": ErrorResponse}}
CONFLICT_RESPONSE = {status.HTTP_409_CONFLICT: {"model": ErrorResponse}}

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    responses=CONFLICT_RESPONSE,
)
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)) -> User:
    """Create an account and log it in."""
    if db.scalar(select(User).where(User.username == payload.username)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=USERNAME_TAKEN)
    if _email_taken(db, payload.email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=EMAIL_TAKEN)
    is_first_user = db.scalar(select(func.count(User.id))) == 0
    user = User(
        username=payload.username,
        email=payload.email,
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


@router.post(
    "/password",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={**BAD_REQUEST_RESPONSE, **UNAUTHORIZED_RESPONSE},
)
def change_password(
    payload: PasswordChange,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    bv_session: str | None = Cookie(default=None),
) -> Response:
    """Change your password. Needs the current one. Logs out your other devices and
    cancels any reset links; this session stays logged in."""
    if not verify_password(user.password_hash, payload.current_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=WRONG_PASSWORD)
    user.password_hash = hash_password(payload.new_password)
    _end_sessions(db, user, keep=_session_for(db, bv_session))
    db.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/email",
    response_model=UserRead,
    responses={**BAD_REQUEST_RESPONSE, **CONFLICT_RESPONSE, **UNAUTHORIZED_RESPONSE},
)
def change_email(
    payload: EmailChange,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> User:
    """Set or change the (private) email that reset links go to. Needs your password,
    so a stolen session can't redirect reset emails. Cancels pending reset links."""
    if not verify_password(user.password_hash, payload.current_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=WRONG_PASSWORD)
    if _email_taken(db, payload.email, user):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=EMAIL_TAKEN)
    user.email = payload.email
    db.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
    db.commit()
    db.refresh(user)
    return user


@router.post(
    "/password-reset",
    response_model=MessageResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def request_password_reset(
    payload: PasswordResetRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    mailer: Mailer = Depends(get_mailer),
) -> MessageResponse:
    """Email a reset link to the account with this address, if there is one. The answer
    is always the same, so it can't be used to find out who has an account. The email
    goes out after the response, so the timing doesn't tell either."""
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is not None:
        now = _now()
        db.execute(
            delete(PasswordReset).where(
                PasswordReset.user_id == user.id, PasswordReset.expires_at <= now
            )
        )
        recent = db.scalar(
            select(func.count(PasswordReset.id)).where(
                PasswordReset.user_id == user.id,
                PasswordReset.created_at > now - timedelta(hours=1),
            )
        )
        if (recent or 0) < RESET_EMAILS_PER_HOUR:
            token = secrets.token_urlsafe(32)
            db.add(
                PasswordReset(
                    token_hash=_token_hash(token),
                    user_id=user.id,
                    created_at=now,
                    expires_at=now + timedelta(minutes=PASSWORD_RESET_MINUTES),
                )
            )
            background.add_task(send_quietly, mailer, reset_email(user, token))
        else:
            logger.warning("password reset: hourly email limit reached for user %s", user.id)
        db.commit()
    return MessageResponse(detail=RESET_REQUESTED)


@router.post(
    "/password-reset/confirm",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=BAD_REQUEST_RESPONSE,
)
def confirm_password_reset(
    payload: PasswordResetConfirm, db: Session = Depends(get_db)
) -> Response:
    """Set a new password with the token from the emailed link. The link works once:
    every reset link of the account is deleted, and every session is logged out."""
    reset = db.scalar(
        select(PasswordReset).where(PasswordReset.token_hash == _token_hash(payload.token))
    )
    if reset is None or reset.expires_at <= _now():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=RESET_INVALID)
    user = reset.user
    user.password_hash = hash_password(payload.new_password)
    _end_sessions(db, user)
    db.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
