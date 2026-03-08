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

echo "==> Installing backend dependencies"
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip
pip install -r "$APP_DIR/requirements.txt"

echo "==> Installing frontend dependencies"
cd "$APP_DIR/web"
npm ci

echo "==> Building frontend"
npm run build

echo "==> Running database migrations"
cd "$APP_DIR"
python <<'PY'
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
