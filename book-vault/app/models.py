"""SQLAlchemy ORM models: how data is stored (separate from API schemas)."""

from datetime import UTC, datetime

from sqlalchemy import Column, Enum, ForeignKey, String, Table, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.schemas import Genre


def utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    """An account. Usernames are stored lower case, so they're unique ignoring case."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(50))
    bio: Mapped[str] = mapped_column(String(280), default="")
    # Private by default: others must request to follow before seeing books.
    is_public: Mapped[bool] = mapped_column(default=False)
    password_hash: Mapped[str] = mapped_column(String(255))
    # Private; only for password reset links. Stored lower case. NULL for accounts made
    # before emails existed (SQLite's unique index allows any number of NULLs).
    email: Mapped[str | None] = mapped_column(String(254), unique=True, index=True, default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class AuthSession(Base):
    """A login. Only a SHA-256 hash of the cookie token is stored, so a leaked
    database can't be used to log in."""

    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime]

    user: Mapped[User] = relationship(lazy="joined")


class PasswordReset(Base):
    """A password reset link. Like sessions, only a SHA-256 hash of the token is stored.
    Single use: all of a user's reset rows are deleted once one is used."""

    __tablename__ = "password_resets"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime]
    expires_at: Mapped[datetime]

    user: Mapped[User] = relationship(lazy="joined")


class Follow(Base):
    """follower -> followee. "pending" until a private followee accepts; following a
    public profile is "accepted" straight away. Declining deletes the row."""

    __tablename__ = "follows"
    __table_args__ = (UniqueConstraint("follower_id", "followee_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    follower_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    followee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(10))  # "pending" | "accepted"
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    follower: Mapped[User] = relationship(foreign_keys=[follower_id], lazy="joined")
    followee: Mapped[User] = relationship(foreign_keys=[followee_id], lazy="joined")


# Many-to-many link between books and tropes. Rows are removed with either side.
book_tropes = Table(
    "book_tropes",
    Base.metadata,
    Column("book_id", ForeignKey("books.id", ondelete="CASCADE"), primary_key=True),
    Column("trope_id", ForeignKey("tropes.id", ondelete="CASCADE"), primary_key=True),
)


class Trope(Base):
    """A reusable tag such as "enemies to lovers". Names are stored normalised
    (trimmed, single spaces, lower case), so each trope exists once."""

    __tablename__ = "tropes"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, index=True)


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    # Nullable only for books created before accounts existed; they are adopted by the
    # first account that registers (see app/auth.py). Every query filters by owner.
    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, default=None
    )
    title: Mapped[str] = mapped_column(String(255))
    author: Mapped[str] = mapped_column(String(255))
    # values_callable stores the enum *values* ("Sci-Fi") rather than names ("SCI_FI").
    genre: Mapped[Genre] = mapped_column(
        Enum(Genre, values_callable=lambda e: [m.value for m in e], validate_strings=True)
    )
    rating: Mapped[int | None] = mapped_column(default=None)
    is_read: Mapped[bool] = mapped_column(default=False)
    review: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    # onupdate fires on ORM UPDATEs; the PUT endpoint also sets it explicitly.
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
    tropes: Mapped[list[Trope]] = relationship(
        secondary=book_tropes, order_by=Trope.name, lazy="selectin"
    )
