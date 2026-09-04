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
ssh "$HOST" 'cd /root/share-server && npm install --omit=dev --silent && systemctl restart share-api && sleep 1 && curl -sS localhost:5234/api/health'
