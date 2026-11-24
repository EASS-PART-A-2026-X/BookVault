"""Pydantic schemas: the API's request/response contract (separate from ORM models)."""

from datetime import datetime
from enum import Enum
from typing import Annotated, Literal, Self

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)


# (str, Enum) per the assignment spec; equivalent to StrEnum for our purposes.
class Genre(str, Enum):  # noqa: UP042
    FANTASY = "Fantasy"
    ROMANCE = "Romance"
    SCI_FI = "Sci-Fi"
    THRILLER = "Thriller"
    NON_FICTION = "Non-Fiction"
    MYSTERY = "Mystery"
    HISTORICAL = "Historical"


# Whitespace is stripped *before* the length check, so "   " is rejected.
NonEmptyStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Rating = Annotated[int, Field(ge=1, le=5)]

TROPE_MAX_LENGTH = 50
MAX_TROPES_PER_BOOK = 20

# One trope: 1-50 characters after trimming.
TropeName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=TROPE_MAX_LENGTH)
]
TropeList = Annotated[list[TropeName], Field(max_length=MAX_TROPES_PER_BOOK)]


def normalize_trope(name: str) -> str:
    """ "  Enemies   to Lovers " -> "enemies to lovers": one spelling per trope."""
    return " ".join(name.split()).lower()


def normalize_tropes(names: list[str]) -> list[str]:
    """Normalise each trope and drop duplicates, keeping the first-seen order."""
    return list(dict.fromkeys(normalize_trope(name) for name in names))


class BookBase(BaseModel):
    title: NonEmptyStr
    author: NonEmptyStr
    genre: Genre
    # Rating and review are allowed even for unread books (e.g. a DNF review).
    rating: Rating | None = None
    is_read: bool = False
    review: str | None = None
    # Free-form tags, e.g. ["enemies to lovers", "found family"].
    tropes: TropeList = []


class BookCreate(BookBase):
    """Payload for POST /books."""

    @field_validator("tropes")
    @classmethod
    def clean_tropes(cls, value: list[str]) -> list[str]:
        return normalize_tropes(value)


class BookUpdate(BaseModel):
    """Payload for PUT /books/{id}: every field optional, same constraints.

    Only fields the client actually sends are applied (see `exclude_unset`).
    """

    title: NonEmptyStr | None = None
    author: NonEmptyStr | None = None
    genre: Genre | None = None
    rating: Rating | None = None
    is_read: bool | None = None
    review: str | None = None
    # Replaces the whole list when sent; [] removes all tropes.
    tropes: TropeList | None = None

    @field_validator("tropes")
    @classmethod
    def clean_tropes(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else normalize_tropes(value)

    @model_validator(mode="after")
    def reject_null_required_fields(self) -> Self:
        # Fields may be omitted, but an explicit null would violate NOT NULL in the DB.
        # rating and review stay nullable so a client can clear them; send [] (not
        # null) to clear tropes.
        for field in ("title", "author", "genre", "is_read", "tropes"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class ErrorResponse(BaseModel):
    """Body of error responses raised with HTTPException (e.g. 404)."""

    detail: str


class HealthResponse(BaseModel):
    """Body of GET /health."""

    status: Literal["ok"]


class BookRead(BookBase):
    """Response body: the stored book, built straight from the ORM object."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime

    @field_validator("tropes", mode="before")
    @classmethod
    def trope_names(cls, value: list[object]) -> list[object]:
        # The ORM gives Trope objects; the API returns their names.
        return [getattr(item, "name", item) for item in value]


# ---------------------------------------------------------------- Accounts

USERNAME_PATTERN = r"^[a-z0-9_.]{3,30}$"
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128


def _normalize_username(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


# Trimmed and lower-cased *before* the pattern check (StringConstraints alone checks the
# pattern first), so "  Gal_A " becomes "gal_a" instead of being rejected.
Username = Annotated[
    str, StringConstraints(pattern=USERNAME_PATTERN), BeforeValidator(_normalize_username)
]
# Passwords are taken exactly as typed (no trimming).
Password = Annotated[
    str, StringConstraints(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
Bio = Annotated[str, StringConstraints(strip_whitespace=True, max_length=280)]


class RegisterRequest(BaseModel):
    """POST /auth/register. Display name defaults to the username."""

    username: Username
    password: Password
    display_name: DisplayName | None = None


class LoginRequest(BaseModel):
    """POST /auth/login. Not validated beyond types: a wrong value just fails to log in."""

    username: str
    password: str


class UserRead(BaseModel):
    """The logged-in user's own account (GET /auth/me)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str
    bio: str
    is_public: bool
    created_at: datetime


class ProfileUpdate(BaseModel):
    """PATCH /users/me: change only what's sent. None of these may be null."""

    display_name: DisplayName | None = None
    bio: Bio | None = None
    is_public: bool | None = None

    @model_validator(mode="after")
    def reject_nulls(self) -> Self:
        for field in self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class TropeCount(BaseModel):
    """One entry of GET /tropes: a trope and how many books have it."""

    name: str
    book_count: int
