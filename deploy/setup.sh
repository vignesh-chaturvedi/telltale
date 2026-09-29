#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server (Oracle Cloud Ampere A1 or any arm64/x64 VM).
# Run it on the server as the default sudo user:
#   curl -fsSL https://raw.githubusercontent.com/vignesh-chaturvedi/telltale/main/deploy/setup.sh | bash
# It's safe to run again: every step checks what's already there.
set -euo pipefail

REPO=https://github.com/vignesh-chaturvedi/telltale.git
APP=/opt/telltale
DATA=/var/lib/telltale

say() { printf '\n==> %s\n' "$*"; }

say "System packages"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent sqlite3

if ! node --version 2>/dev/null | grep -q '^v2[4-9]'; then
  say "Node.js 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi

if ! command -v pnpm >/dev/null; then
  say "pnpm"
  sudo npm install -g --silent "pnpm@11"
fi

if ! command -v caddy >/dev/null; then
  say "Caddy"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq caddy
fi

say "Firewall: allow HTTP and HTTPS"
# Oracle's Ubuntu images ship iptables rules that reject everything except SSH, on top of the
# cloud security list. Insert the web ports before that reject rule and keep them across reboots.
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 5 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
  fi
done
sudo netfilter-persistent save

say "Service user and folders"
id telltale >/dev/null 2>&1 || sudo useradd --system --home "$DATA" --shell /usr/sbin/nologin telltale
sudo mkdir -p "$DATA"
sudo chown telltale:telltale "$DATA"
sudo chmod 750 "$DATA"
if [ ! -f /etc/telltale.env ]; then
  printf '# Secrets for Telltale, e.g. HYDROMANCER_API_KEY=...\n' | sudo tee /etc/telltale.env >/dev/null
  sudo chown root:telltale /etc/telltale.env
  sudo chmod 640 /etc/telltale.env
fi

say "Code"
if [ ! -d "$APP/.git" ]; then
  sudo git clone --depth 50 "$REPO" "$APP"
fi
sudo chown -R "$USER":"$USER" "$APP"
cd "$APP"
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build

say "Services"
sudo cp deploy/telltale-collector.service deploy/telltale-web.service deploy/telltale-backup.service deploy/telltale-backup.timer /etc/systemd/system/
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo mkdir -p /var/log/caddy
sudo chown caddy:caddy /var/log/caddy
sudo systemctl daemon-reload
sudo systemctl enable --now telltale-collector telltale-web telltale-backup.timer
sudo systemctl reload caddy || sudo systemctl restart caddy

say "Done"
systemctl --no-pager --lines=0 status telltale-collector telltale-web caddy | grep -E '●|Active:'
echo
echo "Check the collector:  journalctl -u telltale-collector -f"
echo "Check the website:    curl -s localhost:8740/api/health"
echo "HTTPS starts working once telltale.markets points at this server's public IP."
