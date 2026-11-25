#!/usr/bin/env bash
# End-to-end smoke + failure drills against the REAL Docker Compose stack.
#
#   scripts/smoke-test.sh            # from the repo root; needs docker, curl, python3
#
# It starts a throwaway Compose project (own name, own port, own volume), so your real
# data is never touched, and always removes it at the end. Uses the offline keyword
# model (AI_MODEL=fake): no API key needed. Exit code 0 = every check passed.
#
# Settings: SMOKE_PROJECT (default bvsmoke), SMOKE_PORT (default 8092).

set -euo pipefail

PROJECT="${SMOKE_PROJECT:-bvsmoke}"
PORT="${SMOKE_PORT:-8092}"
BASE="http://localhost:${PORT}"
PASSWORD="smoke-test-password"
WORK="$(mktemp -d)"
JAR="${WORK}/cookies.txt"
FAILED=0

export FRONTEND_PORT="$PORT" AI_MODEL=fake DEMO_PASSWORD="$PASSWORD" SEED_DEMO_DATA=true
compose() { docker compose -p "$PROJECT" "$@"; }

cleanup() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILED=1; }

# check "description" expected_status actual_status [body must contain]
check() {
  local what="$1" want="$2" got="$3" body="${4-}" needle="${5-}"
  if [[ "$got" == "$want" && ( -z "$needle" || "$body" == *"$needle"* ) ]]; then
    pass "$what ($got)"
  else
    fail "$what: expected $want${needle:+ with '$needle'}, got $got: ${body:0:200}"
  fi
}

# request METHOD PATH [JSON] -> sets STATUS and BODY (uses the cookie jar)
request() {
  local method="$1" path="$2" data="${3-}"
  local args=(-s -o "${WORK}/body" -w '%{http_code}' -X "$method" -b "$JAR" -c "$JAR")
  [[ -n "$data" ]] && args+=(-H 'Content-Type: application/json' -d "$data")
  STATUS="$(curl "${args[@]}" "${BASE}${path}" || echo 000)"
  BODY="$(cat "${WORK}/body" 2>/dev/null || true)"
}

json_len() { python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' <<<"$1"; }
ask() { request POST /api/ai/search "{\"question\": \"$1\"}"; }
login() { request POST /api/auth/login "{\"username\": \"demo\", \"password\": \"$PASSWORD\"}"; }

echo "== 1. Start the stack (project ${PROJECT}, port ${PORT})"
compose down -v --remove-orphans >/dev/null 2>&1 || true
compose up --build -d --wait --quiet-pull >/dev/null 2>&1 || {
  compose ps -a
  compose logs --tail=50
  echo "stack failed to start"
  exit 1
}
for service in seed backend ai-service frontend; do
  state="$(compose ps -a --format '{{.Service}} {{.State}} {{.Health}} {{.ExitCode}}' | grep "^${service} " || true)"
  case "$state" in
    "seed exited  0" | "seed exited 0") pass "seed job finished (exit 0)" ;;
    *running\ healthy*) pass "${service} is healthy" ;;
    *) fail "${service}: ${state:-missing}" ;;
  esac
done

echo "== 2. Health and routing"
request GET /healthz;            check "nginx /healthz" 200 "$STATUS"
request GET /api/health;         check "backend /health through nginx" 200 "$STATUS" "$BODY" '"ok"'
request GET /ask;                check "SPA route /ask serves the app" 200 "$STATUS" "$BODY" '<div id="root">'
ai_health="$(compose exec -T ai-service python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8100/health').read().decode())")"
check "ai-service /health: AI ready, backend ok" ok \
  "$([[ "$ai_health" == *'"ai":"ready"'* && "$ai_health" == *'"backend":"ok"'* ]] && echo ok || echo "$ai_health")"

echo "== 3. Seeded data and the AI feature"
login;                           check "log in as the seeded demo reader" 200 "$STATUS"
request GET /api/books;          check "demo has the 16 seeded books" 16 "$(json_len "$BODY")"
ask "unread fantasy with found family"
check "AI search answers with a plan and matches" 200 "$STATUS" "$BODY" 'Legends & Lattes'

echo "== 4. Failure drills"
ask "";                          check "empty question is rejected" 422 "$STATUS"
request POST /api/books '{"title": " ", "author": "A", "genre": "Poetry"}'
check "invalid book is rejected" 422 "$STATUS" "$BODY" '"loc"'
cp "$JAR" "${WORK}/saved" && : >"$JAR"
ask "fantasy";                   check "AI search logged out" 401 "$STATUS" "$BODY" 'Not logged in'
request GET /api/books;          check "books logged out" 401 "$STATUS"
cp "${WORK}/saved" "$JAR"

compose stop backend >/dev/null 2>&1
request GET /api/books;          check "backend down: API is a JSON 502" 502 "$STATUS" "$BODY" 'Backend unavailable'
ask "fantasy";                   check "backend down: AI search is a JSON 503" 503 "$STATUS" "$BODY" 'unavailable'
request GET /;                   check "backend down: the app itself still loads" 200 "$STATUS"
compose up -d --wait backend >/dev/null 2>&1
request GET /api/books;          check "backend back: same session works" 200 "$STATUS"

compose stop ai-service >/dev/null 2>&1
ask "fantasy";                   check "AI service down: JSON 503" 503 "$STATUS" "$BODY" 'AI service is unavailable'
request GET /api/books;          check "AI service down: books still work" 200 "$STATUS"
compose up -d --wait ai-service >/dev/null 2>&1
ask "fantasy";                   check "AI service back" 200 "$STATUS"

echo "== 5. Persistence across down / up"
request POST /api/books '{"title": "Smoke Test Book", "author": "CI", "genre": "Mystery"}'
check "add a book" 201 "$STATUS"
compose down >/dev/null 2>&1
compose up -d --wait >/dev/null 2>&1
seed_log="$(compose logs seed 2>/dev/null | tail -1)"
check "seed is a no-op on the second start" ok \
  "$([[ "$seed_log" == *"already has data"* ]] && echo ok || echo "$seed_log")"
: >"$JAR"; login;                check "log in again after restart" 200 "$STATUS"
request GET /api/books;          check "all 17 books are still there" 17 "$(json_len "$BODY")"

echo
if [[ "$FAILED" == 0 ]]; then
  echo "Smoke test passed."
else
  echo "Smoke test FAILED (see above)."
  compose logs --tail=30 || true
fi
exit "$FAILED"
