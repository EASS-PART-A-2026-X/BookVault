"""FastAPI application: Personal Book Vault & Reading Tracker endpoints."""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import Base, engine, get_db
from app.models import Book, utcnow
from app.schemas import BookCreate, BookRead, BookUpdate, ErrorResponse, Genre, HealthResponse

BOOK_NOT_FOUND = "Book not found"
DATABASE_UNAVAILABLE = "Database unavailable"

# Browser origins allowed to call the API (the Vite dev server by default).
DEFAULT_CORS_ORIGINS = "http://localhost:5173"

# Declared on every /books/{book_id} route so the 404 appears in the OpenAPI docs.
NOT_FOUND_RESPONSE: dict[int | str, dict[str, Any]] = {
    status.HTTP_404_NOT_FOUND: {"model": ErrorResponse, "description": BOOK_NOT_FOUND},
}


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Create tables on startup (no-op if they already exist).
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Personal Book Vault & Reading Tracker",
    description="Track the books you own, what you've read, and how you rated them.",
    version="0.1.0",
    lifespan=lifespan,
)


def parse_cors_origins(value: str | None) -> list[str]:
    """Split a comma-separated CORS_ORIGINS value into a clean list of origins.

    Unset falls back to the default; an empty string means "allow no origins".
    """
    if value is None:
        value = DEFAULT_CORS_ORIGINS
    return [origin.strip().rstrip("/") for origin in value.split(",") if origin.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_cors_origins(os.getenv("CORS_ORIGINS")),
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)


def get_book_or_404(db: Session, book_id: int) -> Book:
    """Fetch a book by id, raising 404 if it doesn't exist."""
    book = db.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=BOOK_NOT_FOUND)
    return book


@app.get(
    "/health",
    response_model=HealthResponse,
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse}},
)
def health(db: Session = Depends(get_db)) -> HealthResponse:
    """Liveness + readiness: 200 only if the database answers a trivial query."""
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=DATABASE_UNAVAILABLE
        ) from exc
    return HealthResponse(status="ok")


@app.post("/books", response_model=BookRead, status_code=status.HTTP_201_CREATED)
def create_book(payload: BookCreate, db: Session = Depends(get_db)) -> Book:
    book = Book(**payload.model_dump())
    db.add(book)
    db.commit()
    db.refresh(book)
    return book


@app.get("/books", response_model=list[BookRead])
def list_books(
    genre: Genre | None = None,
    is_read: bool | None = None,
    min_rating: int | None = Query(default=None, ge=1, le=5),
    db: Session = Depends(get_db),
) -> list[Book]:
    """List books, optionally filtered. Filters combine with AND."""
    query = select(Book).order_by(Book.id)
    if genre is not None:
        query = query.where(Book.genre == genre)
    if is_read is not None:
        query = query.where(Book.is_read == is_read)
    if min_rating is not None:
        # In SQL, NULL >= n is never true, so unrated books are excluded here.
        query = query.where(Book.rating >= min_rating)
    return list(db.scalars(query))


@app.get("/books/{book_id}", response_model=BookRead, responses=NOT_FOUND_RESPONSE)
def get_book(book_id: int, db: Session = Depends(get_db)) -> Book:
    return get_book_or_404(db, book_id)


@app.put("/books/{book_id}", response_model=BookRead, responses=NOT_FOUND_RESPONSE)
def update_book(book_id: int, payload: BookUpdate, db: Session = Depends(get_db)) -> Book:
    """Partially update a book: only fields present in the request body change."""
    book = get_book_or_404(db, book_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(book, field, value)
    # Set explicitly so an empty body `{}` still counts as an update.
    book.updated_at = utcnow()
    db.commit()
    db.refresh(book)
    return book


@app.delete(
    "/books/{book_id}", status_code=status.HTTP_204_NO_CONTENT, responses=NOT_FOUND_RESPONSE
)
def delete_book(book_id: int, db: Session = Depends(get_db)) -> Response:
    book = get_book_or_404(db, book_id)
    db.delete(book)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
