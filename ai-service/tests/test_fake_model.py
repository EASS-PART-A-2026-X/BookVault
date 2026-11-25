"""AI_MODEL=fake: the offline keyword model, through the real agent and /search."""

import pytest

from app.config import load_settings, resolve_model
from app.fake_model import keyword_plan
from tests.conftest import MakeClient

TROPES = ["found family", "enemies to lovers", "enemies", "slow burn"]


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        (
            "unread fantasy with found family",
            {"genre": "Fantasy", "read_status": "unread", "trope": "found family"},
        ),
        (
            "sci-fi I've read rated five stars",
            {"genre": "Sci-Fi", "read_status": "read", "min_rating": 5},
        ),
        ("my favourite mysteries", {"genre": "Mystery", "min_rating": 4}),
        ("Enemies-to-Lovers romance", {"genre": "Romance", "trope": "enemies to lovers"}),
        ("books by Ursula Le Guin", {"text": "Ursula Le Guin"}),
        ("what's on my TBR?", {"read_status": "unread"}),
        ("anything good?", {}),
    ],
)
def test_keyword_plan(question: str, expected: dict[str, object]) -> None:
    plan = keyword_plan(question, TROPES)
    assert plan.pop("explanation").startswith("Keyword match (offline fake model)")  # type: ignore[union-attr]
    assert plan == expected


def test_fake_is_resolved_offline() -> None:
    status = resolve_model(load_settings({"AI_MODEL": "fake"}))
    assert status.model is not None
    assert status.model.model_name == "fake-keywords"


def test_fake_model_through_search(make_client: MakeClient) -> None:
    client = make_client(ai_model="fake")
    body = client.post("/search", json={"question": "unread fantasy, found family"}).json()
    assert body["plan"]["trope"] == "found family"
    assert [b["title"] for b in body["books"]] == ["Legends & Lattes"]
