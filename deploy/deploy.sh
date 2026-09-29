#!/usr/bin/env bash
# Ships the latest pushed commit to the server: pulls, installs, builds and restarts.
#   TELLTALE_HOST=ubuntu@203.0.113.7 deploy/deploy.sh
# Push to GitHub first; the server deploys what's on main.
set -euo pipefail

HOST=${TELLTALE_HOST:?Set TELLTALE_HOST, e.g. TELLTALE_HOST=ubuntu@203.0.113.7}
KEY=${TELLTALE_SSH_KEY:-$HOME/.ssh/telltale_oracle}

ssh -i "$KEY" "$HOST" bash -se <<'REMOTE'
set -euo pipefail
cd /opt/telltale
before=$(git rev-parse --short HEAD)
git pull --ff-only
after=$(git rev-parse --short HEAD)
pnpm install --frozen-lockfile
pnpm build
# Unit files and the Caddyfile may have changed too.
sudo cp deploy/telltale-collector.service deploy/telltale-web.service deploy/telltale-backup.service deploy/telltale-backup.timer /etc/systemd/system/
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl restart telltale-collector telltale-web
sudo systemctl reload caddy
echo "Deployed $before → $after"
sleep 5
curl -fsS localhost:8740/api/health && echo
REMOTE
