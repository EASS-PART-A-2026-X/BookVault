# Book Vault — personal library & reading tracker

Track the books you own: genre, whether you've read them, a 1–5 star rating, a review,
and free-form **tropes** (e.g. *enemies to lovers*, *found family*). Filter by genre,
read status, minimum rating and trope, or just **ask in plain English** ("unread fantasy
with found family").

Every reader has an **account** and a private vault. Find other readers, read their
reviews and **follow** them: public profiles can be followed at once, private ones need
an accepted follow request.

- **EX1 — backend:** a FastAPI + SQLAlchemy + SQLite REST API in [`book-vault/`](book-vault/)
  ([API docs and examples](book-vault/README.md)).
- **EX2 — frontend:** a React + TypeScript single-page app in [`frontend/`](frontend/),
  integrated with the API, with full loading/empty/error states, component tests, an
  end-to-end flow against the real backend, and a one-command Docker Compose stack.
- **EX3 — AI service and operations:** a Pydantic AI search service in
  [`ai-service/`](ai-service/), seed data, failure handling, CI, an AI eval, a runbook
  and a live demo. See [EX3 deliverables](#ex3-deliverables).

Evidence that it all works: [docs/proof/social/PROOF-SOCIAL.md](docs/proof/social/PROOF-SOCIAL.md)
for accounts and social features. Earlier, as submitted:
EX2 [docs/proof/ex2/PROOF-EX2.md](docs/proof/ex2/PROOF-EX2.md), EX1
[book-vault/docs/proof/PROOF.md](book-vault/docs/proof/PROOF.md).

![Book list](docs/proof/social/04-book-list.png)

## EX3 deliverables

**Live demo:** _not deployed yet: see the [deploy guide](docs/deploy.md)_ ·
**Video:** _not recorded yet: see the [script](docs/video-script.md)_

| # | Requirement | Where | How to check |
|---|---|---|---|
| 1 | Three application services | [`frontend/`](frontend/) (React + nginx), [`book-vault/`](book-vault/) (FastAPI + SQLite), [`ai-service/`](ai-service/) (FastAPI + Pydantic AI). Each has its own Dockerfile, `/health` and env config. | `docker compose ps` |
| 2 | Pydantic AI functionality | [`ai-service/app/agent.py`](ai-service/app/agent.py): typed `output_type=SearchPlan`, the `list_my_tropes` tool that reads the reader's data through the backend, an output validator with `ModelRetry`, a timeout and a usage cap. Every error maps to a clear status: [error table](ai-service/README.md#post-search). Provider and key come only from env; the `fake` model works offline. | The **Ask** page |
| 3 | Docker Compose | [`docker-compose.yml`](docker-compose.yml): healthchecks, `depends_on` with `service_healthy` and `service_completed_successfully`, a named volume, one shared network | `docker compose up --build -d --wait` |
| 4 | Persistent data initialization | [`book-vault/app/seed.py`](book-vault/app/seed.py): an idempotent one-shot `seed` job (3 readers, 20 books), only into an empty database, in one transaction, no hard-coded password | `docker compose logs seed` |
| 5 | Automated tests and failure tests | Backend 239 tests, AI service 92 (100% coverage, `TestModel` / `FunctionModel`, no key), frontend 158 Vitest and 6 Playwright e2e. Failure tests cover database down, provider error, timeout, invalid input, missing or invalid env and bad model output: [`test_failures.py`](book-vault/tests/test_failures.py), [`test_search_api.py`](ai-service/tests/test_search_api.py), [`test_config.py`](ai-service/tests/test_config.py), and [`scripts/smoke-test.sh`](scripts/smoke-test.sh) on a real stack | [Run all tests](#c-run-all-tests) |
| 6 | Basic CI | [`.github/workflows/ci.yml`](.github/workflows/ci.yml): lint and tests for each service, e2e, `docker compose build` and the smoke test. No secrets. | GitHub Actions tab |
| 7 | AI eval dataset and results | [`eval/dataset.jsonl`](eval/dataset.jsonl) (26 cases), [`eval/run_eval.py`](eval/run_eval.py), [`eval/results.md`](eval/results.md). Claude Haiku returns the right books for **92%** of questions, against 81% for the keyword baseline, with failure examples and conclusions. | `uv run python ../eval/run_eval.py --model fake` |
| 8 | Live demo | [`docs/deploy.md`](docs/deploy.md): a VM running the same Compose stack, plus [`docker-compose.prod.yml`](docker-compose.prod.yml) (Caddy HTTPS, secure cookie) | The URL above |
| 9 | Video script | [`docs/video-script.md`](docs/video-script.md): about 4:30, 10 shots with timestamps and narration | |
| 10 | Runbook | [`RUNBOOK.md`](RUNBOOK.md): run, health, logs, backup and restore (tested), incidents, key rotation | |

## Architecture

```
                         Docker Compose (docker compose up --build)
 ┌─────────┐   ┌───────────────────────────┐   ┌────────────────────────┐   ┌──────────────┐
 │ Browser │──▶│ frontend (nginx :80)      │──▶│ backend (uvicorn :8000)│──▶│ SQLite file  │
 │         │◀──│  /          React SPA     │◀──│  FastAPI + SQLAlchemy  │◀──│ named volume │
 └─────────┘   │  /api/ai/*  ──┐           │   │  /auth /users /books   │   │ book-vault-  │
 localhost:8080│  /api/*     ──┼──▶ backend│   └────────────▲───────────┘   │ data         │
               └───────────────┼───────────┘                │               └──────▲───────┘
                               ▼                            │ reader's own cookie  │
                ┌──────────────────────────────┐            │                      │
                │ ai-service (uvicorn :8100)   │────────────┘    ┌─────────────────┴┐
                │  FastAPI + Pydantic AI agent │                 │ seed (one-shot)  │
                │  SearchPlan, list_my_tropes  │──▶ LLM provider │ empty DB → demo  │
                └──────────────────────────────┘   (AI_MODEL)    │ data, then exits │
                                                                 └──────────────────┘
 Local dev: Vite :5173 ── /api/ai → :8100, /api → :8000 (same routes as nginx)
```

- The React app talks to the API through **one typed client**
  ([`frontend/src/api/books.ts`](frontend/src/api/books.ts)) at `VITE_API_URL`
  (default `/api`: the browser always calls its own origin).
- **In Docker**, nginx serves the built app and proxies `/api/ai/*` to the AI service
  and `/api/*` to the backend. **In local dev**, the Vite dev server does the same
  (`vite.config.ts`). One origin everywhere means no CORS, the login cookie just works,
  only the frontend's port is published, and the same image works on any host. Swagger:
  <http://localhost:8080/api/docs> (Docker) or <http://localhost:8000/docs> (dev).
- **The AI service never opens the database.** It reads books through the backend with
  the reader's own session cookie, so ownership and privacy rules live in one place, and
  a prompt can't reach anyone else's books. See [`ai-service/README.md`](ai-service/README.md).
- **Login** uses a random session token in an httpOnly, SameSite=Lax cookie (JavaScript
  can't read it). The database stores only its SHA-256 hash, so logging out really ends
  the session. Passwords are hashed with Argon2id.

## Prerequisites

| Tool | Version used | Needed for |
|------|--------------|------------|
| [Docker](https://docs.docker.com/get-docker/) with Compose v2+ | Docker 29.9, Compose 5.6 | option (a) |
| [uv](https://docs.astral.sh/uv/) | 0.13 (installs Python 3.11 itself) | backend, AI service, tests |
| [Node.js](https://nodejs.org/) + npm | Node 22 LTS (≥ 20.19), npm 10 | frontend, tests |

Main libraries: FastAPI 0.162 (backend) / 0.165 (AI service), SQLAlchemy 2.1, Pydantic 2.14, Pydantic AI 2.74,
pydantic-evals 2.74 · React 18.3, React Router 7, Vite 8, TypeScript 6.0 · pytest 9,
Vitest 5, Testing Library, Playwright 1.65.

## Get the code

```bash
git clone https://github.com/galamshalem/project.git
cd project
```

## (a) Run everything with Docker Compose

From the repository root:

```bash
docker compose up --build
```

Open <http://localhost:8080>. The first start loads sample data: log in as `demo` (or
`mira`, `theo`) with the password printed by `docker compose logs seed`, or create your
own account. With no `.env`, AI search uses the offline keyword model, so no key is
needed. For a real model, copy [`.env.example`](.env.example) to `.env` and set
`AI_MODEL` and its key. You can also set `DEMO_PASSWORD` there.

Data lives in the named volume `book-vault_book-vault-data`. (Upgrading an older volume
is automatic: new tables and columns are added on start, and the first account created
takes over books that existed before accounts.)

```bash
docker compose up --build -d --wait     # same, in the background, returns when healthy
docker compose ps -a                    # backend, ai-service, frontend "(healthy)"; seed "Exited (0)"
docker compose logs -f backend          # follow the API logs
docker compose down                     # stop and remove containers (data is kept)
docker compose down -v                  # ...and delete the data volume
FRONTEND_PORT=3000 docker compose up -d # use another host port
scripts/smoke-test.sh                   # throwaway stack: health, seed, AI, failure drills, reset, persistence
```

Operating it (backups, incidents, key rotation): [RUNBOOK.md](RUNBOOK.md). Deploying it
with HTTPS: [docs/deploy.md](docs/deploy.md).

## (b) Local development

Three terminals. **Backend** (API on <http://localhost:8000>, docs at `/docs`):

```bash
cd book-vault
uv sync
uv run uvicorn app.main:app --reload
```

**AI service** (on <http://localhost:8100>; `fake` = offline keyword model):

```bash
cd ai-service
uv sync
AI_MODEL=fake uv run uvicorn app.main:app --reload --port 8100
```

**Frontend** (app on <http://localhost:5173>, which forwards `/api/ai` to `:8100` and
`/api` to `:8000`):

```bash
cd frontend
npm ci
npm run dev
```

Configuration (all optional):

| Variable | Where | Default | Purpose |
|----------|-------|---------|---------|
| `DATABASE_URL` | backend | `sqlite:///./data/books.db` | SQLite location |
| `SESSION_DAYS` | backend | `30` | How long a login lasts |
| `COOKIE_SECURE` | backend | `false` | Set `true` when served over HTTPS (cookie only sent over HTTPS) |
| `EMAIL_BACKEND` | backend | `console` | How reset emails go out: `console` (server log), `file`, or `smtp` with `SMTP_*`. See [RUNBOOK.md](RUNBOOK.md#configuration) |
| `APP_BASE_URL` | backend | `http://localhost:8080` | Where reset links point (`http://localhost:5173` in local dev) |
| `CORS_ORIGINS` | backend | `http://localhost:5173` | Origins allowed to call the API directly (only needed if `VITE_API_URL` points at another origin) |
| `AI_MODEL` | AI service | empty: AI off (`fake` in Compose) | Pydantic AI model, e.g. `anthropic:claude-haiku-5-5`, or `fake` |
| `ANTHROPIC_API_KEY` | AI service | | Key for an `anthropic:` model |
| `AI_TIMEOUT_SECONDS`, `BACKEND_TIMEOUT_SECONDS` | AI service | `20`, `5` | Time limits for the model and the backend |
| `BACKEND_URL` | AI service | `http://localhost:8000` | Where the backend is |
| `VITE_API_URL` | frontend (dev/build time) | `/api` | API base URL. See `frontend/.env.example` |
| `API_PROXY_TARGET`, `AI_PROXY_TARGET` | frontend (dev server) | `:8000`, `:8100` | Where Vite forwards `/api` and `/api/ai` |

Compose-only settings (`DEMO_PASSWORD`, `SEED_DEMO_DATA`, `FRONTEND_PORT`) are described
in [`.env.example`](.env.example) and the [runbook](RUNBOOK.md#configuration).

## (c) Run all tests

**Backend**: pytest (239 tests, 100% coverage) and ruff.

```bash
cd book-vault
uv run pytest -v
uv run pytest --cov=app --cov-report=term-missing   # with coverage
uv run ruff check .
uv run ruff format --check .
```

**AI service**: pytest (92 tests, 100% coverage) and ruff. No API key is needed: the
tests use Pydantic AI's `TestModel` / `FunctionModel` and a fake backend.

```bash
cd ai-service
uv run pytest -v --cov=app
uv run ruff check . ../eval
uv run ruff format --check . ../eval
```

**Frontend**: lint (ESLint + Prettier), typecheck, and Vitest + React Testing Library
(158 tests).

```bash
cd frontend
npm ci
npm run lint
npm run typecheck
npm test
```

**End-to-end**: Playwright drives Chromium against the **real** backend and AI service
(fake model). It runs:
- the book flow: sign up, add, filter, edit, invalid input, delete
- privacy between two accounts
- a three-reader social flow: search, follow request, accept, read reviews, public follow
- AI search through the real AI service
- password reset: the emailed link (written to a file by the test backend), a new password,
  single use, and changing password and email in Settings

One command starts uvicorn on `:8001` with a fresh temporary SQLite file, the AI service
on `:8101`, and Vite on `:5174`, so it never touches your dev servers or data. It runs
the tests, then stops all three:

```bash
cd frontend
npx playwright install chromium   # once
npm run test:e2e
npm run test:e2e:report            # open the HTML report (per-step screenshots)
```

On failure, Playwright keeps a screenshot, a video and a trace in `frontend/test-results/`
(`npx playwright show-trace <path>/trace.zip`).

**Whole stack**: [`scripts/smoke-test.sh`](scripts/smoke-test.sh) builds a throwaway
Compose project and runs 33 checks, including failure drills (backend down, AI service
down), then removes it. **CI** runs all of the above on every push.

**AI eval**: see [eval/results.md](eval/results.md) for how to rerun it.

## Features

| | |
|---|---|
| **Book list** | Cards with title, author, genre, read status, star rating and trope chips; responsive down to phone width |
| **Filters** | Genre, read/unread, minimum rating and trope — combined, and kept in the URL so they survive a refresh |
| **AI search** | **Ask** in plain English. The AI turns the question into the same filters (shown as chips), returns the matching books, and can open those filters in the list. Clear messages when the AI is off, slow or failing; the rest of the app keeps working. |
| **Add / edit** | One form for both; tropes as tags with suggestions; quick "mark as read" and star rating on the detail page |
| **Delete** | Confirmed in an in-app dialog |
| **Loading & errors** | Spinners and disabled buttons while saving; empty vault vs. "no matches" states; inline validation that mirrors the API; server `422`s shown next to each field; "Book not found" page; "Can't reach the server" banner with Retry; success toasts; error boundaries |
| **Accounts** | Sign up, log in, log out; every page needs a login and returns you where you were heading; each reader's books are private to them by default |
| **Password reset** | **Forgot your password?** emails a single-use link that expires in 30 minutes, without revealing whether an address has an account. Setting a new password logs out every device. In **Settings**, change your password (other devices are logged out) or your private email. |
| **People & profiles** | Search readers by name; profiles show bio, counts and (when allowed) their books as review cards; followers / following lists |
| **Following** | Public profile → follow instantly. Private → "Request to follow", which they accept or decline from **Requests** (badge in the header). Unfollow, cancel a request, or remove a follower at any time |
| **Privacy** | In **Settings** choose Private (default, approve each follower) or Public; name, bio and counts are always visible to logged-in readers, books and reviews only as allowed |

## Repository layout

```
.
├── book-vault/              FastAPI backend: books, auth, social, seed (app/, tests/, Dockerfile); see its README
├── ai-service/              EX3: Pydantic AI search service (app/, tests/, Dockerfile); see its README
├── frontend/                EX2: React + TypeScript SPA
│   ├── src/api/books.ts     typed API client (the only module that calls fetch)
│   ├── src/pages/           list, add, detail/edit, ask (AI), login, register, forgot/reset password,
│   │                        people, profile, requests, settings
│   ├── src/auth/            session state, route guards
│   ├── src/components/      form, filters, cards, stars, tropes, dialog, banners, toasts, error boundary
│   ├── src/lib/             filters <-> URL, validation, error mapping, formatting
│   ├── e2e/                 Playwright: book flow, account privacy, social flow, AI search, password reset
│   ├── scripts/             capture-proof.mjs (regenerates the proof screenshots)
│   ├── Dockerfile           Node build stage -> nginx runtime stage
│   └── nginx.conf           SPA fallback + /api/ai and /api reverse proxy
├── eval/                    AI eval: dataset, scoring script, results
├── scripts/smoke-test.sh    Compose smoke test + failure drills on a throwaway stack
├── deploy/Caddyfile         HTTPS front for the live demo
├── docker-compose.yml       seed + backend + ai-service + frontend, named volume, one network
├── docker-compose.prod.yml  live-demo override: Caddy HTTPS, secure cookie
├── .github/workflows/ci.yml CI: lint, tests, e2e, compose build, smoke test
├── RUNBOOK.md               operating the stack
└── docs/                    deploy guide, video script, proof/ (social: current; ex2: as submitted)
```
