# Verification evidence — accounts and social features

Book Vault after EX2: readers have **accounts**, a **private vault each**, and can **find
other readers, read their reviews and follow them**. Public profiles can be followed at
once; private ones need an accepted follow request.

Produced on **2026-11-24** on macOS from branch `social` (S1 `62aef18`, S2 `400f54e`, plus
the S3 changes committed with this file).

- **Text files** hold exact commands with full, unedited output, each ending in
  `[exit code: N]`. Every exit code is 0.
- **Screenshots** were taken by
  [`frontend/scripts/capture-proof.mjs`](../../../frontend/scripts/capture-proof.mjs)
  (Playwright + Chromium, 1280×860 at 2×), driving three demo readers (Eleanor, Mira, Theo)
  in separate browser contexts against a **Docker Compose stack**. That stack is a
  throwaway project (`-p bvproof`, fresh volume), so no real data was touched.
- The EX2 evidence as submitted is unchanged in [`../ex2/`](../ex2/PROOF-EX2.md).

## Summary

| Area | Evidence | Result |
|---|---|---|
| Accounts: sign up, log in, log out, sessions | Screenshots 01–02; `test_auth.py`; `auth.test.tsx`; e2e | ✅ |
| Private vault per user | `test_users_only_see_their_own_books`; e2e "each account only sees its own books" | ✅ |
| People search | Screenshot 17; `test_social.py › search`; `social.test.tsx › people search` | ✅ |
| Profiles, private vs. public | Screenshots 18, 22, 23, 25 | ✅ |
| Follow requests: send, accept | Screenshots 19–21; e2e social flow; [05-docker.txt](05-docker.txt) | ✅ |
| Settings: name, bio, public/private | Screenshot 24 | ✅ |
| EX2 features still work, now per user | Screenshots 03–16; e2e book flow | ✅ |
| Quality gates | [01](01-backend-checks.txt)–[04](04-playwright-e2e.txt) | ✅ 146 pytest (100% coverage) · 122 Vitest · 3 e2e |
| Docker, persistence, upgrade | [05-docker.txt](05-docker.txt), screenshot 26 | ✅ |

## Evidence files

| # | File | What it shows |
|---|------|---------------|
| 01 | [01-backend-checks.txt](01-backend-checks.txt) | ruff check + format, `pytest -v --cov`: **146 passed, 100% coverage** (EX1 tests plus 40 auth and 27 social) |
| 02 | [02-frontend-checks.txt](02-frontend-checks.txt) | Prettier, ESLint, typecheck (app, config, e2e), production build |
| 03 | [03-vitest.txt](03-vitest.txt) | Vitest + React Testing Library, verbose: **122 tests** |
| 04 | [04-playwright-e2e.txt](04-playwright-e2e.txt) | `npm run test:e2e` against the real backend: **3 passed** (book flow with 7 steps, account privacy, social flow) |
| 05 | [05-docker.txt](05-docker.txt) | Compose build and health; logged-out API answers 401 while SPA routes serve; a real request → accept → read flow through nginx; the HttpOnly cookie; everything persists across `down` / `up` |

## 1. Accounts

| Login (logged-out visitors are sent here) | Sign-up with inline validation |
|---|---|
| ![Login](01-login.png) | ![Register validation](02-register-validation.png) |

What the tests check (in [01-backend-checks.txt](01-backend-checks.txt) and
[03-vitest.txt](03-vitest.txt)):

- **Passwords** are stored as **Argon2id** hashes, never returned, and re-hashed when the
  settings get stronger (`test_password_is_stored_hashed`,
  `test_login_upgrades_an_outdated_password_hash`).
- **Session cookie** is a random token, **httpOnly + SameSite=Lax**. The database stores
  only its SHA-256 (`test_session_cookie_is_httponly_and_samesite`). Logging out kills it
  on the server, so even a copied cookie stops working
  (`test_logout_kills_the_session_server_side`). Expired or invalid tokens get 401.
- **Bad logins:** a wrong password and an unknown user give **the same 401**, so usernames
  can't be probed (`test_bad_login_gives_the_same_401`).
- **Usernames** are normalised (trimmed, lower case) before validation. Taken names are a
  409, shown on the username field.
- **Login required:** every data endpoint returns 401 when logged out
  (`test_endpoints_require_login`, `test_social_endpoints_require_login`). `/health`
  stays public.
- **In the UI:**
  - Pages need a login, and you're returned to where you were going (`?next=`, same-app
    paths only: `safeNext` rejects `//evil.example`).
  - A 401 in the middle of a session sends you to the login page with a notice.
  - While the session can't be checked (backend down), the header shows neither logged-in
    nor logged-out links.
- **Upgrading old databases:** EX1/EX2-era database files get the new column on start,
  and the first account takes over the existing books (`test_first_account_adopts_books…`).
  This was also done for real on the EX2 Docker volume.

## 2. EX2 features, now per user

Every EX2 screen still works, scoped to the logged-in reader:

| | |
|---|---|
| ![Empty vault](03-empty-state.png) | ![Book list](04-book-list.png) |
| Empty vault | List with tropes, ratings, read status |
| ![Filters](06-filters-trope.png) | ![No matches](07-no-filter-matches.png) |
| Filters in the URL | No matches, with Clear filters |
| ![Add form](08-add-form.png) | ![Validation](09-validation-error.png) |
| Add form | Client validation |
| ![Server 422](10-server-422.png) | ![Detail](11-detail-and-toast.png) |
| Real server 422 per field | Detail, quick action, toast |
| ![Edit](12-edit-view.png) | ![Delete dialog](13-delete-dialog.png) |
| Edit view | In-app delete dialog |
| ![Not found](14-not-found.png) | ![Backend down](15-backend-down-banner.png) |
| 404 page | Backend container stopped: banner + Retry |
| ![After retry](16-after-retry.png) | ![Phone](05-book-list-phone.png) |
| Back after Retry | Phone width |

Another user's book id behaves exactly like a missing one (404), in the API and in the UI.

## 3. Social

**Find readers.** You see yourself marked "You", private profiles marked "Private", and a
button matching each relationship:

![People search](17-people-search.png)

**A private profile you don't follow.** Name, bio and counts are visible, books and reviews
are not. The API refuses too (`403 This profile is private`):

![Private profile locked](18-private-profile-locked.png)

**Request → accept → read.** Eleanor asks to follow. Mira sees a badge and the request,
and accepts. Eleanor can then read Mira's reviews:

| Eleanor: request sent | Mira: requests inbox (badge 1) |
|---|---|
| ![Request sent](19-request-sent.png) | ![Requests inbox](20-requests-inbox.png) |
| **Mira: accepted** | **Eleanor: Mira's reviews** |
| ![Accepted](21-request-accepted.png) | ![Profile with reviews](22-profile-reviews.png) |

**Public profile: follow instantly, no request:**

![Public profile followed](23-public-profile-followed.png)

**Settings:** display name, bio and who can see your books. Going public accepts every
pending request (`test_going_public_accepts_pending_requests`):

![Settings](24-settings.png)

**Phone width** and the new endpoints in **Swagger through nginx**:

| | |
|---|---|
| ![Profile on a phone](25-profile-phone.png) | ![Swagger](26-swagger-via-proxy.png) |

Rules covered by `test_social.py` (27 tests), all in [01-backend-checks.txt](01-backend-checks.txt):

- **Who can see a reader's books, reviews and follower lists:**
  - **The reader themselves:** always.
  - **Public profile:** every logged-in reader.
  - **Private profile:** only followers whose request was **accepted**. Following is
    **one-way**: accepting someone doesn't let you see their books.
- **Requests:**
  - A pending request grants nothing and isn't counted.
  - Declining deletes it, and they can ask again.
  - Accepting or declining a request that doesn't exist is a 404.
  - You only see your own requests.
- **Follow actions:**
  - Following twice is harmless.
  - You can't follow yourself (400).
  - Unfollow, cancel a request, and **remove a follower** (which revokes their access).
- **Changing privacy:**
  - **Going private** keeps existing followers and locks out everyone else.
  - **Going public** accepts every pending request.
- **Search:**
  - Exact match first, then prefix matches, then the rest.
  - `%` and `_` match literally.
  - Ignores case.

## Bugs found and fixed while building this

| Bug | Found by | Fix |
|---|---|---|
| Usernames like "GAL" were rejected instead of lower-cased (Pydantic checked the pattern before lower-casing) | `test_register_creates_account_and_logs_in` | Normalise first, then validate |
| Logged-in header overflowed on phones (≤ 380px) | Browser check at 320px | Wordmark hides below 560px; tighter nav below 380px |
| Settings' radio buttons stretched into huge circles (they inherited text-input styles) | Browser check | Radios excluded from text-input styles |
| With the backend down, the header offered "Log in / Sign up" as if you'd been logged out | Reviewing screenshot 15 | Neither is shown until the session state is known; covered by `auth.test.tsx` |
| Vitest 5's `resetAllMocks` wiped default mocks, and older tests only passed by accident | New auth tests failing | `resetApiMocks()` restores the defaults |
