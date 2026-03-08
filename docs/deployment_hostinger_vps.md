# AGRIK Deployment Guide (Hostinger VPS)

This runbook is tailored for the current AGRIK stack:

- Backend: FastAPI + Uvicorn
- Frontend: React + Vite static build
- Database: PostgreSQL
- Background workers:
  - `app/scripts/retry_worker.py`
  - `app/scripts/weather_alert_worker.py`
  - `app/scripts/price_alert_worker.py`
- Web server: Nginx
- Process manager: systemd

Target host details provided for this rollout:

- VPS: `147.93.72.240`
- SSH user: `root`
- Linux root path: `/var/www/agrik.co`

This guide is designed for fast initial go-live and safe daily upgrades after launch.

## 0. Current rollout state

This guide now assumes the following exact situation:

- Nginx is already installed on the VPS and already serving `agrik.co`
- the GitHub repository is [`https://github.com/sisilabsai/agrik`](https://github.com/sisilabsai/agrik)
- the AGRIK codebase has already been pushed to GitHub
- the repo has already been cloned to `/var/www/agrik.co/app`
- PostgreSQL is already installed
- PostgreSQL already has:
  - database: `agrik_db`
  - user: `agrik_user`

That means the correct order is:

1. place the production env files on the VPS
2. install systemd units
3. replace the current Nginx `coming soon` site with the AGRIK config
4. run the first deployment
5. verify the live site

## 1. GitHub source of truth

GitHub is now the source of truth for production:

- repo: [`https://github.com/sisilabsai/agrik`](https://github.com/sisilabsai/agrik)
- server checkout: `/var/www/agrik.co/app`

This repo now includes [`.gitignore`](/D:/Projects/AGRIK/.gitignore) so these do not get pushed:

- `.env`
- `web/.env`
- virtualenv folders
- `node_modules`
- local databases
- runtime uploads
- local editor files

Do not commit the real VPS `.env` file or database password into GitHub.

## 2. Recommended production layout

Use this filesystem layout on the VPS:

```text
/var/www/agrik.co/
  app/                      # git checkout of this repo
  venv/                     # backend virtualenv
  runtime/                  # persistent media/models/runtime state
    market_media/
    models/
  shared/
    .env                    # backend env
    web.env.production      # frontend env
  backups/
  scripts/
```

Why this layout:

- `app/` can be updated freely from git
- `shared/.env` survives deployments
- `runtime/` keeps uploads and optional model files safe between releases
- `venv/` is stable and reused by systemd

## 3. Architecture

Use one domain for both the frontend and backend:

- `https://agrik.co` serves the Vite build
- Nginx proxies backend routes to `127.0.0.1:8000`
- systemd keeps the API and workers running

Routing strategy:

- Frontend static files: `/`
- Backend API routes proxied by Nginx:
  - `/auth/`
  - `/admin/`
  - `/market/`
  - `/profile/`
  - `/reference/`
  - `/weather/`
  - `/chat/`
  - `/voice/`
  - `/sms/`
  - `/health`
  - `/metrics`
  - `/docs`
  - `/redoc`
  - `/openapi.json`
  - `/market-media/`

Important frontend setting:

- `VITE_API_BASE_URL` should be `https://agrik.co`

This matches the current frontend code. Do not set it to `/api` unless the frontend API layer is changed first.

## 4. First deployment checklist

1. SSH into the VPS.
2. Create production env files from the templates in [deploy/hostinger/env/backend.env.production.example](/D:/Projects/AGRIK/deploy/hostinger/env/backend.env.production.example) and [deploy/hostinger/env/web.env.production.example](/D:/Projects/AGRIK/deploy/hostinger/env/web.env.production.example).
3. Run the bootstrap script in [bootstrap_server.sh](/D:/Projects/AGRIK/deploy/hostinger/bootstrap_server.sh).
4. Install Nginx and systemd templates from the `deploy/hostinger` folder.
5. Run the release script in [deploy_release.sh](/D:/Projects/AGRIK/deploy/hostinger/deploy_release.sh).
6. Issue or renew SSL with Certbot.
7. Test API, frontend, uploads, login, admin, and worker-driven alerts.

## 5. Current VPS starting point

You already have the code cloned on the VPS.

Start from:

```bash
ssh root@147.93.72.240
cd /var/www/agrik.co/app
```

If you ever need to refresh the clone manually:

```bash
cd /var/www/agrik.co/app
git fetch --all --prune
git pull --ff-only origin main
```

Then run:

```bash
bash deploy/hostinger/bootstrap_server.sh
```

## 6. Production env guidance

Backend env file location:

- `/var/www/agrik.co/shared/.env`

Frontend env file location:

- `/var/www/agrik.co/shared/web.env.production`

Minimum backend variables to set correctly:

- `APP_ENV=prod`
- `DATABASE_URL=postgresql+psycopg://agrik_user:<db_password>@localhost:5432/agrik_db`
- `AUTH_SECRET=<strong-random-secret>`
- `ADMIN_AUTH_SECRET=<strong-random-secret>`
- `CORS_ALLOWED_ORIGINS=https://agrik.co,https://www.agrik.co`
- `MARKET_MEDIA_DIR=/var/www/agrik.co/runtime/market_media`
- `AUTH_DEV_BYPASS_OTP=false`
- `ADMIN_REQUIRE_OTP=true`
- `ADMIN_SEED_EMAIL=<real-admin-email>`
- `ADMIN_SEED_PASSWORD=<temporary-strong-password>`
- all real SMS / voice / AI provider secrets you need in production

Env file rule:

- keep the production env files in plain `KEY=value` format
- if a value contains spaces, wrap it in quotes
- use the same safe format for both systemd and the backend loader

Minimum frontend variables:

- `VITE_API_BASE_URL=https://agrik.co`
- `VITE_API_TIMEOUT_MS=10000`
- `VITE_CHAT_TIMEOUT_MS=90000`

Recommended backend env skeleton for your VPS:

```dotenv
APP_ENV=prod
DATABASE_URL=postgresql+psycopg://agrik_user:<your-vps-db-password>@localhost:5432/agrik_db
DB_CONNECT_TIMEOUT=5
AUTH_SECRET=replace-with-a-long-random-secret
ADMIN_AUTH_SECRET=replace-with-another-long-random-secret
AUTH_DEV_BYPASS_OTP=false
ADMIN_REQUIRE_OTP=true
ADMIN_SEED_EMAIL=admin@agrik.co
ADMIN_SEED_PASSWORD=replace-with-a-strong-temp-password
CORS_ALLOWED_ORIGINS=https://agrik.co,https://www.agrik.co
MARKET_MEDIA_DIR=/var/www/agrik.co/runtime/market_media
```

Important:

- keep the real database password only in `/var/www/agrik.co/shared/.env`
- do not commit the real password into GitHub

## 7. Database plan

Recommended production database:

- PostgreSQL on the VPS for now

Current production database values:

- database: `agrik_db`
- user: `agrik_user`

The app already expects Alembic migrations in production. Use:

```bash
cd /var/www/agrik.co/app
source /var/www/agrik.co/venv/bin/activate
python - <<'PY'
import os
import subprocess
from dotenv import dotenv_values

for key, value in dotenv_values("/var/www/agrik.co/shared/.env").items():
    if value is not None:
        os.environ[key] = value

subprocess.run(["alembic", "upgrade", "head"], check=True)
PY
```

Do not rely on SQLite in production.

## 8. First-time server bootstrap

From the VPS:

```bash
cd /var/www/agrik.co/app
bash deploy/hostinger/bootstrap_server.sh
```

What the bootstrap script does:

- installs system packages
- creates the deployment directories
- creates the Python virtualenv if missing
- installs Node.js 20 if missing
- prepares runtime and backup directories

## 9. First-time release

After env files are created:

```bash
cd /var/www/agrik.co/app
bash deploy/hostinger/deploy_release.sh main
```

This command assumes:

- `/var/www/agrik.co/app` exists
- the repo has already been cloned from GitHub
- `/var/www/agrik.co/shared/.env` exists
- `/var/www/agrik.co/shared/web.env.production` exists

What the release script does:

- updates the git checkout
- links shared env files
- installs backend dependencies
- installs frontend dependencies
- runs the Vite production build
- runs Alembic migrations
- restarts systemd services

If your production branch is not `main`, pass the correct branch name instead.

## 10. systemd services

Install these units from [deploy/hostinger/systemd](/D:/Projects/AGRIK/deploy/hostinger/systemd):

- `agrik-api.service`
- `agrik-retry-worker.service`
- `agrik-weather-alert-worker.service`
- `agrik-price-alert-worker.service`

Suggested commands:

```bash
cp /var/www/agrik.co/app/deploy/hostinger/systemd/agrik-*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable agrik-api
systemctl enable agrik-retry-worker
systemctl enable agrik-weather-alert-worker
systemctl enable agrik-price-alert-worker
systemctl start agrik-api
systemctl start agrik-retry-worker
systemctl start agrik-weather-alert-worker
systemctl start agrik-price-alert-worker
```

Check status with:

```bash
systemctl status agrik-api
journalctl -u agrik-api -n 100 --no-pager
```

## 11. Nginx

Since Nginx already exists on your VPS, the key change is replacing the current `coming soon` site config with the AGRIK config.

Use the site template in [agrik.co.conf](/D:/Projects/AGRIK/deploy/hostinger/nginx/agrik.co.conf).

Install it with:

```bash
cp /var/www/agrik.co/app/deploy/hostinger/nginx/agrik.co.conf /etc/nginx/sites-available/agrik.co.conf
ln -s /etc/nginx/sites-available/agrik.co.conf /etc/nginx/sites-enabled/agrik.co.conf
nginx -t
systemctl reload nginx
```

If an old `agrik.co` config already exists, replace it instead of creating a second active config.

Recommended safe sequence:

```bash
cp /etc/nginx/sites-available/agrik.co.conf /etc/nginx/sites-available/agrik.co.conf.bak 2>/dev/null || true
cp /var/www/agrik.co/app/deploy/hostinger/nginx/agrik.co.conf /etc/nginx/sites-available/agrik.co.conf
nginx -t
systemctl reload nginx
```

Then issue SSL:

```bash
certbot --nginx -d agrik.co -d www.agrik.co
```

## 12. Automation plan

Use two layers:

### Layer 1: server-side release script

This is the reliable local deployment command:

```bash
bash /var/www/agrik.co/app/deploy/hostinger/deploy_release.sh main
```

### Layer 2: GitHub Actions deployment

Use the workflow template in [.github/workflows/deploy-production.yml](/D:/Projects/AGRIK/.github/workflows/deploy-production.yml).

Recommended repository secrets:

- `PROD_HOST`
- `PROD_USER`
- `PROD_SSH_KEY`
- `PROD_PORT`

Recommended values:

- `PROD_HOST=147.93.72.240`
- `PROD_USER=root` for the first rollout only
- `PROD_PORT=22`

Better long-term setup:

- create a dedicated deploy user
- give it access to `/var/www/agrik.co`
- move the workflow to that user
- disable password SSH login
- disable root SSH login

## 13. Daily release flow

Recommended ongoing flow:

1. Make changes locally in `D:\Projects\AGRIK`.
2. Commit and push those changes to GitHub.
3. GitHub Actions runs quick validation.
4. GitHub Actions connects to the VPS over SSH.
5. The server runs `deploy_release.sh`.
6. The VPS pulls the latest GitHub revision.
7. systemd restarts the services.
8. Nginx continues serving the latest frontend build.

For high-risk changes:

1. Push to a staging branch first.
2. Run manual smoke checks.
3. Promote to production branch.

Important rule:

- if a change exists only on your local machine, the VPS cannot deploy it yet
- the change must be committed and pushed to GitHub first
- after that, the VPS can pull and deploy it

Manual release sequence:

```powershell
cd D:\Projects\AGRIK
git add .
git commit -m "Describe the change"
git push origin main
```

Then on the VPS:

```bash
ssh root@147.93.72.240
cd /var/www/agrik.co/app
git pull --ff-only origin main
bash deploy/hostinger/deploy_release.sh main
```

## 14. Smoke test after each release

Run these checks after deployment:

```bash
curl -I https://agrik.co
curl https://agrik.co/health
curl https://agrik.co/metrics
systemctl is-active agrik-api
systemctl is-active agrik-retry-worker
systemctl is-active agrik-weather-alert-worker
systemctl is-active agrik-price-alert-worker
```

Also test in browser:

- home page loads
- sign in works
- marketplace loads
- admin sign in works
- provider dashboard loads
- farmer brain loads
- media upload works
- websocket voice connection works

## 15. Backups and rollback

Minimum backup policy:

- PostgreSQL daily dump
- copy of `/var/www/agrik.co/shared/.env`
- copy of `/var/www/agrik.co/runtime/`

Quick rollback options:

- checkout previous git commit on the server
- rerun `deploy_release.sh <previous-ref>`
- if migration was destructive, restore database backup first

Example PostgreSQL backup:

```bash
pg_dump -Fc agrik_db > /var/www/agrik.co/backups/agrik_db_$(date +%F_%H%M%S).dump
```

## 16. Security hardening before public traffic

Do these before broad rollout:

- switch SSH from password auth to SSH keys
- stop using `root` for regular deployments
- disable `AUTH_DEV_BYPASS_OTP`
- enable stronger admin auth controls
- use strong production secrets
- lock PostgreSQL to localhost if hosted on the VPS
- keep `ufw` enabled with only `22`, `80`, `443` open
- renew SSL automatically with Certbot timer
- monitor `journalctl` and Nginx logs after release

## 17. Recommended first production cut

For the first live release, keep scope tight:

- frontend
- API
- PostgreSQL
- three workers
- Nginx + SSL

Skip optional extras for the first go-live unless already required:

- Chroma
- Coqui local TTS
- Grafana
- Prometheus server outside the built-in `/metrics` endpoint

## 18. Clear first deployment sequence

Use this exact order for the first rollout:

1. On the VPS, confirm the app checkout exists:

```bash
ssh root@147.93.72.240
cd /var/www/agrik.co/app
git pull --ff-only origin main
```

2. Bootstrap the server:

```bash
cd /var/www/agrik.co/app
bash deploy/hostinger/bootstrap_server.sh
```

3. Create these files on the VPS:

- `/var/www/agrik.co/shared/.env`
- `/var/www/agrik.co/shared/web.env.production`

Use these core values in `/var/www/agrik.co/shared/.env`:

```dotenv
APP_ENV=prod
DATABASE_URL=postgresql+psycopg://agrik_user:<your-vps-db-password>@localhost:5432/agrik_db
DB_CONNECT_TIMEOUT=5
CORS_ALLOWED_ORIGINS=https://agrik.co,https://www.agrik.co
MARKET_MEDIA_DIR=/var/www/agrik.co/runtime/market_media
AUTH_DEV_BYPASS_OTP=false
ADMIN_REQUIRE_OTP=true
```

Use this in `/var/www/agrik.co/shared/web.env.production`:

```dotenv
VITE_API_BASE_URL=https://agrik.co
VITE_API_TIMEOUT_MS=10000
VITE_CHAT_TIMEOUT_MS=90000
```

4. Install services and site config:

```bash
cp /var/www/agrik.co/app/deploy/hostinger/systemd/agrik-*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable agrik-api agrik-retry-worker agrik-weather-alert-worker agrik-price-alert-worker
cp /var/www/agrik.co/app/deploy/hostinger/nginx/agrik.co.conf /etc/nginx/sites-available/agrik.co.conf
nginx -t
systemctl reload nginx
```

5. Run first release:

```bash
cd /var/www/agrik.co/app
bash deploy/hostinger/deploy_release.sh main
```

For later releases, the normal order is:

1. push local code changes to GitHub
2. pull on the VPS
3. run `deploy_release.sh main`

6. Add SSL:

```bash
certbot --nginx -d agrik.co -d www.agrik.co
```

7. Verify:

```bash
curl https://agrik.co/health
systemctl status agrik-api --no-pager
```

## 19. Known current assumptions

This deployment pack is based on the repo as it exists now.

Important assumptions:

- frontend is built on the VPS
- backend is served with Uvicorn behind Nginx
- one production instance is enough for now
- PostgreSQL is available on the server
- production branch is `main` unless you choose another branch

If you later want near-zero-downtime releases, the next step is moving from in-place deploys to release directories plus a `current` symlink.
