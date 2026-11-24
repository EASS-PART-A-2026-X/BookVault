# Book Vault — personal library & reading tracker

Track the books you own: genre, whether you've read them, a 1–5 star rating, a review,
and free-form **tropes** (e.g. *enemies to lovers*, *found family*). Filter by genre,
read status, minimum rating and trope.

- **EX1 — backend:** a FastAPI + SQLAlchemy + SQLite REST API in [`book-vault/`](book-vault/)
  ([API docs and examples](book-vault/README.md)).
- **EX2 — frontend:** a React + TypeScript single-page app in [`frontend/`](frontend/),
  integrated with the API, with full loading/empty/error states, component tests, an
  end-to-end flow against the real backend, and a one-command Docker Compose stack.

Evidence that it all works: [docs/proof/ex2/PROOF-EX2.md](docs/proof/ex2/PROOF-EX2.md)
(EX1: [book-vault/docs/proof/PROOF.md](book-vault/docs/proof/PROOF.md)).

![Book list](docs/proof/ex2/02-book-list.png)

## Architecture

```
                 Docker Compose (docker compose up --build)
 ┌─────────┐    ┌──────────────────────────────┐    ┌───────────────────────┐    ┌──────────────┐
 │ Browser │───▶│ frontend  (nginx :80)        │───▶│ backend (uvicorn :8000)│───▶│ SQLite file  │
 │         │◀───│  /        React SPA (static) │◀───│  FastAPI + SQLAlchemy  │◀───│ /app/data/   │
 └─────────┘    │  /api/*   reverse proxy ─────┼────│  Pydantic validation   │    │ books.db     │
  localhost:8080│  (prefix stripped)           │    │  /books /tropes /health│    │ (named volume│
                └──────────────────────────────┘    └───────────────────────┘    │  book-vault- │
                                                                                 │  data)       │
                                                                                 └──────────────┘
 Local dev: Vite dev server :5173 ──(CORS, VITE_API_URL=http://localhost:8000)──▶ uvicorn :8000 ──▶ ./data/books.db
```

- The React app talks to the API through **one typed client**
  ([`frontend/src/api/books.ts`](frontend/src/api/books.ts)); its base URL comes from
  `VITE_API_URL` (default `http://localhost:8000`).
- **In Docker**, the browser only talks to nginx. nginx serves the built app and proxies
  `/api/*` to the backend container, so the app is built with `VITE_API_URL=/api`.
  Same origin means no CORS, the backend port isn't published, and the same image works
  on any host. Swagger is at <http://localhost:8080/api/docs>.
- **In local dev**, Vite (`:5173`) calls uvicorn (`:8000`) directly; the backend allows
  that origin through `CORS_ORIGINS`.

## Prerequisites

| Tool | Version used | Needed for |
|------|--------------|------------|
| [Docker](https://docs.docker.com/get-docker/) with Compose v2+ | Docker 29.9, Compose 5.6 | option (a) |
| [uv](https://docs.astral.sh/uv/) | 0.13 (installs Python 3.11 itself) | backend, tests |
| [Node.js](https://nodejs.org/) + npm | Node 22 LTS (≥ 20.19), npm 10 | frontend, tests |

Main libraries: FastAPI 0.162, SQLAlchemy 2.1, Pydantic 2.14 · React 18.3, React Router 7,
Vite 8, TypeScript 6.0 · pytest 9, Vitest 5, Testing Library, Playwright 1.65.

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

Open <http://localhost:8080>. The frontend starts once the backend's `/health` check
passes. Data lives in the named volume `book-vault_book-vault-data`.

```bash
docker compose up --build -d --wait     # same, in the background, returns when healthy
docker compose ps                       # both services should be "(healthy)"
docker compose logs -f backend          # follow the API logs
docker compose down                     # stop and remove containers (data is kept)
docker compose down -v                  # ...and delete the data volume
FRONTEND_PORT=3000 docker compose up -d # use another host port
```

## (b) Local development

Two terminals. **Backend** (API on <http://localhost:8000>, docs at `/docs`):

```bash
cd book-vault
uv sync
uv run uvicorn app.main:app --reload
```

**Frontend** (app on <http://localhost:5173>):

```bash
cd frontend
npm ci
npm run dev
```

Configuration (all optional):

| Variable | Where | Default | Purpose |
|----------|-------|---------|---------|
| `DATABASE_URL` | backend | `sqlite:///./data/books.db` | SQLite location |
| `CORS_ORIGINS` | backend | `http://localhost:5173` | Comma-separated browser origins allowed to call the API |
| `VITE_API_URL` | frontend (dev/build time) | `http://localhost:8000` | API base URL (`/api` in Docker). See `frontend/.env.example` |

## (c) Run all tests

**Backend** — pytest (79 tests, 100% coverage) and ruff:

```bash
cd book-vault
uv run pytest -v
uv run pytest --cov=app --cov-report=term-missing   # with coverage
uv run ruff check .
uv run ruff format --check .
```

**Frontend** — lint (ESLint + Prettier), typecheck, Vitest + React Testing Library (91 tests):

```bash
cd frontend
npm ci
npm run lint
npm run typecheck
npm test
```

**End-to-end** — Playwright drives Chromium through the whole flow against the **real**
backend. One command starts uvicorn on `:8001` with a fresh temporary SQLite file and Vite
on `:5174` (so it never touches your dev servers or data), runs the test, and stops both:

```bash
cd frontend
npx playwright install chromium   # once
npm run test:e2e
npm run test:e2e:report            # open the HTML report (per-step screenshots)
```

On failure, Playwright keeps a screenshot, a video and a trace in `frontend/test-results/`
(`npx playwright show-trace <path>/trace.zip`).

## Features

| | |
|---|---|
| **Book list** | Cards with title, author, genre, read status, star rating and trope chips; responsive down to phone width |
| **Filters** | Genre, read/unread, minimum rating and trope — combined, and kept in the URL so they survive a refresh |
| **Add / edit** | One form for both; tropes as tags with suggestions; quick "mark as read" and star rating on the detail page |
| **Delete** | Confirmed in an in-app dialog |
| **Loading & errors** | Spinners and disabled buttons while saving; empty vault vs. "no matches" states; inline validation that mirrors the API; server `422`s shown next to each field; "Book not found" page; "Can't reach the server" banner with Retry; success toasts; error boundaries |

## Repository layout

```
.
├── book-vault/            EX1: FastAPI backend (app/, tests/, Dockerfile) — see its README and CLAUDE.md
├── frontend/              EX2: React + TypeScript SPA
│   ├── src/api/books.ts   typed API client (the only module that calls fetch)
│   ├── src/pages/         list, add, detail/edit, not-found
│   ├── src/components/    form, filters, cards, stars, tropes, dialog, banners, toasts, error boundary
│   ├── src/lib/           filters <-> URL, validation, error mapping, formatting
│   ├── e2e/               Playwright end-to-end flow
│   ├── scripts/           capture-proof.mjs (regenerates the proof screenshots)
│   ├── Dockerfile         Node build stage -> nginx runtime stage
│   └── nginx.conf         SPA fallback + /api reverse proxy
├── docker-compose.yml     backend + frontend + named volume
└── docs/proof/ex2/        EX2 evidence (PROOF-EX2.md, outputs, screenshots)
```
