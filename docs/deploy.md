# Live demo: deploy guide

**Live demo:** _not deployed yet: the URL goes here and in the README._

## Recommendation: one small Linux VM running the same Docker Compose stack

Put the app on one small virtual machine (any cloud: Hetzner, DigitalOcean, AWS Lightsail,
...). It runs `docker-compose.yml` unchanged, plus a small override that adds HTTPS.

Why this rather than a platform-as-a-service:

- **Same stack as graded.** The four services, healthchecks, seed job and volume run
  exactly as they do locally and in CI. Nothing is rewritten for a provider.
- **SQLite needs a real disk.** The database is a file on a Docker volume. A VM's disk
  keeps it across restarts and deploys. Many PaaS free tiers have no persistent disk,
  or run each service separately, which would mean redesigning storage.
- **HTTPS with no manual certificates.** [Caddy](https://caddyserver.com) gets and renews
  a Let's Encrypt certificate by itself.
- **Small and predictable cost.** A 2 GB VM is a few dollars or euros a month (check
  the provider's current price), and it's deleted after grading.

What it adds ([docker-compose.prod.yml](../docker-compose.prod.yml),
[deploy/Caddyfile](../deploy/Caddyfile)):

| Change | Why |
|---|---|
| `caddy` service on ports 80 and 443 | HTTPS with automatic certificates, HTTP to HTTPS redirect, security headers (HSTS, nosniff, no framing) |
| `frontend` no longer published on a host port | The only way in is HTTPS through Caddy |
| `COOKIE_SECURE=true` on the backend | The session cookie is never sent over plain HTTP |

Checked locally with `SITE_ADDRESS=localhost` (Caddy's local CA):
- The stack starts healthy.
- HTTP answers `308` to HTTPS.
- The cookie comes back `HttpOnly; Secure; SameSite=lax`.
- Login, books, AI search and deep links all work over HTTPS.
- Without `SITE_ADDRESS`, Compose refuses to start and names the variable.

## Before you start

- **A VM:** Ubuntu 24.04 LTS, 2 GB RAM, 1 vCPU, about 20 GB of disk, logged in with an
  SSH key (not a password). The image build (npm, uv) is the most memory-hungry step;
  with 1 GB, add swap.
- **A host name pointing at the VM.** Either:
  - **Free, no domain needed:** `<ip-with-dashes>.sslip.io`. For example, for the IP
    `203.0.113.7` it's `203-0-113-7.sslip.io`, which resolves to that IP automatically.
    If Let's Encrypt refuses it (the sslip.io domain is shared, so its limits sometimes
    run out), use a domain instead.
  - **Your own domain or subdomain**, with an `A` record pointing to the VM's IP.
- **An AI key for the demo only.** Create a separate key (e.g. `bookvault-demo`) and set
  a **monthly spend limit** for its workspace in the provider console. The demo is open
  to anyone who signs up, and each AI search costs money. Use an expiry date after
  grading. Without a key, use `AI_MODEL=fake`: the AI page works offline with the
  keyword model.

## Deploy

**1. Firewall.** In the provider's firewall (or `ufw`), allow only `22` (SSH), `80` and
`443`. Caddy is the only container with published ports.

**2. Install Docker.** Use Docker Engine with the Compose plugin, following the
[official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/). Check
with `docker compose version`.

**3. Get the code:**

```bash
git clone https://github.com/galamshalem/project.git bookvault
cd bookvault
```

**4. Configure:** create `.env` and lock it down.

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Set:

```ini
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml   # every `docker compose` command uses both files
SITE_ADDRESS=203-0-113-7.sslip.io                          # your host name, no https://
AI_MODEL=anthropic:claude-haiku-5-5
ANTHROPIC_API_KEY=<the demo key>
DEMO_PASSWORD=<a long random password: you'll share it with graders>
SEED_DEMO_DATA=true
# Password reset emails, from your email provider (see "Email" below):
EMAIL_BACKEND=smtp
SMTP_HOST=<provider's SMTP host>
SMTP_PORT=587
SMTP_USERNAME=<SMTP user>
SMTP_PASSWORD=<SMTP password or API key>
SMTP_FROM=Book Vault <no-reply@your-domain>
```

`COMPOSE_FILE` in `.env` means every command in [RUNBOOK.md](../RUNBOOK.md) works
unchanged on the server.

**5. Start:**

```bash
docker compose up --build -d --wait
docker compose ps -a        # caddy running; backend, ai-service, frontend healthy; seed exited (0)
docker compose logs caddy   # look for "certificate obtained successfully"
```

**6. Check from your laptop:**

```bash
curl -I https://<SITE_ADDRESS>/            # 200, with strict-transport-security
curl -I http://<SITE_ADDRESS>/             # 308 redirect to https://
curl https://<SITE_ADDRESS>/api/health     # {"status":"ok"}
```

Then, in a browser:
1. Log in as `demo` with `DEMO_PASSWORD`.
2. Open **Ask** and try "unread fantasy with found family".
3. Register a new reader to check sign-up.

**7. Publish the URL.** Put it at the top of this file and in the README's EX3 section.

### Email (password reset)

Reset links need real email on the server. Any provider with SMTP works: a transactional
email service, or your own mailbox's SMTP with an app password. Put its settings in `.env`
as above. Reset links automatically point at `https://SITE_ADDRESS`.

- Most providers require a **verified sender** (`SMTP_FROM`) before they deliver.
- Test it: register with your own address, log out, click **Forgot your password?**, and
  check that the email arrives. If it doesn't, `docker compose logs backend | grep -i email`
  shows `could not send email to …` with the error type, and never the password.
- Without SMTP, leave `EMAIL_BACKEND=console`. The demo still works, but reset emails only
  appear in the server's log, so visitors can't reset their own passwords.

## Running it

- **Update:** `git pull && docker compose up --build -d --wait`. Back up first (see the
  RUNBOOK).
- **Backups, logs, incidents, key rotation:** [RUNBOOK.md](../RUNBOOK.md). Every
  command works on the server as is.
- **Spending:** check the provider's usage page now and then. If the AI is being abused,
  set `AI_MODEL=fake` and run `docker compose up -d --wait`. The demo keeps working
  without cost.
- **Reset the demo data** (e.g. after visitors have changed it): back up, then delete
  only the data volume, so Caddy keeps its certificates. (Let's Encrypt limits how often
  a certificate can be fetched again.)

  ```bash
  docker compose down
  docker volume rm book-vault_book-vault-data
  docker compose up -d --wait
  ```

## After grading

1. Delete the VM. This deletes the data on it.
2. Delete the demo AI key in the provider console.
3. Remove the URL from the README.
