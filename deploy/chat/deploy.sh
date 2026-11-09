#!/usr/bin/env bash
# Deploy the chat server (agent/server.ts) to the Vercel project fluid-labs/groundswell-agent as a container.
# The build context is assembled outside the repo: agent/ (no node_modules, no .env), db/schema.sql and a
# consistent snapshot of db/groundswell.sqlite (gitignored, 100+ MB, so it cannot come from Git).
# Run after every export so the public chat answers from the same data as the map.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${TMPDIR:-/tmp}/groundswell-agent-deploy"

rm -rf "$OUT/app" && mkdir -p "$OUT/app/db"
rsync -a --exclude node_modules --exclude '.env*' "$ROOT/agent/" "$OUT/app/agent/"
cp "$ROOT/db/schema.sql" "$OUT/app/db/"
# .backup is safe while an agent run writes; the busy timeout waits for its locks
sqlite3 -cmd ".timeout 30000" "$ROOT/db/groundswell.sqlite" ".backup '$OUT/snapshot.sqlite'"
[ "$(sqlite3 "$OUT/snapshot.sqlite" 'pragma integrity_check')" = ok ]
gzip -c "$OUT/snapshot.sqlite" > "$OUT/app/db/groundswell.sqlite.gz" && rm "$OUT/snapshot.sqlite"
cp "$ROOT/deploy/chat/Dockerfile" "$OUT/Dockerfile"
printf '.env*\n.vercel\n' > "$OUT/.vercelignore"

cd "$OUT"
[ -f .vercel/project.json ] || npx vercel link --yes --project groundswell-agent --scope fluid-labs
npx vercel deploy --prod --yes
