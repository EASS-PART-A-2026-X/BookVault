"""SQLAlchemy ORM models: how data is stored (separate from API schemas)."""

from datetime import UTC, datetime

from sqlalchemy import Column, Enum, ForeignKey, String, Table, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.schemas import Genre


def utcnow() -> datetime:
    return datetime.now(UTC)


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
