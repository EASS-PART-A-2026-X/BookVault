"""python -m app.seed: sample data goes into an empty database once, and never anywhere else."""

import json
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from app.models import Book, Follow, User
from app.seed import SEED_FILE, load_seed_file, main, seed

PASSWORD = "demo password 123"
ENV = {"DEMO_PASSWORD": PASSWORD}


def counts(engine: Engine) -> tuple[int, int, int]:
    with Session(engine) as db:
        return (
            db.scalar(select(func.count(User.id))) or 0,
            db.scalar(select(func.count(Book.id))) or 0,
            db.scalar(select(func.count(Follow.id))) or 0,
        )


def write_seed(tmp_path: Path, data: object) -> Path:
    path = tmp_path / "seed.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


# ---- the real sample data ------------------------------------------------------


def test_bundled_sample_data_is_valid() -> None:
    data = load_seed_file(SEED_FILE)
    assert [u.username for u in data.users] == ["demo", "mira", "theo"]
    assert sum(len(u.books) for u in data.users) == 20


def test_first_run_seeds_an_empty_database(
    engine: Engine, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(ENV, engine) == 0
    assert counts(engine) == (3, 20, 1)
    out = capsys.readouterr().out
    assert "added 3 readers and 20 books" in out
    assert PASSWORD not in out  # a chosen password is never printed


def test_seeded_readers_can_log_in_and_see_their_books(
    engine: Engine, anon_client: TestClient
) -> None:
    main(ENV, engine)
    login = anon_client.post("/auth/login", json={"username": "demo", "password": PASSWORD})
    assert login.status_code == 200
    books = anon_client.get("/books").json()
    assert len(books) == 16
    hobbit = next(b for b in books if b["title"] == "The Hobbit")
    assert hobbit["tropes"] == ["found family", "quest", "reluctant hero"]
    # Tropes are stored once and shared, as through the API.
    tropes = {t["name"]: t["book_count"] for t in anon_client.get("/tropes").json()}
    assert tropes["found family"] == 3
    # The seeded follow is accepted, and visibility rules apply as usual.
    assert anon_client.get("/users/mira/books").status_code == 200
    assert anon_client.get("/users/theo/books").status_code == 403


def test_second_run_changes_nothing(engine: Engine, capsys: pytest.CaptureFixture[str]) -> None:
    main(ENV, engine)
    assert main(ENV, engine) == 0
    assert counts(engine) == (3, 20, 1)
    assert "already has data, nothing changed" in capsys.readouterr().out


def test_existing_users_are_never_touched(
    engine: Engine, make_client: Callable[[str], TestClient]
) -> None:
    make_client("realreader").post(
        "/books", json={"title": "Mine", "author": "Me", "genre": "Fantasy"}
    )
    assert main(ENV, engine) == 0
    assert counts(engine) == (1, 1, 0)


def test_legacy_books_without_users_are_never_touched(engine: Engine) -> None:
    # An EX1/EX2 database: books but no accounts. The first real sign-up adopts them.
    with Session(engine) as db, db.begin():
        db.add(Book(title="Old", author="Me", genre="Fantasy"))
    assert main(ENV, engine) == 0
    assert counts(engine) == (0, 1, 0)


def test_generated_password_is_printed_once_and_works(
    engine: Engine, anon_client: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main({}, engine) == 0
    line = next(x for x in capsys.readouterr().out.splitlines() if "generated password" in x)
    password = line.rsplit(": ", 1)[1]
    assert len(password) >= 16
    login = anon_client.post("/auth/login", json={"username": "mira", "password": password})
    assert login.status_code == 200


def test_seeding_can_be_switched_off(engine: Engine) -> None:
    assert main({"SEED_DEMO_DATA": "false", **ENV}, engine) == 0
    assert counts(engine) == (0, 0, 0)


# ---- failures: clear message, non-zero exit, nothing half-written --------------


def test_too_short_password_is_refused(engine: Engine, capsys: pytest.CaptureFixture[str]) -> None:
    assert main({"DEMO_PASSWORD": "short"}, engine) == 2
    assert "DEMO_PASSWORD must be 8-128 characters" in capsys.readouterr().err
    assert counts(engine) == (0, 0, 0)


@pytest.mark.parametrize(
    ("data", "message"),
    [
        ({"users": []}, "invalid seed data"),
        (
            {"users": [{"username": "x", "display_name": "X"}]},
            "invalid seed data",
        ),  # username too short
        (
            {
                "users": [
                    {
                        "username": "demo",
                        "display_name": "D",
                        "books": [{"title": " ", "author": "A", "genre": "Fantasy"}],
                    }
                ]
            },
            "invalid seed data",
        ),
        (
            {"users": [{"username": "demo", "display_name": "D", "follows": ["ghost"]}]},
            "demo follows ['ghost']",
        ),
        (
            {"users": [{"username": "demo", "display_name": "D", "follows": ["demo"]}]},
            "demo follows []",
        ),
        (
            {
                "users": [
                    {"username": "demo", "display_name": "D"},
                    {"username": "DEMO", "display_name": "D2"},
                ]
            },
            "duplicate usernames",
        ),
    ],
    ids=["no-users", "bad-username", "blank-title", "unknown-follow", "self-follow", "duplicate"],
)
def test_invalid_seed_file_is_refused(
    engine: Engine,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    data: object,
    message: str,
) -> None:
    assert main(ENV, engine, write_seed(tmp_path, data)) == 1
    assert message in capsys.readouterr().err
    assert counts(engine) == (0, 0, 0)


def test_missing_seed_file_is_refused(
    engine: Engine, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(ENV, engine, tmp_path / "nope.json") == 1
    assert "cannot read" in capsys.readouterr().err


def test_failure_mid_seed_rolls_everything_back(engine: Engine, tmp_path: Path) -> None:
    data = load_seed_file(SEED_FILE)
    # Break the last book after validation, so the database rejects it mid-transaction.
    data.users[-1].books[-1].title = None  # type: ignore[assignment]
    with pytest.raises(Exception):  # noqa: B017  (any database error)
        seed(engine, data, PASSWORD)
    assert counts(engine) == (0, 0, 0)
