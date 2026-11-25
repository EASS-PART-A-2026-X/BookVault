"""Typed contracts: the agent's output (SearchPlan) and the HTTP API.

Genre and the limits mirror book-vault/app/schemas.py, so every plan the model
produces is a query the backend accepts.
"""

from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator


class Genre(str, Enum):  # noqa: UP042  (same declaration as the backend)
    FANTASY = "Fantasy"
    ROMANCE = "Romance"
    SCI_FI = "Sci-Fi"
    THRILLER = "Thriller"
    NON_FICTION = "Non-Fiction"
    MYSTERY = "Mystery"
    HISTORICAL = "Historical"


TROPE_MAX_LENGTH = 50
QUESTION_MAX_LENGTH = 300


def normalize_trope(name: str) -> str:
    """Same rule as the backend: trim, collapse spaces, lower case."""
    return " ".join(name.split()).lower()


def trope_key(name: str) -> str:
    """Looser key for matching what the model wrote to a stored trope:
    "Enemies-to-Lovers" and "enemies to lovers" are the same trope."""
    return normalize_trope(name.replace("-", " ").replace("_", " "))


class SearchPlan(BaseModel):
    """The filters that answer the reader's question. Leave a field null when the
    question doesn't ask for it; never guess."""

    genre: Genre | None = Field(
        default=None, description="Only when the question names or clearly implies a genre."
    )
    read_status: Literal["read", "unread"] | None = Field(
        default=None,
        description=(
            '"read" for books already finished, "unread" for to-be-read / not started / '
            "haven't read. Null when the question doesn't say."
        ),
    )
    min_rating: int | None = Field(
        default=None,
        ge=1,
        le=5,
        description=(
            "Minimum star rating 1-5. 'Five stars' -> 5, 'four stars or more' -> 4, "
            "'favourites' / 'loved' / 'best' / 'highly rated' -> 4. Null otherwise."
        ),
    )
    trope: str | None = Field(
        default=None,
        max_length=TROPE_MAX_LENGTH,
        description=(
            "One trope, spelled exactly like one returned by list_my_tropes. Null if the "
            "question names no trope or none of the reader's tropes matches it."
        ),
    )
    text: str | None = Field(
        default=None,
        max_length=100,
        description=(
            "An author or title (or part of one) the question names, e.g. 'Tolkien' or "
            "'Dune'. Null otherwise."
        ),
    )
    explanation: str = Field(
        max_length=300,
        description="One short sentence telling the reader how the question was understood.",
    )

    @field_validator("trope")
    @classmethod
    def _normalise_trope(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return normalize_trope(value) or None

    @field_validator("text")
    @classmethod
    def _strip_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split()) or None


Question = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=QUESTION_MAX_LENGTH),
]


class SearchRequest(BaseModel):
    question: Question = Field(examples=["unread fantasy with found family"])


class BookSummary(BaseModel):
    """The fields of the backend's BookRead that a search result shows."""

    id: int
    title: str
    author: str
    genre: Genre
    rating: int | None
    is_read: bool
    tropes: list[str]


class SearchResponse(BaseModel):
    plan: SearchPlan
    books: list[BookSummary]


class ErrorResponse(BaseModel):
    detail: str
