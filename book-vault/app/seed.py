"""Load demo readers and sample books into an EMPTY database, once.

    python -m app.seed            # Docker Compose runs this as the one-shot `seed` service

Idempotent and safe by design:
- It only writes when the database has no users and no books. A volume that already
  holds data (yours, or a previous seed) is left untouched, so running it on every
  `docker compose up` is a no-op after the first time.
- Everything is written in one transaction: a failure leaves the database empty.
- The sample data (seed_data.json) is validated with the API's own schemas, so seeded
  books are exactly what POST /books would have stored.

Settings (env vars):
- SEED_DEMO_DATA: "false" to skip seeding (default: true).
- DEMO_PASSWORD: password for every seeded reader. If unset, a random one is generated
  and printed once in the seed's log (`docker compose logs seed`); nothing is hard-coded.
"""

import os
import secrets
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, TypeAdapter, ValidationError
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.database import Base
from app.database import engine as app_engine
from app.migrations import migrate
from app.models import Book, Follow, User
from app.schemas import Bio, BookCreate, DisplayName, Password, Username

SEED_FILE = Path(__file__).with_name("seed_data.json")


class SeedUser(BaseModel):
    username: Username
    display_name: DisplayName
    bio: Bio = ""
    is_public: bool = False
    # Usernames this reader follows (accepted), all from the same file.
    follows: list[Username] = []
    books: list[BookCreate] = []


class SeedFile(BaseModel):
    users: list[SeedUser] = Field(min_length=1)


@dataclass(frozen=True)
class SeedResult:
    status: Literal["seeded", "skipped"]
    users: int = 0
    books: int = 0


def load_seed_file(path: Path) -> SeedFile:
    """Read and validate the sample data. Raises ValueError with a readable reason."""
    try:
        data = SeedFile.model_validate_json(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"cannot read {path}: {exc.strerror}") from exc
    except ValidationError as exc:
        raise ValueError(f"invalid seed data in {path.name}:\n{exc}") from exc
    names = [user.username for user in data.users]
    if len(set(names)) != len(names):
        raise ValueError("invalid seed data: duplicate usernames")
    for user in data.users:
        unknown = set(user.follows) - set(names)
        if unknown or user.username in user.follows:
            raise ValueError(f"invalid seed data: {user.username} follows {sorted(unknown)}")
    return data


def seed(engine: Engine, data: SeedFile, password: str) -> SeedResult:
    """Create tables if needed, then add the sample data only to an empty database."""
    Base.metadata.create_all(bind=engine)
    migrate(engine)
    with Session(engine) as db, db.begin():
        has_data = db.scalar(select(func.count(User.id))) or db.scalar(select(func.count(Book.id)))
        if has_data:
            return SeedResult("skipped")

        # One hash for all demo readers (Argon2 is deliberately slow).
        password_hash = hash_password(password)
        users: dict[str, User] = {}
        for item in data.users:
            user = User(
                username=item.username,
                display_name=item.display_name,
                bio=item.bio,
                is_public=item.is_public,
                password_hash=password_hash,
            )
            db.add(user)
            users[item.username] = user
        db.flush()  # assign user ids

        # Import here: app.main builds the FastAPI app; keep this module light otherwise.
        from app.main import get_or_create_tropes

        books = 0
        for item in data.users:
            owner = users[item.username]
            for payload in item.books:
                book = Book(**payload.model_dump(exclude={"tropes"}), owner_id=owner.id)
                book.tropes = get_or_create_tropes(db, payload.tropes)
                db.add(book)
                books += 1
            for followee in item.follows:
                db.add(
                    Follow(follower_id=owner.id, followee_id=users[followee].id, status="accepted")
                )
        return SeedResult("seeded", users=len(users), books=books)


_password = TypeAdapter(Password)


def main(
    env: Mapping[str, str] = os.environ,
    engine: Engine = app_engine,
    seed_file: Path = SEED_FILE,
) -> int:
    """Entry point. Returns the process exit code (0 = seeded, skipped or disabled)."""
    if env.get("SEED_DEMO_DATA", "true").strip().lower() in {"0", "false", "no", "off"}:
        print("seed: SEED_DEMO_DATA is off, nothing to do")
        return 0

    password = env.get("DEMO_PASSWORD", "")
    generated = not password
    if generated:
        password = secrets.token_urlsafe(12)
    try:
        _password.validate_python(password)
    except ValidationError:
        print("seed: DEMO_PASSWORD must be 8-128 characters", file=sys.stderr)
        return 2

    try:
        data = load_seed_file(seed_file)
    except ValueError as exc:
        print(f"seed: {exc}", file=sys.stderr)
        return 1

    result = seed(engine, data, password)
    if result.status == "skipped":
        print("seed: the database already has data, nothing changed")
        return 0
    print(f"seed: added {result.users} readers and {result.books} books")
    names = ", ".join(user.username for user in data.users)
    if generated:
        # Shown once, only in this container's log. Set DEMO_PASSWORD to choose it.
        print(f"seed: log in as {names} with the generated password: {password}")
    else:
        print(f"seed: log in as {names} with DEMO_PASSWORD")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
