#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/var/www/agrik.co"
APP_DIR="$APP_ROOT/app"
VENV_DIR="$APP_ROOT/venv"
SHARED_DIR="$APP_ROOT/shared"
RUNTIME_DIR="$APP_ROOT/runtime"
BACKEND_ENV="$SHARED_DIR/.env"
WEB_ENV="$SHARED_DIR/web.env.production"
BRANCH="${1:-main}"

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
mkdir -p "$RUNTIME_DIR/market_media" "$RUNTIME_DIR/models" "$APP_DIR/runtime"

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

echo "==> Installing backend dependencies"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/pip" install -r "$APP_DIR/requirements.txt"

if ! command -v npm >/dev/null 2>&1; then
  echo "==> npm missing, installing Node.js 20"
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to install Node.js" >&2
    exit 1
  fi
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Installing frontend dependencies"
cd "$APP_DIR/web"
npm ci

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

subprocess.run(["alembic", "upgrade", "head"], check=True)
PY

echo "==> Restarting services"
systemctl restart agrik-api
systemctl restart agrik-retry-worker
systemctl restart agrik-weather-alert-worker
systemctl restart agrik-price-alert-worker

echo "==> Release complete"
systemctl --no-pager --full status agrik-api || true
