"""The eval harness (eval/run_eval.py): dataset validity and the scoring rules.

Runs fully offline with the fake model, so CI keeps the dataset and scorer honest.
"""

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType

import pytest

EVAL = Path(__file__).resolve().parents[2] / "eval" / "run_eval.py"


@pytest.fixture(scope="module")
def ev() -> ModuleType:
    spec = importlib.util.spec_from_file_location("run_eval", EVAL)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["run_eval"] = module
    spec.loader.exec_module(module)
    return module


def test_dataset_is_valid_and_sized_as_required(ev: ModuleType) -> None:
    dataset = ev.load_dataset()
    assert 15 <= len(dataset.cases) <= 30
    # Every expected trope exists in the demo vault the eval runs against.
    vault_tropes = {t for b in ev.load_vault() for t in b.tropes}
    for case in dataset.cases:
        for trope in case.expected_output["expected"].allowed["trope"]:
            assert trope is None or trope in vault_tropes, case.name


def test_unknown_expected_field_is_rejected(ev: ModuleType) -> None:
    with pytest.raises(ValueError, match="unknown expected fields"):
        ev.Expected.from_json({"author": "x"})


def scores(ev: ModuleType, expected: dict[str, object], **plan: object) -> dict[str, bool]:
    from pydantic_evals.evaluators import EvaluatorContext

    from app.schemas import SearchPlan

    ctx = EvaluatorContext(
        name="t",
        inputs="q",
        metadata=None,
        expected_output={"expected": ev.Expected.from_json(expected)},
        output={"plan": SearchPlan(explanation="x", **plan), "vault": ev.load_vault()},
        duration=0.0,
        _span_tree=None,
        attributes={},
        metrics={},
    )
    return ev.PlanScores().evaluate(ctx)


def test_exact_plan_scores_everything(ev: ModuleType) -> None:
    s = scores(ev, {"genre": "Fantasy", "trope": "cozy"}, genre="Fantasy", trope="cozy")
    assert all(s.values())


def test_extra_filter_is_wrong(ev: ModuleType) -> None:
    s = scores(ev, {"genre": "Fantasy"}, genre="Fantasy", read_status="read")
    assert not s["field_read_status"] and not s["plan_exact"] and not s["results_match"]


def test_alternatives_are_accepted(ev: ModuleType) -> None:
    expected = {"min_rating": 5, "read_status": [None, "read"]}
    assert scores(ev, expected, min_rating=5)["plan_exact"]
    assert scores(ev, expected, min_rating=5, read_status="read")["plan_exact"]
    assert not scores(ev, expected, min_rating=5, read_status="unread")["plan_exact"]


def test_equivalent_text_is_right(ev: ModuleType) -> None:
    # "Le Guin" finds the same two books as the full name.
    assert scores(ev, {"text": "Ursula K. Le Guin"}, text="Le Guin")["field_text"]
    assert scores(ev, {"text": "Ursula K. Le Guin"}, text="ursula")["field_text"]  # same 2 books
    assert not scores(ev, {"text": "Tolkien"}, text="Herbert")["field_text"]
    assert not scores(ev, {"text": "Tolkien"})["field_text"]  # null is not "Tolkien"
    assert not scores(ev, {}, text="Tolkien")["field_text"]  # nor the other way round


def test_wrong_plan_can_still_return_the_right_books(ev: ModuleType) -> None:
    # Only one unread historical book: an extra "unread" filter changes nothing.
    s = scores(ev, {"genre": "Historical"}, genre="Historical", read_status="unread")
    assert not s["plan_exact"]
    assert s["results_match"]


def test_fake_model_run_end_to_end(ev: ModuleType, tmp_path: Path) -> None:
    result = ev.run("fake", concurrency=4, timeout=10)
    assert result["cases"] == 26
    assert all(r["error"] is None for r in result["rows"])
    summary = ev.summarize(result)
    assert 0 < summary["results_match"] <= 1
    # The report renders and the run is JSON-serialisable.
    assert "Right books returned" in ev.render([result])
    json.dumps(result)


def test_unusable_model_stops_with_the_reason(ev: ModuleType) -> None:
    with pytest.raises(SystemExit, match="AI is not configured"):
        ev.make_task("nonsense:model", 5)
