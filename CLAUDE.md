# CLAUDE.md

Book Vault: a FastAPI + SQLite backend (`book-vault/`, EX1), a React + TypeScript SPA
(`frontend/`, EX2) and a Pydantic AI service (`ai-service/`, EX3: plain-English search),
run together with Docker Compose. Users have accounts (cookie
sessions), private per-user books, and social features (search, profiles, follow /
follow requests). Backend conventions live in
[book-vault/CLAUDE.md](book-vault/CLAUDE.md); this file covers the frontend and the repo.

## Commands

```bash
# Whole stack (repo root) -> http://localhost:8080, API docs at /api/docs
cp .env.example .env                 # optional: real model + key; unset AI_MODEL = fake model
docker compose up --build            # -d --wait to run in the background
docker compose down                  # keeps data; add -v to delete the volume
docker compose logs seed             # sample data: "added ..." once, then "already has data"
                                     # (demo / mira / theo; password = DEMO_PASSWORD or the logged one)

# Backend (book-vault/)
uv sync
uv run uvicorn app.main:app --reload # http://localhost:8000
uv run pytest -v
uv run ruff check . && uv run ruff format --check .

# AI service (ai-service/)
uv sync
AI_MODEL=fake uv run uvicorn app.main:app --reload --port 8100
uv run pytest -v --cov=app           # no key: TestModel / FunctionModel / fake model
uv run ruff check . && uv run ruff format --check .

# Frontend (frontend/)
npm ci
npm run dev                          # http://localhost:5173, proxies /api/ai to :8100, /api to :8000
npm run lint                         # ESLint + Prettier check (npm run format to fix)
npm run typecheck                    # app, node config and e2e tsconfigs
npm test                             # Vitest + React Testing Library
npm run test:e2e                     # Playwright vs the real backend + AI service (fake model; needs uv)
npm run build                        # typecheck + production build to dist/
# Regenerate docs/proof/social screenshots on a throwaway stack (never your real data):
SEED_DEMO_DATA=false FRONTEND_PORT=8090 docker compose -p bvproof up --build -d --wait  # repo root, empty vault
PROOF_BASE_URL=http://localhost:8090 PROOF_COMPOSE_PROJECT=bvproof node scripts/capture-proof.mjs
docker compose -p bvproof down -v
```

## Frontend layout

```
src/
  api/books.ts        the typed client for EVERY endpoint (books, tropes, auth, social),
                      ApiError, ValidationError (parsed FastAPI 422), NetworkError,
                      setUnauthorizedHandler (a 401 on a non-/auth call ends the session)
  auth/               AuthProvider + useAuth (session state), RequireAuth / PublicOnly guards,
                      safeNext (only same-app ?next= redirects)
  social/             request-count context (header badge)
  types.ts            API types mirroring book-vault/app/schemas.py (GENRES, limits, normalizeTrope)
  pages/              BookListPage, AddBookPage, BookDetailPage, NotFoundPage, LoginPage,
                      RegisterPage, PeoplePage, ProfilePage, RequestsPage, SettingsPage,
                      AskPage (AI search via askVault -> /api/ai/search)
  components/         BookForm, TropeInput, Filters, BookCard, ReviewCard, StarRating,
                      FollowButton, Avatar, TextField, ConfirmDialog, ErrorBanner, EmptyState,
                      Spinner, ErrorBoundary, VaultLogo
  hooks/              useResource (generic fetch: derived loading, keeps last data/error),
                      useBooks, useBook, useTropes, useBookFilters (URL state)
  lib/                filters (URL <-> state <-> API), validation, authValidation, errors
                      (describeError, mapValidationIssues, mapIssuesToFields), bookForm, format
  toast/              ToastProvider + useToast
  test/               setup, fixtures (makeBook), renderApp, mockApi / mockApiFactory
e2e/                  book-flow.spec.ts (7-step flow + account privacy), social.spec.ts
                      (three readers in separate browser contexts), ai-search.spec.ts
                      (AI search through the real AI service), helpers.ts, env.ts
```

## Frontend conventions

- **Only `src/api/books.ts` calls `fetch`.** Add endpoints there with types in `types.ts`;
  keep `types.ts` in sync with the backend schemas (field names, `GENRES`, limits).
- **Errors are values, not strings.** Throw/catch the client's error classes; turn them into
  UI text with `describeError()` and show them with `ErrorBanner` (pages) or the form's
  alert. A proxy 502/504 counts as "can't reach the server". Never render a raw response body.
- **Forms go through `BookForm`.** Client rules in `lib/validation.ts` must mirror the
  Pydantic schema. Server 422s are mapped per field with `mapValidationIssues()` and kept
  separate from client errors. Form buttons call `keepFocus` on mousedown (a blur error
  must not shift the button and swallow the click) — keep that on any new form button.
- **List filters live in the URL** (`genre`, `status`, `min_rating`, `trope`) via
  `useBookFilters`; parse defensively and normalise like the backend.
- **Auth:** pages that need a user go under `<RequireAuth>` in `App.tsx`; login/register
  under `<PublicOnly>`. Read the user with `useAuth()`. Never store tokens in JS — the
  cookie is httpOnly. While the session check is loading or failed, show neither logged-in
  nor logged-out UI.
- **AI search errors** go through `describeAiError()`: unlike the backend, the AI service
  sends its own JSON 502/503/504 (provider error, not configured, timeout), so show its
  message instead of "can't reach the server".
- **Social visibility is the server's call** (`can_view_books`); the UI only reflects
  `can_view_books` / `follow_status` from the API and treats 403 as "private".
- **New data views** use `useResource(key, fetcher)` instead of hand-rolled effects.
- **Every mutation gives feedback:** disable controls while saving, toast on success.
- **Loading is derived**, not set in effects (`result.key !== key`), to satisfy the
  React Compiler lint rules (`react-hooks/set-state-in-effect`).
- **Styling:** one stylesheet `src/index.css` with tokens on `:root` (dark, black/steel/gold).
  Must work down to 320px wide with no horizontal scroll.
- **Accessibility:** label every control, wire errors with `aria-invalid`/`aria-describedby`,
  prefer role/label queries in tests (they double as a11y checks).

## Testing conventions

- Component tests mock the API client, keeping the real error classes:
  `vi.mock('../api/books', async () => (await import('../test/mockApiFactory')).default());`
  then drive the mocks through `mocked` from `src/test/mockApi.ts`.
- Reset mocks with `resetApiMocks()` (not `vi.resetAllMocks()`): it restores the defaults
  (logged in as "reader", no tropes, no requests).
- Render full routes with `await renderApp(url)` (MemoryRouter + toasts + auth); it waits
  for the session check. After a redirect, wait with `findBy…`. Assert the URL through the
  `location` test id.
- e2e: create users with `signUp(page, name)` from `e2e/helpers.ts`; use `page.request`
  with `/api/...` paths (it shares the browser's login cookie); usernames must be unique
  across the run (one database per run).
- The e2e flow runs on its own ports (API 8001, AI 8101 with `AI_MODEL=fake`, web 5174) with a SQLite file that is deleted
  on every start (`e2e/.tmp/`, gitignored). `reuseExistingServer` is off on purpose.
- When fixing a bug, add a test that fails without the fix.

## AI service conventions (`ai-service/`)

- It never opens the database: every read goes through the backend API with the reader's
  own `bv_session` cookie (`app/backend.py`), so ownership and privacy stay in one place.
- The model comes only from `AI_MODEL` (+ the provider's key env var). `fake` = offline
  keyword model (`app/fake_model.py`) for tests, e2e, CI and key-less demos.
- `SearchPlan` mirrors the backend's filters (`Genre`, rating 1–5, trope rules); keep
  them in sync with `book-vault/app/schemas.py`.
- Every failure maps to a status + user-facing message in `app/main.py`; never return a
  provider's error body. Tests use `TestModel` / `FunctionModel`, never a real key.

## Before finishing any change

All of these must pass:

```bash
(cd book-vault && uv run pytest -q && uv run ruff check . && uv run ruff format --check .)
(cd ai-service && uv run pytest -q && uv run ruff check . && uv run ruff format --check .)
(cd frontend && npm run lint && npm run typecheck && npm test && npm run test:e2e)
```

If Docker-related files changed, also run `docker compose up --build -d --wait` and check
<http://localhost:8080>.
