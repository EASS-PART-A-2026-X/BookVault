# CLAUDE.md

Personal Book Vault & Reading Tracker: a FastAPI + SQLAlchemy 2.0 + SQLite REST API,
managed with uv. All commands below run from the `book-vault/` directory.

## Commands

```bash
uv sync                                   # install runtime + dev deps from uv.lock
uv add <pkg>                              # add a runtime dependency
uv add --dev <pkg>                        # add a dev dependency
uv run uvicorn app.main:app --reload      # run the dev server (docs at /docs)
uv run pytest -v                          # run the tests
uv run pytest tests/test_main.py::test_name -v   # run a single test
uv run ruff check .                       # lint
uv run ruff format .                      # format
docker build -t book-vault .              # build the image
docker run -d --name book-vault -p 8000:8000 -v book-vault-data:/app/data book-vault
```

Never edit `uv.lock` by hand. Change dependencies with `uv add` / `uv remove`.

## Layout

```
app/
  main.py       FastAPI app, lifespan (create_all + migrate), CORS, book/trope endpoints, GET /health
  auth.py       accounts + sessions: Argon2 hashing, cookie sessions, current_user dependency,
                /auth/register|login|logout|me, /auth/password, /auth/email,
                /auth/password-reset (+ /confirm): emailed single-use links, hashed tokens
  mailer.py     EMAIL_BACKEND console|file|smtp (stdlib smtplib), APP_BASE_URL; get_mailer()
                is a dependency, tests swap in MemoryMailer (the `outbox` fixture)
  social.py     PATCH /users/me, user search, profiles, others' books, follow / follow requests
  migrations.py migrate(engine): small, idempotent ALTERs for databases made by older versions
  database.py   DATABASE_URL (default sqlite:///./data/books.db), engine, SessionLocal, Base, get_db
  models.py     SQLAlchemy ORM models (typed Mapped[...] style): User, AuthSession, PasswordReset,
                Follow, Book, Trope, book_tropes
  schemas.py    Pydantic v2 schemas: Genre enum, BookCreate, BookUpdate, BookRead, TropeCount
  seed.py       `python -m app.seed`: sample readers + books from seed_data.json, only into an
                EMPTY database (no users, no books), in one transaction; Compose's `seed` job
tests/
  conftest.py   fresh in-memory SQLite (StaticPool) per test; `client` = logged-in user "reader",
                `make_client("alice")` = another logged-in user, `anon_client` = logged out
  test_auth.py  accounts, sessions, ownership, migrations
  test_password_reset.py  emails on accounts, reset by email, change password / email
  test_mailer.py mail backends and their settings (no real email)
  test_social.py search, profiles, follow / requests, visibility
  test_main.py  API tests, grouped by CRUD / filters / validation / 404 / persistence
  test_seed.py  seeding: first run, rerun no-op, never touches existing data, bad input
data/           runtime SQLite file (gitignored, also the Docker volume at /app/data)
```

## Conventions

- **Schemas vs models.** `models.py` describes how data is stored. `schemas.py`
  describes the API contract. Endpoints take schemas as input and return ORM objects
  with `response_model=` set to a schema, never raw dicts. Put validation in the
  schemas, not in the endpoints.
- **Database access goes through `get_db`.** Endpoints take `db: Session = Depends(get_db)`.
  Never create a `SessionLocal()` directly in app code. This is what lets the tests
  swap in an in-memory database.
- **Type hints everywhere.** Annotate all function parameters and return types. Use
  SQLAlchemy 2.0 `Mapped[...]` / `mapped_column` and modern syntax (`X | None`, `list[X]`).
- **Updates are partial.** `PUT` applies `payload.model_dump(exclude_unset=True)` so
  that omitted fields are left alone. New optional fields on `BookUpdate` must
  follow the same pattern. If a new column is NOT NULL, add it to the explicit-null
  check in `BookUpdate`.
- **Errors.** Use `get_book_or_404()` for id lookups, so the 404 message is always
  `BOOK_NOT_FOUND`. Every `/books/{book_id}` route declares
  `responses=NOT_FOUND_RESPONSE` so the 404 is documented in OpenAPI, and
  `test_404_documented_in_openapi` checks this. Leave validation errors to FastAPI's
  default `422` response.
- **Auth.** Every endpoint that touches user data takes `user: User = Depends(current_user)`
  and filters by `owner_id == user.id`. Fetch single books with
  `get_book_or_404(db, book_id, user)`: someone else's book is a 404, never a 403, so ids
  don't leak. Declare `responses=UNAUTHORIZED_RESPONSE` (already in `NOT_FOUND_RESPONSE`).
  Passwords only via `hash_password`/`verify_password`; never return or log them. The
  session cookie is httpOnly + SameSite=Lax; only `sha256(token)` is stored. Login errors
  are always the same 401 message (don't reveal whether a username exists). Emails are
  private (only in `UserRead`, the own account) and never logged with secrets. Reset
  requests always answer the same 202. Changing password or email needs the current
  password and answers 400 (not 401) when it's wrong. Never send real email in tests:
  the `outbox` fixture captures it.
- **Social visibility** is decided only by `can_view_books(db, viewer, owner)` in
  `app/social.py` (self, public profile, or accepted follow). Any endpoint exposing
  another user's books, reviews or follower lists must check it and answer `403
  PROFILE_PRIVATE`. Names, bio and counts are public to logged-in users. Follows are
  one row per (follower, followee) with status `pending`/`accepted`; declining deletes it.
- **Schema changes.** New tables: just add the model (`create_all` makes them). New
  columns on existing tables: add an idempotent step to `app/migrations.py` plus a test
  that upgrades an old-schema database (see `test_auth.py`).
- **Tropes.** Many-to-many: `Book.tropes` <-> `Trope` via `book_tropes`. Names are
  normalised with `normalize_trope()` (trim, collapse spaces, lower case) in the schemas
  and in the `?trope=` filter, so each trope is stored once. Endpoints never assign
  `tropes` with `setattr`; they go through `get_or_create_tropes()`. `GET /tropes` only
  lists tropes used by at least one of the current user's books.
- **CORS.** Allowed origins come only from `CORS_ORIGINS` (comma-separated, default
  `http://localhost:5173`), parsed by `parse_cors_origins()`. Never use `"*"`. If a new
  endpoint uses a new HTTP method, add it to `allow_methods`.
- **Health.** `GET /health` returns `{"status": "ok"}` only if `SELECT 1` succeeds, otherwise
  `503`. Docker healthchecks depend on it, so keep it cheap and unauthenticated.
- **Seed data** (`app/seed_data.json`) is validated with the API schemas (`BookCreate`,
  `Username`, ...). Seeding must stay a no-op on any database that has users or books.
- **Tests are required.** Every new endpoint needs tests for success, validation
  (`422`) and not-found (`404`) cases. Use the `client` fixture and never point tests
  at `./data/books.db`.
- **Before finishing any change**, run these and make sure both pass:
  ```bash
  uv run pytest -v
  uv run ruff check .
  ```
