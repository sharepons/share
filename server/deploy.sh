#!/usr/bin/env bash
# ⚠ Ships the source, not a build: this runs under node's strip-types loader, so there is no bundle
# to get out of date with the repo.
set -euo pipefail
: "${HOST:?set HOST, e.g. root@1.2.3.4}"

npm run check
npm test

rsync -az --delete \
  --exclude node_modules --exclude data --exclude .env \
  ./ "$HOST:/root/share-server/"

# ⛔ `.env` is NEVER synced. It holds the attestation key, and a --delete sync that overwrote it with
# a local copy would silently swap the signer the deployed vault is pinned to.
# ⛔ POLLED, NOT `sleep 1`. The unit takes about a second and a half to bind, so a single sleep-then-
# curl raced it and reported `Failed to connect to localhost port 5234` on a deploy that had in fact
# succeeded — the server was up and healthy two seconds later. A deploy script that cries wolf is
# worse than one with no check: the next real failure gets waved through.
ssh "$HOST" 'cd /root/share-server && npm install --omit=dev --silent && systemctl restart share-api && \
  for i in $(seq 1 20); do \
    if curl -fsS localhost:5234/api/health; then echo; exit 0; fi; \
    sleep 1; \
  done; \
  echo "share-api did not answer /api/health within 20s" >&2; \
  systemctl status share-api --no-pager -n 20; \
  exit 1'
