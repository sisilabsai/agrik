#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/var/www/agrik.co"
APP_DIR="$APP_ROOT/app"
VENV_DIR="$APP_ROOT/venv"
RUNTIME_DIR="$APP_ROOT/runtime"
SHARED_DIR="$APP_ROOT/shared"
BACKUP_DIR="$APP_ROOT/backups"
SCRIPTS_DIR="$APP_ROOT/scripts"

echo "==> Installing base system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  git \
  curl \
  nginx \
  certbot \
  python3-certbot-nginx \
  python3 \
  python3-venv \
  python3-pip \
  build-essential \
  libpq-dev \
  ffmpeg \
  postgresql \
  postgresql-contrib \
  ufw

if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Creating deployment directories"
mkdir -p "$APP_ROOT" "$APP_DIR" "$RUNTIME_DIR/market_media" "$RUNTIME_DIR/models" "$SHARED_DIR" "$BACKUP_DIR" "$SCRIPTS_DIR"

if [ ! -d "$VENV_DIR" ]; then
  echo "==> Creating Python virtualenv"
  python3 -m venv "$VENV_DIR"
fi

echo "==> Enabling firewall defaults"
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true

echo "==> Bootstrap complete"
echo "Next steps:"
echo "1. Put backend env at $SHARED_DIR/.env"
echo "2. Put frontend env at $SHARED_DIR/web.env.production"
echo "3. Install systemd and Nginx templates from deploy/hostinger"
echo "4. Run: bash $APP_DIR/deploy/hostinger/deploy_release.sh main"
