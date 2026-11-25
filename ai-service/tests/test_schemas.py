"""SearchPlan's own validation: the model's output is normalised like the backend does."""

import pytest
from pydantic import ValidationError

from app.schemas import SearchPlan, normalize_trope, trope_key


def test_trope_and_text_are_normalised() -> None:
    plan = SearchPlan(trope="  Enemies   to LOVERS ", text="  Ursula   Le Guin ", explanation="x")
    assert plan.trope == "enemies to lovers"
    assert plan.text == "Ursula Le Guin"


@pytest.mark.parametrize("field", ["trope", "text"])
def test_blank_or_null_becomes_none(field: str) -> None:
    assert getattr(SearchPlan(**{field: "   "}, explanation="x"), field) is None
    assert getattr(SearchPlan(**{field: None}, explanation="x"), field) is None


@pytest.mark.parametrize(
    "fields",
    [{"genre": "Poetry"}, {"min_rating": 0}, {"min_rating": 6}, {"read_status": "reading"}, {}],
    ids=["unknown-genre", "rating-0", "rating-6", "bad-status", "no-explanation"],
)
def test_invalid_plans_are_rejected(fields: dict[str, object]) -> None:
    values = {"explanation": "x", **fields} if fields else {}
    with pytest.raises(ValidationError):
        SearchPlan(**values)  # type: ignore[arg-type]


def test_trope_key_ignores_hyphens_and_case() -> None:
    assert trope_key("Enemies-to-Lovers") == trope_key("enemies to lovers")
    assert normalize_trope("Slow-Burn") == "slow-burn"  # the stored spelling is kept
