#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
release="$(date -u +%Y%m%dT%H%M%SZ)"
base=/home/agent/bizroam
remote="$base/releases/$release"
ssh deploy "umask 077; mkdir -p '$remote' '$base/secrets' '$base/data' '$base/backups'"
tar --exclude=node_modules --exclude=.git --exclude=.secrets --exclude=.data --exclude=dist --exclude=dist-ui --exclude=test-results --exclude=playwright-report -czf - . | ssh deploy "tar -xzf - -C '$remote'"
if ! ssh deploy "test -f '$base/secrets/web.env'"; then
  test -f .secrets/web.env || { echo 'Run npm run secrets first.' >&2; exit 1; }
  scp .secrets/web.env .secrets/tools.env .secrets/worker.env .secrets/app-password.txt "deploy:$base/secrets/"
fi
ssh deploy bash -s -- "$release" <<'REMOTE'
set -euo pipefail
release=$1
base=/home/agent/bizroam
remote="$base/releases/$release"
sudo install -d -m 700 -o 1000 -g 1000 "$base/data/web" "$base/data/tools" "$base/data/codex" "$base/data/workspace"
printf 'RELEASE=%s\nSECRETS_DIR=%s\nDATA_DIR=%s\n' "$release" "$base/secrets" "$base/data" > "$remote/deploy/.env"
cd "$remote/deploy"
docker compose config --quiet
docker compose build web
docker compose stop
sudo tar -czf "$base/backups/$release.tar.gz" -C "$base/data" .
sudo chmod 600 "$base/backups/$release.tar.gz"
docker compose create
docker compose up -d --wait
sudo python3 ../deploy/firewall.py
ln -sfn "$remote" "$base/current"
sudo install -m 644 ../deploy/bizroam-firewall.service /etc/systemd/system/bizroam-firewall.service
sudo systemctl daemon-reload
sudo systemctl enable bizroam-firewall.service
sudo systemctl restart bizroam-firewall.service
REMOTE
printf 'Release %s installed on Capsule WIP.\n' "$release"
