#!/usr/bin/env bash
#
# Takes a launch made by the LIVE ShareLaunchpad all the way through graduation, on a fork.
#
# ⛔⛔ WHY: graduation is where this stack keeps losing money. The front end was hardened against a
# SIBLING project's graduated pool; no SHARE launch had ever graduated, and a splitter built by this
# launchpad had never been on the far side of one. This is the only thing that proves it works.
#
#   ./graduate-rehearse.sh
#
# ⛔ NOTHING IS BROADCAST and no key is used. Every transaction happens on a local fork of live RHC.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${RPC_PROXY_PORT:-8899}"
PROXY="http://127.0.0.1:${PORT}"
STARTED=0
cleanup() { [ "$STARTED" = "1" ] && [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null || true; }
trap cleanup EXIT

up() { curl -s -o /dev/null -m 2 -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$PROXY"; }

if up; then echo "==> reusing the proxy on ${PROXY}"; else
  echo "==> starting the RPC proxy on ${PROXY}"
  node ../scripts/rpc-proxy.mjs >/tmp/share-rpc-proxy.log 2>&1 & PID=$!; STARTED=1
  for _ in $(seq 1 25); do up >/dev/null && break; sleep 0.2; done
fi

# ⛔ The LIVE deployed addresses, not a fresh pair. Testing a fresh deploy would prove the source
# compiles; this proves the contracts that will take real launches survive graduation.
SHARE_CLAIMS="${SHARE_CLAIMS:-0x3cA5569e679b6A4D271d93342B7Ca7ad8e3b46FC}" \
SHARE_LAUNCHPAD="${SHARE_LAUNCHPAD:-0x6E96c9EC71e60893F7C3084bECfAb712a72779f7}" \
RHC_RPC_URL="$PROXY" \
  forge test --match-path 'test/GraduationFork.t.sol' -vv "$@"
