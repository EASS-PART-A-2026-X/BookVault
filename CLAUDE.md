# CLAUDE.md

Book Vault: a FastAPI + SQLite backend (`book-vault/`, EX1) and a React + TypeScript SPA
(`frontend/`, EX2), run together with Docker Compose. Backend conventions live in
[book-vault/CLAUDE.md](book-vault/CLAUDE.md); this file covers the frontend and the repo.

## Commands

```bash
# Whole stack (repo root) -> http://localhost:8080, API docs at /api/docs
docker compose up --build            # -d --wait to run in the background
docker compose down                  # keeps data; add -v to delete the volume

# Backend (book-vault/)
uv sync
uv run uvicorn app.main:app --reload # http://localhost:8000
uv run pytest -v
uv run ruff check . && uv run ruff format --check .

# Frontend (frontend/)
npm ci
npm run dev                          # http://localhost:5173 (expects the API on :8000)
npm run lint                         # ESLint + Prettier check (npm run format to fix)
npm run typecheck                    # app, node config and e2e tsconfigs
npm test                             # Vitest + React Testing Library
npm run test:e2e                     # Playwright vs the real backend (needs uv on PATH)
npm run build                        # typecheck + production build to dist/
node scripts/capture-proof.mjs       # regenerate docs/proof/ex2 screenshots (Docker stack
                                     # must be up; it DELETES all books and reseeds them)
```

## Frontend layout

```
src/
  api/books.ts        typed client: listBooks/getBook/createBook/updateBook/deleteBook/listTropes,
                      ApiError, ValidationError (parsed FastAPI 422), NetworkError
  types.ts            API types mirroring book-vault/app/schemas.py (GENRES, limits, normalizeTrope)
  pages/              BookListPage, AddBookPage, BookDetailPage (view/edit/quick actions/delete), NotFoundPage
  components/         BookForm, TropeInput, Filters, BookCard, StarRating, ConfirmDialog,
                      ErrorBanner, EmptyState, Spinner, ErrorBoundary, VaultLogo
  hooks/              useBooks, useBook, useTropes (fetch + derived loading), useBookFilters (URL state)
  lib/                filters (URL <-> state <-> API), validation, errors (describeError,
                      mapValidationIssues), bookForm (form values <-> payloads), format (dates)
  toast/              ToastProvider + useToast
  test/               setup, fixtures (makeBook), renderApp, mockApi / mockApiFactory
e2e/                  book-flow.spec.ts (7-step flow), env.ts (ports, temp DB path)
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
- Render full routes with `renderApp(url)` (MemoryRouter + toasts); assert the URL through
  the `location` test id.
- The e2e flow runs on its own ports (API 8001, web 5174) with a SQLite file that is deleted
  on every start (`e2e/.tmp/`, gitignored). `reuseExistingServer` is off on purpose.
- When fixing a bug, add a test that fails without the fix.

## Before finishing any change

All of these must pass:

```bash
(cd book-vault && uv run pytest -q && uv run ruff check . && uv run ruff format --check .)
(cd frontend && npm run lint && npm run typecheck && npm test && npm run test:e2e)
```

If Docker-related files changed, also run `docker compose up --build -d --wait` and check
<http://localhost:8080>.
