"""Evaluate the AI search (question -> SearchPlan -> books) on eval/dataset.jsonl.

    cd ai-service
    uv run python ../eval/run_eval.py --model fake                        # offline baseline
    uv run --env-file ../.env python ../eval/run_eval.py \\
        --model anthropic:claude-haiku-5-5                                # real model (key in .env)
    uv run python ../eval/run_eval.py --report                            # rebuild results.md

What runs: the real Pydantic AI agent from ai-service (same instructions, tool, output
validator, retries and limits as production). Only the backend is replaced: an in-memory
copy of the seeded `demo` vault (book-vault/app/seed_data.json), so every model sees the
same 16 books and 22 tropes and the scores depend on the model alone.

Scores per case (pydantic-evals evaluators):
- field_genre / field_read_status / field_min_rating / field_trope / field_text: the field
  is right. `expected` may list several acceptable values; a field not listed must be
  null. `text` counts as right when it matches the same books as the expected text
  (so "Le Guin" and "Ursula K. Le Guin" are equally right).
- plan_exact: all five fields right.
- results_match (headline metric): the plan returns exactly the books a right plan returns.
A case whose run raises (provider error, timeout, unusable output) counts as a failure.
"""

from __future__ import annotations

import argparse
import itertools
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

EVAL_DIR = Path(__file__).resolve().parent
ROOT = EVAL_DIR.parent
sys.path.insert(0, str(ROOT / "ai-service"))

import httpx  # noqa: E402
from app.agent import VaultDeps, plan_search  # noqa: E402
from app.backend import VaultClient, matches_text, plan_to_params  # noqa: E402
from app.config import load_settings, resolve_model  # noqa: E402
from app.schemas import SearchPlan, VaultBook  # noqa: E402
from pydantic_evals import Case, Dataset  # noqa: E402
from pydantic_evals.evaluators import Evaluator, EvaluatorContext  # noqa: E402

DATASET = EVAL_DIR / "dataset.jsonl"
RESULTS_DIR = EVAL_DIR / "results"
RESULTS_MD = EVAL_DIR / "results.md"
SEED_FILE = ROOT / "book-vault" / "app" / "seed_data.json"
SEED_USER = "demo"
FIELDS = ("genre", "read_status", "min_rating", "trope", "text")
SESSION = "eval-session"


# ---- the demo vault, in memory ------------------------------------------------


def load_vault() -> list[VaultBook]:
    users = json.loads(SEED_FILE.read_text(encoding="utf-8"))["users"]
    raw = next(u for u in users if u["username"] == SEED_USER)["books"]
    return [
        VaultBook(
            id=i,
            title=b["title"],
            author=b["author"],
            genre=b["genre"],
            rating=b.get("rating"),
            is_read=b.get("is_read", False),
            review=b.get("review"),
            tropes=sorted(" ".join(t.split()).lower() for t in b.get("tropes", [])),
            created_at="2026-01-01T00:00:00",
            updated_at="2026-01-01T00:00:00",
        )
        for i, b in enumerate(raw, start=1)
    ]


def filter_books(books: list[VaultBook], params: dict[str, Any]) -> list[VaultBook]:
    """The backend's GET /books filters (genre, is_read, min_rating, trope)."""
    return [
        b
        for b in books
        if ("genre" not in params or b.genre.value == params["genre"])
        and ("is_read" not in params or b.is_read == (str(params["is_read"]) == "true"))
        and ("min_rating" not in params or (b.rating or 0) >= int(params["min_rating"]))
        and ("trope" not in params or params["trope"] in b.tropes)
    ]


def vault_transport(books: list[VaultBook]) -> httpx.MockTransport:
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/tropes":
            names = sorted({t for b in books for t in b.tropes})
            return httpx.Response(200, json=[{"name": n, "book_count": 1} for n in names])
        if request.url.path == "/books":
            found = filter_books(books, dict(request.url.params))
            return httpx.Response(200, json=[b.model_dump(mode="json") for b in found])
        return httpx.Response(404, json={"detail": "Not Found"})

    return httpx.MockTransport(handle)


def books_for(plan: SearchPlan, books: list[VaultBook]) -> frozenset[str]:
    """Titles a plan returns, exactly as the AI service computes them."""
    found = filter_books(books, plan_to_params(plan))
    return frozenset(b.title for b in found if matches_text(b, plan.text))


# ---- dataset ------------------------------------------------------------------


@dataclass(frozen=True)
class Expected:
    """Acceptable values per field (a field not given in the dataset must be null)."""

    allowed: dict[str, tuple[Any, ...]]

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> Expected:
        unknown = set(raw) - set(FIELDS)
        if unknown:
            raise ValueError(f"unknown expected fields: {sorted(unknown)}")
        allowed = {}
        for field in FIELDS:
            value = raw.get(field)
            allowed[field] = tuple(value) if isinstance(value, list) else (value,)
        return cls(allowed)

    def plans(self) -> list[SearchPlan]:
        """Every right plan (one per combination of acceptable values)."""
        combos = itertools.product(*(self.allowed[f] for f in FIELDS))
        return [
            SearchPlan(explanation="expected", **dict(zip(FIELDS, c, strict=True))) for c in combos
        ]


def load_dataset(path: Path = DATASET) -> Dataset[str, dict[str, Any], dict[str, Any]]:
    cases = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        row = json.loads(line)
        expected = Expected.from_json(row["expected"])
        expected.plans()  # every expected value must be a valid SearchPlan value
        cases.append(
            Case(
                name=row["id"],
                inputs=row["question"],
                expected_output={"expected": expected},
                metadata={"category": row["category"], "line": line_no},
            )
        )
    names = [c.name for c in cases]
    if len(set(names)) != len(names):
        raise ValueError("duplicate case ids in the dataset")
    return Dataset(name="ai-search", cases=cases, evaluators=[PlanScores()])


# ---- scoring ------------------------------------------------------------------


def text_ok(value: str | None, allowed: tuple[Any, ...], books: list[VaultBook]) -> bool:
    """Null must match null; otherwise any text that finds the same books is right."""

    def found(text: str) -> frozenset[str]:
        return books_for(SearchPlan(explanation="", text=text), books)

    for want in allowed:
        if want is None or value is None:
            if want is None and value is None:
                return True
        elif found(value) == found(want):
            return True
    return False


@dataclass
class PlanScores(Evaluator[str, dict[str, Any], dict[str, Any]]):
    def evaluate(
        self, ctx: EvaluatorContext[str, dict[str, Any], dict[str, Any]]
    ) -> dict[str, bool]:
        expected: Expected = ctx.expected_output["expected"]  # type: ignore[index]
        plan: SearchPlan = ctx.output["plan"]
        books: list[VaultBook] = ctx.output["vault"]
        scores = {}
        for field in FIELDS:
            value = getattr(plan, field)
            if field == "text":
                ok = text_ok(value, expected.allowed["text"], books)
            else:
                ok = value in expected.allowed[field]
            scores[f"field_{field}"] = ok
        scores["plan_exact"] = all(scores.values())
        right_sets = {books_for(p, books) for p in expected.plans()}
        scores["results_match"] = books_for(plan, books) in right_sets
        return scores


# ---- running --------------------------------------------------------------------


def make_task(model_name: str, timeout: float):
    status = resolve_model(load_settings({"AI_MODEL": model_name}))
    if status.model is None:
        raise SystemExit(f"cannot use model {model_name!r}: {status.reason}")
    model = status.model
    books = load_vault()

    async def task(question: str) -> dict[str, Any]:
        async with httpx.AsyncClient(
            base_url="http://vault", transport=vault_transport(books)
        ) as http:
            deps = VaultDeps(VaultClient(http=http, session=SESSION))
            plan = await plan_search(question, deps, model, timeout_seconds=timeout)
        return {"plan": plan, "vault": books}

    return task


def run(model_name: str, concurrency: int, timeout: float) -> dict[str, Any]:
    dataset = load_dataset()
    started = time.perf_counter()
    report = dataset.evaluate_sync(
        make_task(model_name, timeout), max_concurrency=concurrency, progress=False
    )
    elapsed = time.perf_counter() - started
    books = load_vault()

    rows = []
    for case in report.cases:
        plan: SearchPlan = case.output["plan"]
        rows.append(
            {
                "id": case.name,
                "category": case.metadata["category"],
                "question": case.inputs,
                "plan": plan.model_dump(mode="json"),
                "books": sorted(books_for(plan, books)),
                "expected": {
                    f: list(v) if len(v) > 1 else v[0]
                    for f, v in case.expected_output["expected"].allowed.items()
                },
                "scores": {k: bool(r.value) for k, r in case.assertions.items()},
                "seconds": round(case.task_duration, 3),
                "error": None,
            }
        )
    for failure in report.failures:
        rows.append(
            {
                "id": failure.name,
                "category": failure.metadata["category"],
                "question": failure.inputs,
                "plan": None,
                "books": None,
                "expected": None,
                "scores": {},
                "seconds": None,
                "error": failure.error_message.splitlines()[0][:300],
            }
        )
    order = {c.name: i for i, c in enumerate(dataset.cases)}
    rows.sort(key=lambda r: order[r["id"]])
    return {
        "model": model_name,
        "date": datetime.now(UTC).strftime("%Y-%m-%d"),
        "cases": len(rows),
        "wall_seconds": round(elapsed, 1),
        "rows": rows,
    }


# ---- report ---------------------------------------------------------------------


def summarize(result: dict[str, Any]) -> dict[str, Any]:
    rows = result["rows"]
    n = len(rows)

    def rate(key: str, subset: list[dict[str, Any]] | None = None) -> float:
        subset = rows if subset is None else subset
        return sum(1 for r in subset if r["scores"].get(key)) / len(subset) if subset else 0.0

    durations = [r["seconds"] for r in rows if r["seconds"] is not None]
    categories: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        categories.setdefault(r["category"], []).append(r)
    return {
        "n": n,
        "results_match": rate("results_match"),
        "plan_exact": rate("plan_exact"),
        "fields": {f: rate(f"field_{f}") for f in FIELDS},
        "errors": sum(1 for r in rows if r["error"]),
        "median_seconds": sorted(durations)[len(durations) // 2] if durations else None,
        "categories": {c: (rate("results_match", rs), len(rs)) for c, rs in categories.items()},
    }


def pct(x: float) -> str:
    return f"{x * 100:.0f}%"


def describe_plan(plan: dict[str, Any] | None) -> str:
    if plan is None:
        return "—"
    parts = [f"{f}={plan[f]!r}" for f in FIELDS if plan.get(f) is not None]
    return ", ".join(parts) or "(no filters)"


def describe_expected(expected: dict[str, Any] | None) -> str:
    if expected is None:
        return "—"
    parts = [f"{f}={v!r}" for f, v in expected.items() if v is not None]
    return ", ".join(parts) or "(no filters)"


def render(results: list[dict[str, Any]]) -> str:
    summaries = [(r, summarize(r)) for r in results]
    out = ["| Metric | " + " | ".join(f"`{r['model']}`" for r, _ in summaries) + " |"]
    out.append("|---|" + "---|" * len(summaries))
    out.append(
        "| **Right books returned** (headline) | "
        + " | ".join(f"**{pct(s['results_match'])}**" for _, s in summaries)
        + " |"
    )
    out.append(
        "| Plan exactly right | " + " | ".join(pct(s["plan_exact"]) for _, s in summaries) + " |"
    )
    for f in FIELDS:
        out.append(
            f"| `{f}` right | " + " | ".join(pct(s["fields"][f]) for _, s in summaries) + " |"
        )
    out.append(
        "| Errors (no answer) | " + " | ".join(str(s["errors"]) for _, s in summaries) + " |"
    )
    out.append(
        "| Median time per question | "
        + " | ".join(
            f"{s['median_seconds']:.2f}s" if s["median_seconds"] is not None else "—"
            for _, s in summaries
        )
        + " |"
    )
    out.append("| Run | " + " | ".join(f"{r['date']}, {s['n']} cases" for r, s in summaries) + " |")

    out += ["", "**Right books returned, by category**", ""]
    out.append("| Category | Cases | " + " | ".join(f"`{r['model']}`" for r, _ in summaries) + " |")
    out.append("|---|---|" + "---|" * len(summaries))
    for category, (_, count) in summaries[0][1]["categories"].items():
        cells = [pct(s["categories"].get(category, (0.0, 0))[0]) for _, s in summaries]
        out.append(f"| {category} | {count} | " + " | ".join(cells) + " |")

    for result, _ in summaries:
        wrong = [r for r in result["rows"] if not r["scores"].get("results_match")]
        out += ["", f"**Cases `{result['model']}` got wrong ({len(wrong)})**", ""]
        if not wrong:
            out.append("None.")
            continue
        out.append("| Case | Question | Expected | Got |")
        out.append("|---|---|---|---|")
        for r in wrong:
            got = f"error: {r['error']}" if r["error"] else describe_plan(r["plan"])
            question = r["question"].replace("|", "\\|")
            out.append(f"| `{r['id']}` | {question} | {describe_expected(r['expected'])} | {got} |")
    return "\n".join(out)


START, END = "<!-- results:start -->", "<!-- results:end -->"


def write_report() -> None:
    files = sorted(RESULTS_DIR.glob("*.json"))
    if not files:
        raise SystemExit("no results yet: run with --model first")
    results = [json.loads(f.read_text(encoding="utf-8")) for f in files]
    # Baseline (fake) last, so the real model is the first column.
    results.sort(key=lambda r: r["model"] == "fake")
    note = "<!-- generated by eval/run_eval.py --report; do not edit by hand -->"
    block = f"{START}\n{note}\n\n{render(results)}\n\n{END}"
    text = (
        RESULTS_MD.read_text(encoding="utf-8")
        if RESULTS_MD.exists()
        else f"# AI eval results\n\n{START}\n{END}\n"
    )
    pattern = re.compile(re.escape(START) + ".*?" + re.escape(END), re.DOTALL)
    RESULTS_MD.write_text(pattern.sub(lambda _: block, text), encoding="utf-8")
    print(f"wrote {RESULTS_MD.relative_to(ROOT)}")


def result_path(model_name: str) -> Path:
    return RESULTS_DIR / (re.sub(r"[^a-zA-Z0-9.-]+", "_", model_name) + ".json")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--model", help='AI_MODEL to evaluate, e.g. "fake" or "anthropic:claude-haiku-5-5"'
    )
    parser.add_argument(
        "--report", action="store_true", help="rebuild eval/results.md from eval/results/*.json"
    )
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--timeout", type=float, default=30.0, help="seconds per question")
    args = parser.parse_args(argv)
    if not args.model and not args.report:
        parser.error("give --model and/or --report")
    if args.model:
        result = run(args.model, args.concurrency, args.timeout)
        RESULTS_DIR.mkdir(exist_ok=True)
        path = result_path(args.model)
        path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        s = summarize(result)
        print(
            f"{args.model}: right books {pct(s['results_match'])}, "
            f"plan exact {pct(s['plan_exact'])}, errors {s['errors']}/{s['n']} "
            f"-> {path.relative_to(ROOT)}"
        )
    if args.report:
        write_report()
    return 0


if __name__ == "__main__":
    sys.exit(main())
