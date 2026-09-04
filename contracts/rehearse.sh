#!/usr/bin/env bash
#
# Rehearse a SHARE launch against the REAL Pons V2, on a local fork of Robinhood Chain.
#
# ⭐⭐ RUN THIS BEFORE ANY DEPLOY, AND AFTER ANY PONS ANNOUNCEMENT. The 71 mock tests agree with this
# repo by construction; they cannot notice that the factory moved, that launches closed, or that a
# struct grew a field. This is the only thing here that talks to the deployed contracts.
#
# ⛔ NOTHING IS BROADCAST AND NO KEY IS USED. Every transaction happens on a local fork.
#
#   ./rehearse.sh
#
# It starts the loopback proxy itself, because forge cannot set a User-Agent and RHC sits behind
# Cloudflare — see scripts/rpc-proxy.mjs.
set -euo pipefail

cd "$(dirname "$0")"

PORT="${RPC_PROXY_PORT:-8899}"
PROXY="http://127.0.0.1:${PORT}"
STARTED_PROXY=0

cleanup() {
  if [ "$STARTED_PROXY" = "1" ] && [ -n "${PROXY_PID:-}" ]; then
    kill "$PROXY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ⚠ Reuse a proxy that is already up rather than failing on the port, so this can be run repeatedly
# while iterating with one long-lived proxy in another terminal.
if curl -s -o /dev/null -m 2 -X POST -H 'Content-Type: application/json' \
     --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$PROXY"; then
  echo "==> reusing the proxy already listening on ${PROXY}"
else
  echo "==> starting the RPC proxy on ${PROXY}"
  node ../scripts/rpc-proxy.mjs >/tmp/share-rpc-proxy.log 2>&1 &
  PROXY_PID=$!
  STARTED_PROXY=1
  for _ in $(seq 1 25); do
    curl -s -o /dev/null -m 1 -X POST -H 'Content-Type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$PROXY" && break
    sleep 0.2
  done
fi

CHAIN=$(curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$PROXY" \
  | python3 -c 'import json,sys; print(int(json.load(sys.stdin)["result"],16))')
echo "==> forking chain ${CHAIN}"

# ⛔ `--no-match-path` on the mock suites, not `--match-contract`: the fork file is the only one that
# should reach the network, and a mock test dragged onto a fork is slow for no benefit.
RHC_RPC_URL="$PROXY" forge test --match-path 'test/PonsFork.t.sol' -vv "$@"
