# Book Vault AI service

FastAPI + [Pydantic AI](https://ai.pydantic.dev). It turns a reader's question in plain
English into a typed search over their own vault. It never touches the database: it calls
the Book Vault backend with the reader's own session cookie, so login and privacy rules
stay in one place.

```bash
uv sync
uv run uvicorn app.main:app --reload --port 8100   # http://localhost:8100/health
uv run pytest -v                                   # no API key needed (TestModel)
uv run ruff check . && uv run ruff format --check .
```

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
