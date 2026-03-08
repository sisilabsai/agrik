#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/var/www/agrik.co"
APP_DIR="$APP_ROOT/app"
VENV_DIR="$APP_ROOT/venv"
SHARED_DIR="$APP_ROOT/shared"
RUNTIME_DIR="$APP_ROOT/runtime"
BACKEND_ENV="$SHARED_DIR/.env"
WEB_ENV="$SHARED_DIR/web.env.production"
DEPLOY_STATE_DIR="$SHARED_DIR/deploy-state"
BACKEND_HASH_FILE="$DEPLOY_STATE_DIR/backend-deps.sha256"
FRONTEND_HASH_FILE="$DEPLOY_STATE_DIR/frontend-deps.sha256"
BRANCH="${1:-main}"

hash_files() {
  sha256sum "$@" | sha256sum | awk '{print $1}'
}

cd "$APP_DIR"

if [ ! -f "$BACKEND_ENV" ]; then
  echo "Missing backend env file: $BACKEND_ENV" >&2
  exit 1
fi

if [ ! -f "$WEB_ENV" ]; then
  echo "Missing frontend env file: $WEB_ENV" >&2
  exit 1
fi

echo "==> Preparing shared directories"
mkdir -p "$RUNTIME_DIR/market_media" "$RUNTIME_DIR/models" "$APP_DIR/runtime" "$DEPLOY_STATE_DIR"

echo "==> Updating git checkout"
git fetch --all --prune
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git checkout "$BRANCH"
else
  git checkout -b "$BRANCH" "origin/$BRANCH"
fi
git pull --ff-only origin "$BRANCH"

echo "==> Linking production env files"
ln -sfn "$BACKEND_ENV" "$APP_DIR/.env"
ln -sfn "$WEB_ENV" "$APP_DIR/web/.env.production.local"

python_import_check() {
  "$VENV_DIR/bin/python" - <<'PY'
import importlib
import os
import sys
from dotenv import dotenv_values

env_path = "/var/www/agrik.co/app/.env"
values = dotenv_values(env_path)
for key, value in values.items():
    if value is not None:
        os.environ[key] = value

required = ["fastapi", "uvicorn", "sqlalchemy", "httpx", "edge_tts", "faster_whisper"]
missing = []
for module in required:
    try:
        importlib.import_module(module)
    except Exception:
        missing.append(module)

if missing:
    print(",".join(missing))
    sys.exit(1)
PY
}

if [ ! -x "$VENV_DIR/bin/python" ]; then
  echo "==> Python virtualenv missing, creating $VENV_DIR"
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required but was not found" >&2
    exit 1
  fi
  python3 -m venv "$VENV_DIR"
fi

if [ ! -x "$VENV_DIR/bin/python" ]; then
  echo "Virtualenv creation failed: $VENV_DIR/bin/python not found" >&2
  exit 1
fi

BACKEND_HASH="$(hash_files "$APP_DIR/requirements.txt")"
if [ ! -f "$BACKEND_HASH_FILE" ] || [ "$(<"$BACKEND_HASH_FILE")" != "$BACKEND_HASH" ]; then
  echo "==> Installing backend dependencies"
  "$VENV_DIR/bin/python" -m pip install --upgrade pip
  "$VENV_DIR/bin/pip" install -r "$APP_DIR/requirements.txt"
  printf '%s' "$BACKEND_HASH" > "$BACKEND_HASH_FILE"
else
  echo "==> Backend dependencies unchanged, skipping reinstall"
  if ! python_import_check >/tmp/agrik-missing-python-modules.log 2>&1; then
    echo "==> Backend runtime modules missing, reinstalling dependencies"
    cat /tmp/agrik-missing-python-modules.log || true
    "$VENV_DIR/bin/python" -m pip install --upgrade pip
    "$VENV_DIR/bin/pip" install -r "$APP_DIR/requirements.txt"
    printf '%s' "$BACKEND_HASH" > "$BACKEND_HASH_FILE"
  fi
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "==> npm missing, installing Node.js 20"
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to install Node.js" >&2
    exit 1
  fi
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

cd "$APP_DIR/web"
FRONTEND_HASH="$(hash_files "$APP_DIR/web/package.json" "$APP_DIR/web/package-lock.json")"
if [ ! -d "$APP_DIR/web/node_modules" ] || [ ! -f "$FRONTEND_HASH_FILE" ] || [ "$(<"$FRONTEND_HASH_FILE")" != "$FRONTEND_HASH" ]; then
  echo "==> Installing frontend dependencies"
  npm ci
  printf '%s' "$FRONTEND_HASH" > "$FRONTEND_HASH_FILE"
else
  echo "==> Frontend dependencies unchanged, skipping npm ci"
fi

echo "==> Building frontend"
npm run build

echo "==> Running database migrations"
cd "$APP_DIR"
"$VENV_DIR/bin/python" - <<'PY'
import os
import subprocess
from dotenv import dotenv_values

env_path = "/var/www/agrik.co/app/.env"
values = dotenv_values(env_path)
for key, value in values.items():
    if value is not None:
        os.environ[key] = value

subprocess.run(
    [os.path.join("/var/www/agrik.co/venv/bin", "python"), "-m", "alembic", "upgrade", "head"],
    check=True,
)
PY

echo "==> Installing/updating systemd services"
cp "$APP_DIR/deploy/hostinger/systemd/agrik-api.service" /etc/systemd/system/agrik-api.service
cp "$APP_DIR/deploy/hostinger/systemd/agrik-retry-worker.service" /etc/systemd/system/agrik-retry-worker.service
cp "$APP_DIR/deploy/hostinger/systemd/agrik-weather-alert-worker.service" /etc/systemd/system/agrik-weather-alert-worker.service
cp "$APP_DIR/deploy/hostinger/systemd/agrik-price-alert-worker.service" /etc/systemd/system/agrik-price-alert-worker.service
systemctl daemon-reload
systemctl enable agrik-api agrik-retry-worker agrik-weather-alert-worker agrik-price-alert-worker

echo "==> Installing/updating Nginx site"
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
if [ ! -f /etc/nginx/sites-available/agrik.co ] || [ "${FORCE_NGINX_DEPLOY:-0}" = "1" ]; then
  cp "$APP_DIR/deploy/hostinger/nginx/agrik.co.conf" /etc/nginx/sites-available/agrik.co
else
  echo "==> Preserving existing /etc/nginx/sites-available/agrik.co to avoid overwriting SSL/certbot state"
fi
ln -sfn /etc/nginx/sites-available/agrik.co /etc/nginx/sites-enabled/agrik.co
rm -f /etc/nginx/sites-enabled/agrik.co.conf
if [ -L /etc/nginx/sites-enabled/default ]; then
  rm -f /etc/nginx/sites-enabled/default
fi
nginx -t
systemctl reload nginx

echo "==> Restarting services"
systemctl restart agrik-api
systemctl restart agrik-retry-worker
systemctl restart agrik-weather-alert-worker
systemctl restart agrik-price-alert-worker

echo "==> Release complete"
systemctl --no-pager --full status agrik-api || true
