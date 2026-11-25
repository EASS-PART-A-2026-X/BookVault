# Book Vault AI service

FastAPI + [Pydantic AI](https://ai.pydantic.dev). It turns a reader's question in plain
English into a typed search over their own vault. It never touches the database: it calls
the Book Vault backend with the reader's own session cookie, so login and privacy rules
stay in one place.

```bash
uv sync
uv run uvicorn app.main:app --reload --port 8100   # http://localhost:8100/health
uv run pytest -v --cov=app                         # no API key: TestModel / FunctionModel
uv run ruff check . && uv run ruff format --check .
```

## `POST /search`

```http
POST /search            Cookie: bv_session=<the reader's session>
{"question": "unread fantasy with found family"}
```

```json
{
  "plan": {"genre": "Fantasy", "read_status": "unread", "min_rating": null,
           "trope": "found family", "text": null,
           "explanation": "Unread fantasy books tagged found family."},
  "books": [{"id": 3, "title": "Legends & Lattes", "author": "Travis Baldree", "...": "..."}]
}
```

How it works ([app/agent.py](app/agent.py)):

1. The agent's `output_type` is `SearchPlan`, so the model must answer with typed
   filters. Pydantic validates them: genre from the backend's enum, rating 1–5. An
   invalid answer goes back to the model to fix (up to 2 retries).
2. The tool `list_my_tropes` reads the reader's real tropes from the backend.
3. An output validator snaps the trope to the reader's spelling ("Found-Family" becomes
   "found family"). If the trope isn't one of theirs, it sends it back to the model
   (`ModelRetry`) with the list to choose from.
4. The service runs the plan as `GET /books?genre=…&is_read=…&min_rating=…&trope=…`
   with the reader's cookie, then matches `text` against title and author.

Each run is capped at 5 model requests (`UsageLimits`) and at `AI_TIMEOUT_SECONDS`.

| Situation | Status | `detail` |
|---|---|---|
| Missing, blank or more than 300-character question | 422 | FastAPI validation error |
| No session cookie, or an expired one | 401 | `Not logged in` (no model call is made) |
| `AI_MODEL` or the provider key missing | 503 | `AI is not configured: …` naming the variable |
| Backend unreachable, or its database down | 503 | `Book Vault is unavailable right now…` |
| Model slower than `AI_TIMEOUT_SECONDS` | 504 | `The AI took too long to answer…` |
| Provider error (auth, rate limit, 5xx) | 502 | `The AI provider failed to answer…` (the provider's body is never shown) |
| Output still invalid after retries, or the usage cap hit | 502 | `The AI couldn't turn that into a search…` |

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `BACKEND_URL` | `http://localhost:8000` | Where the Book Vault API is |
| `AI_MODEL` | *(empty: AI off)* | Pydantic AI model name, e.g. `anthropic:claude-haiku-5-5` |
| `ANTHROPIC_API_KEY` | | Key for the provider in `AI_MODEL` (read by Pydantic AI) |
| `AI_TIMEOUT_SECONDS` | `20` | Model call timeout |
| `BACKEND_TIMEOUT_SECONDS` | `5` | Backend call timeout |

An invalid value (e.g. `AI_TIMEOUT_SECONDS=soon`) stops the service at startup with a
message naming the variable. A missing `AI_MODEL` or provider key does not: `/health`
reports `"ai": "not_configured"` with the reason, and AI requests answer 503.
