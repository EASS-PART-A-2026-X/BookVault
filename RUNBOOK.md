# Book Vault runbook

How to run, check, back up and fix the Docker Compose stack. Every command runs from the
repository root. For development and tests, see [README.md](README.md).
On the live-demo server, `.env` sets `COMPOSE_FILE` to add HTTPS, so the same commands
work there unchanged; see [docs/deploy.md](docs/deploy.md).

## What runs

| Service | Role | Reached at | Health |
|---|---|---|---|
| `frontend` | nginx: serves the React app and proxies `/api/ai/*` and `/api/*` | `http://localhost:${FRONTEND_PORT:-8080}`, the only published port | `GET /healthz` |
| `backend` | FastAPI + SQLite: accounts, books, social | `backend:8000`, internal only | `GET /health` (runs `SELECT 1`) |
| `ai-service` | FastAPI + Pydantic AI: plain-English search | `ai-service:8100`, internal only | `GET /health` (reports AI and backend state) |
| `seed` | one-shot job: sample data into an **empty** database, then exits 0 | none | exit code |

Start order, enforced by `depends_on`: `seed` exits successfully, then `backend` becomes
healthy, then `ai-service` becomes healthy, then `frontend` starts. Data lives in the named
volume `book-vault_book-vault-data`, at `/app/data/books.db` in the backend container.

## Start, stop, update

```bash
cp .env.example .env                   # first time only; fill in what you need (see Configuration)
docker compose up --build -d --wait    # start in the background; returns once everything is healthy
docker compose ps -a                   # backend, ai-service, frontend: "(healthy)"; seed: "Exited (0)"
docker compose down                    # stop; the data is kept
```

**Update to a new version:** `git pull`, then `docker compose up --build -d --wait`. The
schema upgrades itself on start (`create_all` + `migrate`), and the seed job is a no-op on
a database that has data. Take a [backup](#backup-and-restore) first.

**Apply a changed `.env`:** run `docker compose up -d --wait`. Compose recreates only the
services whose settings changed.

## Configuration

Set these in `.env`, which is gitignored and read automatically by Compose. Never commit a
key.

| Variable | Default | Used by | Notes |
|---|---|---|---|
| `AI_MODEL` | `fake` if unset | ai-service | Pydantic AI model name, e.g. `anthropic:claude-haiku-5-5`. `fake` = offline keyword model. **Empty = AI off.** |
| `ANTHROPIC_API_KEY` | empty | ai-service | Needed only for an `anthropic:` model |
| `AI_TIMEOUT_SECONDS` | `20` | ai-service | Model call limit; over it, the search answers 504 |
| `BACKEND_TIMEOUT_SECONDS` | `5` | ai-service | Limit for its calls to the backend |
| `DEMO_PASSWORD` | random | seed | Password for `demo`, `mira` and `theo`, 8–128 characters. If empty, a random one is printed once in `docker compose logs seed`. |
| `SEED_DEMO_DATA` | `true` | seed | `false` = start with an empty vault |
| `FRONTEND_PORT` | `8080` | frontend | Host port |

An invalid number (e.g. `AI_TIMEOUT_SECONDS=soon`) stops that service at startup with a log
line naming the variable. A missing model or key doesn't: the AI service starts, reports
`"ai": "not_configured"`, and only AI search is unavailable.

The backend also reads `SESSION_DAYS` (default 30) and `COOKIE_SECURE` (default false), but
`docker-compose.yml` doesn't pass them through today. Add them to the `backend` service's
`environment` to change them, e.g. `COOKIE_SECURE=true` behind HTTPS.

## Health checks

```bash
docker compose ps -a                                   # healthy / exited (0)
curl -s localhost:8080/healthz                          # nginx: "ok"
curl -s localhost:8080/api/health                       # backend + database: {"status":"ok"}
docker compose exec ai-service python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8100/health').read().decode())"
```

The AI service health shows what's wrong without calling the model:

```json
{"status":"ok","ai":"ready","model":"anthropic:claude-haiku-5-5","detail":null,"backend":"ok"}
```

- `"ai": "not_configured"`: `detail` names the missing setting.
- `"backend": "unreachable"`: the AI service can't reach the backend.

**Full check:** `scripts/smoke-test.sh` builds a separate throwaway stack (project `bvsmoke`,
port 8092) and runs 26 checks: health, seed, AI search, failure drills and persistence.
It then deletes that stack. It never touches your data. Exit code 0 means everything
passed.

## Logs

```bash
docker compose logs -f backend ai-service   # follow
docker compose logs --tail=100 frontend     # nginx access + error log
docker compose logs seed                    # "added 3 readers and 20 books" once, then "already has data"
```

The AI service logs each failed search as one warning line: backend unavailable, model
timed out, provider error (the error's type only, never the provider's response body) or
unusable model output. It never logs the key.

## Backup and restore

SQLite is a single file on the volume. Use SQLite's backup API rather than copying the file
directly: it gives a consistent copy while the app is running.

**Back up** (the app keeps running):

```bash
mkdir -p backups
docker compose exec -T backend python -c "import sqlite3; s=sqlite3.connect('/app/data/books.db'); d=sqlite3.connect('/app/data/backup.db'); s.backup(d); d.close(); s.close()"
docker compose cp backend:/app/data/backup.db "backups/books-$(date +%F).db"
docker compose exec -T backend rm /app/data/backup.db
```

**Restore** (short downtime). This overwrites the current data with the backup:

```bash
docker compose stop frontend ai-service backend
docker compose run --rm --no-deps -T -v "$PWD/backups:/backup:ro" backend \
  python -c "import sqlite3; s=sqlite3.connect('/backup/books-YYYY-MM-DD.db'); d=sqlite3.connect('/app/data/books.db'); s.backup(d); d.close(); s.close()"
docker compose up -d --wait
```

The restore runs as the container's own `app` user, so the file keeps the right owner and
stays writable. Sessions created after the backup are gone, so those readers log in again.
`backups/` holds password hashes and private reviews. It's gitignored; keep it off shared
drives too.

**Start over with fresh sample data:** `docker compose down -v`, then
`docker compose up -d --wait`. This **deletes every account and book**, so back up first.

## Incidents

| Symptom | Check | Fix |
|---|---|---|
| The page doesn't load at all | `docker compose ps -a`; is `frontend` running? Is the port taken (`lsof -i :8080`)? | `docker compose up -d --wait`, or set another `FRONTEND_PORT` |
| The app loads but says it can't reach the server; the API answers 502 `Backend unavailable` | `docker compose ps backend`; `docker compose logs --tail=50 backend` | `docker compose up -d --wait backend`. Sessions survive a backend restart. |
| API answers 503 `Database unavailable` | `docker compose logs backend` (logs the SQLite error); `docker system df` (disk full?) | Free disk space, or [restore](#backup-and-restore) if the file is damaged. `/health` turns 200 again on its own once SQLite works. |
| `docker compose up` fails: `seed` didn't complete successfully | `docker compose logs seed` | Exit 2: `DEMO_PASSWORD` isn't 8–128 characters. Exit 1: invalid `seed_data.json`. |
| A service restarts or stays unhealthy right after a `.env` change | `docker compose logs --tail=20 <service>` | The log names the bad variable (e.g. `AI_TIMEOUT_SECONDS must be a number of seconds`); fix `.env` and run `up -d --wait` |
| AI search: 503 `AI is not configured: …` | AI health `detail` | Set `AI_MODEL` and the provider's key in `.env`, then `docker compose up -d --wait` |
| AI search: 503 `The AI service is unavailable right now…` | `docker compose ps ai-service` (this is nginx's answer when the service is down) | `docker compose up -d --wait ai-service`. The rest of the app keeps working. |
| AI search: 502 `The AI provider failed to answer…` | `docker compose logs ai-service`; the provider console | Usually a wrong or expired key, no credit, or a rate limit. Fix it in the provider console or rotate the key. To keep the demo going meanwhile: `AI_MODEL=fake`. |
| AI search: 504 `The AI took too long to answer…` | Provider status page; `AI_TIMEOUT_SECONDS` | Retry. If it keeps happening, raise `AI_TIMEOUT_SECONDS` (nginx allows up to 60 s). |
| AI search: 502 `The AI couldn't turn that into a search…` | `docker compose logs ai-service` | The model's answer stayed invalid after 2 retries. Rephrase, or use the filters. If it happens often, run the eval (below). |
| Nobody knows the demo password | `docker compose logs seed` (shown only if it was generated) | There's no password reset. Set `DEMO_PASSWORD` and reseed with `down -v`, which deletes all data. |

After any fix, run the health checks above. After changing code or Compose files, also run
`scripts/smoke-test.sh`.

## Rotate the AI key

1. Create a new key in the provider console.
2. Put it in `.env` (`ANTHROPIC_API_KEY=...`), then run `docker compose up -d --wait`.
   This recreates only `ai-service`.
3. Check that the AI health says `"ai": "ready"`, and try one search.
4. Delete the old key in the console.

If a key was ever committed or shared, treat it as leaked: delete it in the console
first, then do steps 1–3. Removing it from git history doesn't make it safe again.

## Check AI quality

`eval/` holds 26 test questions with expected filters. After changing the model, the
prompt or the `SearchPlan` schema, rerun it and compare against
[eval/results.md](eval/results.md):

```bash
cd ai-service
uv run python ../eval/run_eval.py --model fake --report      # offline baseline
uv run --env-file ../.env python ../eval/run_eval.py --model anthropic:claude-haiku-5-5 --report
```

The real-model run costs a few cents.
