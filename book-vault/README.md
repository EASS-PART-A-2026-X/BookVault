# Personal Book Vault & Reading Tracker

A REST API for keeping track of the books you own: what genre they are, whether
you've read them, how you rated them, and what you thought.

Built with **FastAPI**, **Pydantic v2**, **SQLAlchemy 2.0** and **SQLite**, managed
with **uv**, tested with **pytest**, and shipped as a **Docker** image.

## Features

- Accounts: sign up, log in, log out (Argon2 password hashes, httpOnly session cookie)
- Every user has their own book list
- Social: search people, view profiles and reviews, follow. Public profiles can be
  followed at once; private ones need an accepted follow request
- Full CRUD for books (`/books`)
- Tag books with free-form **tropes** (e.g. `enemies to lovers`, `found family`)
- Filter the list by `genre`, `is_read`, `min_rating` and `trope` (filters can be combined)
- Input validation with clear `422` errors:
  - `title` and `author` are required and can't be empty or whitespace-only
  - `genre` must be one of: `Fantasy`, `Romance`, `Sci-Fi`, `Thriller`, `Non-Fiction`,
    `Mystery`, `Historical`
  - `rating` is optional, but if given must be an integer from 1 to 5
  - `tropes` is an optional list of up to 20 tropes, each 1–50 characters
- Partial updates: `PUT` changes only the fields you send
- A rating and review are allowed even if the book isn't marked as read
- Data is stored in a SQLite file and survives restarts

## Data model

| Field        | Type            | Notes                                          |
|--------------|-----------------|------------------------------------------------|
| `id`         | integer         | Generated                                      |
| `title`      | string          | Required, non-empty (surrounding spaces trimmed) |
| `author`     | string          | Required, non-empty (surrounding spaces trimmed) |
| `genre`      | enum            | Required, one of the genres above              |
| `rating`     | integer \| null | 1–5, optional                                  |
| `is_read`    | boolean         | Defaults to `false`                            |
| `review`     | string \| null  | Optional                                       |
| `tropes`     | list of strings | Optional, default `[]`. Stored normalised: trimmed, single spaces, lower case, no duplicates. Max 20, each 1–50 chars |
| `created_at` | datetime        | Set on creation (UTC)                          |
| `updated_at` | datetime        | Refreshed on every update (UTC)                |

## Endpoints

| Method   | Path               | Description                       | Success | Errors     |
|----------|--------------------|-----------------------------------|---------|------------|
| `POST`   | `/books`           | Create a book                     | `201`   | `422`      |
| `GET`    | `/books`           | List books (optional filters)     | `200`   | `422`      |
| `GET`    | `/books/{book_id}` | Get one book                      | `200`   | `404`      |
| `PUT`    | `/books/{book_id}` | Partially update a book           | `200`   | `404`, `422` |
| `DELETE` | `/books/{book_id}` | Delete a book                     | `204`   | `404`      |
| `GET`    | `/tropes`          | Your tropes, with book counts     | `200`   |            |
| `POST`   | `/auth/register`   | Create an account and log in      | `201`   | `409`, `422` |
| `POST`   | `/auth/login`      | Log in (sets the session cookie)  | `200`   | `401`      |
| `POST`   | `/auth/logout`     | Log out (ends the session)        | `204`   |            |
| `GET`    | `/auth/me`         | The logged-in account             | `200`   | `401`      |
| `POST`   | `/auth/password`   | Change password (needs the current one; logs out other devices) | `204` | `400`, `401`, `422` |
| `PUT`    | `/auth/email`      | Set / change the private email (needs the password) | `200` | `400`, `401`, `409`, `422` |
| `POST`   | `/auth/password-reset` | Email a reset link (same answer whether or not the email has an account) | `202` | `422` |
| `POST`   | `/auth/password-reset/confirm` | Set a new password with the emailed token (single use; logs out everywhere) | `204` | `400`, `422` |
| `PATCH`  | `/users/me`        | Change display name, bio, public/private (going public accepts pending requests) | `200` | `401`, `422` |
| `GET`    | `/users?q=`        | Search people by username or display name | `200` | `422` |
| `GET`    | `/users/{username}` | Profile: name, bio, counts, your follow status | `200` | `404` |
| `GET`    | `/users/{username}/books` | Their books and reviews | `200` | `403` (private), `404` |
| `GET`    | `/users/{username}/followers`, `/following` | Accepted followers / follows | `200` | `403`, `404` |
| `POST`   | `/users/{username}/follow` | Follow (public) or request to follow (private) | `200` | `400` (yourself), `404` |
| `DELETE` | `/users/{username}/follow` | Unfollow or cancel a request | `204` | `404` |
| `DELETE` | `/users/me/followers/{username}` | Remove one of your followers | `204` | `404` |
| `GET`    | `/follow-requests` | Requests waiting for your answer | `200` | |
| `POST`   | `/follow-requests/{username}/accept`, `/decline` | Answer a request | `204` | `404` |
| `GET`    | `/health`          | Health check (also pings the DB)  | `200`   | `503`      |

**Who sees what.** Any logged-in user can find you and see your name, bio and counts.
Your books and reviews are visible to you, to everyone if your profile is public, and
otherwise only to followers whose request you accepted. Profiles start private.

Every endpoint except `/health`, `/auth/register|login|logout` and the two
`/auth/password-reset` endpoints needs a logged-in user; `/books` and `/tropes` (otherwise `401
{"detail": "Not authenticated"}`) and only ever sees that user's books. Another user's
book id answers `404`, exactly like a missing one. `/health` stays public.

### Examples

The examples assume the server is running on `http://localhost:8000`. curl keeps the
session cookie in `cookies.txt` (`-c` saves it, `-b` sends it):

```bash
curl -c cookies.txt -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "gal", "email": "gal@example.com", "password": "correct horse battery"}'
```

Add `-b cookies.txt` to every call below so curl sends the cookie (left out for
brevity).

**Password reset.** The email given at sign-up is private (only returned by `/auth/me`) and
only used for reset links. `POST /auth/password-reset {"email": ...}` always answers `202`
with the same message; if the email has an account, a link to
`APP_BASE_URL/reset-password?token=...` is sent (at most 3 per account per hour). The token
works once, for `PASSWORD_RESET_MINUTES` (30), and only its SHA-256 hash is stored. How mail
goes out is set by `EMAIL_BACKEND` (`console`, `file` or `smtp`, see `app/mailer.py`).

Usernames are 3–30 characters of `a-z 0-9 _ .` (stored lower case); passwords 8–128
characters. The first account created also takes over any books that existed before
accounts were added.

**Create a book**

```bash
curl -X POST http://localhost:8000/books \
  -H "Content-Type: application/json" \
  -d '{"title": "Dune", "author": "Frank Herbert", "genre": "Sci-Fi", "rating": 5, "is_read": true, "review": "A classic."}'
```

```json
{"title": "Dune", "author": "Frank Herbert", "genre": "Sci-Fi", "rating": 5, "is_read": true,
 "review": "A classic.", "id": 1, "created_at": "2026-10-25T18:20:37.632554",
 "updated_at": "2026-10-25T18:20:37.632561"}
```

**List books, with optional filters**

```bash
curl http://localhost:8000/books
curl "http://localhost:8000/books?genre=Fantasy"
curl "http://localhost:8000/books?is_read=false"
curl "http://localhost:8000/books?min_rating=4"          # unrated books are excluded
curl "http://localhost:8000/books?genre=Sci-Fi&is_read=true&min_rating=4"
curl "http://localhost:8000/books?trope=enemies%20to%20lovers"   # case-insensitive
```

**Tropes**

```bash
curl -X POST http://localhost:8000/books \
  -H "Content-Type: application/json" \
  -d '{"title": "Pride and Prejudice", "author": "Jane Austen", "genre": "Romance", "tropes": ["Enemies to Lovers", "slow burn"]}'
# "tropes": ["enemies to lovers", "slow burn"]

curl http://localhost:8000/tropes
# [{"name": "enemies to lovers", "book_count": 1}, {"name": "slow burn", "book_count": 1}]

curl -X PUT http://localhost:8000/books/1 -H "Content-Type: application/json" \
  -d '{"tropes": []}'            # replace the list ([] removes all tropes)
```

**Get one book**

```bash
curl http://localhost:8000/books/1
```

**Update a book** (only the fields you send are changed)

```bash
curl -X PUT http://localhost:8000/books/1 \
  -H "Content-Type: application/json" \
  -d '{"rating": 4, "review": "Even better the second time."}'
```

**Account**

```bash
curl http://localhost:8000/auth/me
curl -X PATCH http://localhost:8000/users/me -H "Content-Type: application/json" \
  -d '{"display_name": "Gal", "bio": "Fantasy and mysteries", "is_public": true}'
curl -X POST http://localhost:8000/auth/logout
curl -X POST http://localhost:8000/auth/login -c cookies.txt -H "Content-Type: application/json" \
  -d '{"username": "gal", "password": "correct horse battery"}'
```

Send `null` for `rating` or `review` to clear them. `tropes` replaces the whole list
when sent; send `[]` to remove them all. `title`, `author`, `genre`, `is_read` and
`tropes` can be left out but can't be set to `null`.

**Delete a book**

```bash
curl -X DELETE http://localhost:8000/books/1      # 204 No Content
```

**Errors**

```bash
curl http://localhost:8000/books/999
# 404 {"detail": "Book not found"}

curl -X POST http://localhost:8000/books \
  -H "Content-Type: application/json" \
  -d '{"title": "   ", "author": "X", "genre": "Horror", "rating": 6}'
# 422 with one entry per invalid field (title, genre, rating)
```

## Setup

Requires [uv](https://docs.astral.sh/uv/) (it installs Python 3.11 for you if needed).

```bash
cd book-vault
uv sync            # creates .venv and installs runtime + dev dependencies from uv.lock
```

## Running the server

```bash
uv run uvicorn app.main:app --reload
```

- API: <http://localhost:8000>
- Interactive docs (Swagger UI): <http://localhost:8000/docs>
- Alternative docs (ReDoc): <http://localhost:8000/redoc>

The database is created automatically at `./data/books.db`. To use a different
location, set `DATABASE_URL`:

```bash
DATABASE_URL=sqlite:///./my-books.db uv run uvicorn app.main:app --reload
```

### Configuration

| Variable       | Default                    | Purpose                                                  |
|----------------|----------------------------|----------------------------------------------------------|
| `DATABASE_URL` | `sqlite:///./data/books.db` | Where the SQLite database lives                          |
| `SESSION_DAYS` | `30`                       | How long a login lasts |
| `COOKIE_SECURE`| `false`                    | Set `true` behind HTTPS so the session cookie is only sent over HTTPS |
| `CORS_ORIGINS` | `http://localhost:5173`    | Comma-separated browser origins allowed to call the API (the Vite dev server by default). Setting it replaces the default; an empty value allows none |

```bash
CORS_ORIGINS="http://localhost:5173,http://localhost:4173" uv run uvicorn app.main:app --reload
curl http://localhost:8000/health        # {"status":"ok"}, or 503 if the database is unreachable
```

## Running the tests

```bash
uv run pytest -v
```

Each test runs against its own fresh in-memory database, so tests never touch
`./data/books.db`. The suite covers CRUD, every filter and filter combinations,
validation errors, 404s (including that they're documented in OpenAPI), the
`get_db` dependency, and persistence across an engine restart.

Coverage report (terminal + HTML in `htmlcov/`):

```bash
uv run pytest --cov=app --cov-report=term-missing --cov-report=html
```

Lint and format checks:

```bash
uv run ruff check .
uv run ruff format --check .
```

## Docker

Build the image:

```bash
docker build -t book-vault .
```

Run it with a named volume so the database survives container restarts and removal:

```bash
docker run -d --name book-vault -p 8000:8000 -v book-vault-data:/app/data book-vault
```

Then open <http://localhost:8000/docs>. Useful follow-ups:

```bash
docker logs -f book-vault                 # view server logs
docker rm -f book-vault                   # remove the container (data stays in the volume)
docker volume rm book-vault-data          # delete the data for good
```

The image is a multi-stage build: dependencies are installed with uv in a builder
stage, and the runtime stage is `python:3.11-slim` running as a non-root user.

## Verification

[docs/proof/PROOF.md](docs/proof/PROOF.md) collects evidence that the project works.
It includes:

- a lint and test run (all tests passing)
- the test coverage report (100%)
- a live curl session, including a server restart
- Swagger UI screenshots of real requests
- a Docker run that shows the data survives container restarts

## Project structure

```
book-vault/
├── app/
│   ├── main.py        # FastAPI app and endpoints
│   ├── database.py    # engine, session factory, get_db dependency
│   ├── models.py      # SQLAlchemy ORM models (storage)
│   └── schemas.py     # Pydantic schemas (API request/response contract)
├── tests/
│   ├── conftest.py    # in-memory test DB fixture
│   └── test_main.py   # API tests
├── docs/proof/        # verification evidence (PROOF.md, outputs, screenshots)
├── data/              # SQLite database (created at runtime, gitignored)
├── pyproject.toml     # dependencies and tool config
├── uv.lock            # locked dependency versions
├── Dockerfile
└── .dockerignore
```
