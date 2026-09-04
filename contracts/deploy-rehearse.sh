#!/usr/bin/env bash
#
# Runs `deploy.sh` — the real file, unmodified — against a local anvil forking live Robinhood
# Chain, then checks what it produced.
#
# ⛔⛔ WHY THIS EXISTS: `deploy.sh` had NEVER BEEN RUN. It shipped with a syntax error that stopped
# the whole file from parsing, found on 4 Sep 2026 by `bash -n` alone. `bash -n` proves a script
# parses; it proves nothing about `forge create --json` printing something the parser downstream can
# read, about the constructor arguments being in the right order, or about the two contracts coming
# out wired to each other. Deploy day is a bad time to learn any of that, on a script holding a
# private key, against a chain where a wrong `minSocialBps` is permanent.
#
# ⭐ It is `deploy.sh` that runs here, not a copy of it. A rehearsal that reimplements the thing it
# is rehearsing tests the copy. Only `RHC_RPC_URL` and the three key variables differ from a real
# deploy — the factory address, the argument order and the immutable floor all come from the file.
#
# ⛔ NOTHING IS BROADCAST TO A REAL CHAIN. anvil holds every transaction; the keys are generated
# here, funded with fake money and thrown away at the end.
#
#   ./deploy-rehearse.sh
#
# ⚠ Run `./rehearse.sh` too. That one asks "is Pons still there"; this one asks "does our deploy
# script work". Neither answers the other's question.
set -euo pipefail

cd "$(dirname "$0")"

PROXY_PORT="${RPC_PROXY_PORT:-8899}"
PROXY="http://127.0.0.1:${PROXY_PORT}"
ANVIL_PORT="${ANVIL_PORT:-8546}"
ANVIL="http://127.0.0.1:${ANVIL_PORT}"

STARTED_PROXY=0
PROXY_PID=""
ANVIL_PID=""

cleanup() {
  [ -n "$ANVIL_PID" ] && kill "$ANVIL_PID" 2>/dev/null || true
  if [ "$STARTED_PROXY" = "1" ] && [ -n "$PROXY_PID" ]; then kill "$PROXY_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

rpc_up() {
  curl -s -o /dev/null -m 2 -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$1"
}

fail() { echo "⛔ $*" >&2; exit 1; }
ok()   { echo "   ✓ $*"; }

# ------------------------------------------------------------------ the fork --

if rpc_up "$PROXY"; then
  echo "==> reusing the proxy already listening on ${PROXY}"
else
  echo "==> starting the RPC proxy on ${PROXY}"
  node ../scripts/rpc-proxy.mjs >/tmp/share-rpc-proxy.log 2>&1 &
  PROXY_PID=$!
  STARTED_PROXY=1
  for _ in $(seq 1 25); do rpc_up "$PROXY" >/dev/null && break; sleep 0.2; done
  rpc_up "$PROXY" >/dev/null || fail "the proxy never came up — see /tmp/share-rpc-proxy.log"
fi

echo "==> forking Robinhood Chain into anvil on ${ANVIL}"
anvil --fork-url "$PROXY" --port "$ANVIL_PORT" --silent >/tmp/share-anvil.log 2>&1 &
ANVIL_PID=$!
for _ in $(seq 1 60); do rpc_up "$ANVIL" >/dev/null && break; sleep 0.5; done
rpc_up "$ANVIL" >/dev/null || fail "anvil never came up — see /tmp/share-anvil.log"

CHAIN=$(cast chain-id --rpc-url "$ANVIL")
[ "$CHAIN" = "4663" ] || fail "forked chain ${CHAIN}, expected 4663 — the proxy is pointing somewhere else"
ok "chain ${CHAIN} at block $(cast block-number --rpc-url "$ANVIL")"

# ------------------------------------------------------------------- the keys --
#
# ⛔⛔ NOT anvil's dev accounts. Its keys are public, so on RHC those addresses are real, used
# accounts — account 0 has 249 transactions — and anvil's genesis balance for them is silently
# replaced by the real one the moment something resolves the account against the fork. Fresh random
# keys have nothing to resolve to. Each is checked against the LIVE chain before it is used.

new_key() {
  cast wallet new --json | python3 -c 'import json,sys; w=json.load(sys.stdin)[0]; print(w["private_key"], w["address"])'
}

read -r DEPLOYER_KEY DEPLOYER_ADDR <<<"$(new_key)"
read -r _OWNER_KEY OWNER <<<"$(new_key)"
# ⚠ The signer's PRIVATE key is kept, not just its address: the preflight at the end of this script
# has to derive an address from it exactly the way the server will.
read -r SIGNER_KEY SIGNER <<<"$(new_key)"
read -r WRONG_KEY WRONG_SIGNER <<<"$(new_key)"

for a in "$DEPLOYER_ADDR" "$OWNER" "$SIGNER"; do
  # ⚠ Against the LIVE chain through the proxy, not against anvil — anvil would answer for its own
  # overrides and tell us nothing about whether the address is already somebody's.
  [ "$(cast code "$a" --rpc-url "$PROXY")" = "0x" ] || fail "$a already has code on live RHC"
  [ "$(cast nonce "$a" --rpc-url "$PROXY")" = "0" ] || fail "$a has already sent transactions on live RHC"
done
ok "three fresh keys, none of which exists on Robinhood Chain"

cast rpc anvil_setBalance "$DEPLOYER_ADDR" 0x56BC75E2D63100000 --rpc-url "$ANVIL" >/dev/null  # 100 ETH
ok "deployer ${DEPLOYER_ADDR} funded with fake money"

# ------------------------------------------------- the refusal must actually refuse --
#
# ⛔ The one branch in deploy.sh that is supposed to stop a deploy. Untested it is a comment.

echo "==> deploy.sh must REFUSE when OWNER == SIGNER"
set +e
REFUSAL=$(RHC_RPC_URL="$ANVIL" DEPLOYER_KEY="$DEPLOYER_KEY" OWNER="$OWNER" SIGNER="$OWNER" ./deploy.sh 2>&1)
REFUSED=$?
set -e
[ "$REFUSED" -ne 0 ] || fail "deploy.sh deployed with one key doing both jobs"
echo "$REFUSAL" | grep -q "must differ" || fail "it exited non-zero but said nothing about why"
ok "refused, exit ${REFUSED}"

# ⚠ And it must refuse BEFORE spending anything. A check that runs after the first `forge create`
# leaves a stray vault on chain every time somebody gets the arguments wrong.
[ "$(cast nonce "$DEPLOYER_ADDR" --rpc-url "$ANVIL")" = "0" ] || fail "the refusal happened AFTER a deploy — a contract is now stranded on chain"
ok "refused before sending a transaction"

for v in DEPLOYER_KEY OWNER SIGNER; do
  set +e
  OUT=$(env -u "$v" RHC_RPC_URL="$ANVIL" DEPLOYER_KEY="$DEPLOYER_KEY" OWNER="$OWNER" SIGNER="$SIGNER" \
        bash -c "unset $v; ./deploy.sh" 2>&1)
  RC=$?
  set -e
  [ "$RC" -ne 0 ] || fail "deploy.sh ran with no $v"
done
ok "each of DEPLOYER_KEY, OWNER and SIGNER is required"

# ------------------------------------------------------------- the real thing --

echo "==> running deploy.sh"
OUTPUT=$(RHC_RPC_URL="$ANVIL" DEPLOYER_KEY="$DEPLOYER_KEY" OWNER="$OWNER" SIGNER="$SIGNER" ./deploy.sh)
echo "$OUTPUT" | sed 's/^/   | /'

# ⭐ Parsed out of the block deploy.sh tells the operator to copy, so this also proves that block is
# readable. A deploy whose output has to be interpreted is a deploy that gets transcribed wrong.
CLAIMS=$(echo "$OUTPUT" | sed -n 's/^ *VITE_CLAIMS=//p')
PAD=$(echo "$OUTPUT" | sed -n 's/^ *VITE_LAUNCHPAD=//p')
CLAIMS_ENV=$(echo "$OUTPUT" | sed -n 's/^ *CLAIMS_ADDRESS=//p')

echo "==> checking what it produced"
case "$CLAIMS" in 0x*) ;; *) fail "no VITE_CLAIMS in the output — the --json parse gave '$CLAIMS'";; esac
case "$PAD"    in 0x*) ;; *) fail "no VITE_LAUNCHPAD in the output — the --json parse gave '$PAD'";; esac
[ "$CLAIMS_ENV" = "$CLAIMS" ] || fail "CLAIMS_ADDRESS ($CLAIMS_ENV) and VITE_CLAIMS ($CLAIMS) disagree"
ok "both addresses printed, and the server's copy matches the site's"

[ "$(cast code "$CLAIMS" --rpc-url "$ANVIL")" != "0x" ] || fail "nothing deployed at $CLAIMS"
[ "$(cast code "$PAD"    --rpc-url "$ANVIL")" != "0x" ] || fail "nothing deployed at $PAD"
ok "there is code at both"

eq() {
  local got want what
  got=$(echo "$2" | tr 'A-Z' 'a-z'); want=$(echo "$3" | tr 'A-Z' 'a-z')
  [ "$got" = "$want" ] || fail "$1: got $2, expected $3"
  ok "$1 = $3"
}

eq "claims.owner()"  "$(cast call "$CLAIMS" 'owner()(address)'  --rpc-url "$ANVIL")" "$OWNER"
eq "claims.signer()" "$(cast call "$CLAIMS" 'signer()(address)' --rpc-url "$ANVIL")" "$SIGNER"
eq "pad.claims()"    "$(cast call "$PAD" 'claims()(address)'    --rpc-url "$ANVIL")" "$CLAIMS"

# ⛔ The factory is read back from the deployed launchpad and compared to the ONE the fork rehearsal
# pins, which is hard-coded there rather than shared with deploy.sh precisely so this comparison
# means something. A sibling project shipped a stale factory twice and rehearsed it green both times.
FACTORY_PINNED=$(grep -o '0x7eD598Bc[0-9a-fA-F]*' test/PonsFork.t.sol | head -1)
eq "pad.factory()" "$(cast call "$PAD" 'factory()(address)' --rpc-url "$ANVIL")" "$FACTORY_PINNED"

# ⛔⛔ `minSocialBps` IS IMMUTABLE. Whatever deploy.sh sends is the value forever; a non-zero one
# reverts every launch below it with no setter to relax it. This reads back what the file actually
# does, not what its comments say.
FLOOR=$(cast call "$PAD" 'minSocialBps()(uint16)' --rpc-url "$ANVIL")
[ "$FLOOR" = "${EXPECT_MIN_SOCIAL_BPS:-0}" ] || fail "minSocialBps is $FLOOR and is PERMANENT — expected ${EXPECT_MIN_SOCIAL_BPS:-0}"
ok "minSocialBps = ${FLOOR} (immutable, and this is the value that would ship)"

# ⭐ The escrow is not a constructor argument — the launchpad reads it off the factory at deploy
# time and caches it immutably. If Pons ever repoints its escrow, a launchpad deployed before that
# harvests from the wrong one, silently.
ESCROW_PAD=$(cast call "$PAD" 'escrow()(address)' --rpc-url "$ANVIL")
ESCROW_LIVE=$(cast call "$FACTORY_PINNED" 'feeEscrow()(address)' --rpc-url "$ANVIL")
eq "pad.escrow()" "$ESCROW_PAD" "$ESCROW_LIVE"

# ------------------------------------------- and it must be able to launch --
#
# ⭐⭐ THE POINT OF DOING THIS ON A FORK RATHER THAN A BARE ANVIL. These are the addresses deploy.sh
# just produced, driven against the REAL Pons factory. `rehearse.sh` proves the source can launch;
# this proves the thing the script deployed can, at the floor the script actually sets.

echo "==> a launch through the contracts deploy.sh just deployed"
SHARE_CLAIMS="$CLAIMS" SHARE_LAUNCHPAD="$PAD" RHC_RPC_URL="$ANVIL" \
  forge test --match-path 'test/DeployedFork.t.sol' -vv

# ------------------------------------------------- and the wiring check agrees --
#
# ⭐⭐ THE OTHER HALF OF A DEPLOY. `deploy.sh` prints three lines and a person copies them into two
# files by hand; `server/npm run preflight` is what says the chain, the server and the site describe
# the same deployment. Run here, against a deployment that exists for four seconds, it is proven at
# the same moment as the script that produces its input — and proven to FAIL when it should, which
# is the half of a checker nobody ever tests.
#
# ⚠ Real environment variables beat `.env`, so this exercises the operator's actual server code
# without touching their `.env` or their web build.

WEB_ENV_FILE="$(mktemp -t share-preflight-web)"
cat > "$WEB_ENV_FILE" <<ENVFILE
VITE_LAUNCHPAD=$PAD
VITE_CLAIMS=$CLAIMS
VITE_SITE_URL=https://sharepons.family
ENVFILE
trap 'rm -f "$WEB_ENV_FILE"; cleanup' EXIT

preflight() {
  (cd ../server && env RHC_RPC_URL="$ANVIL" WEB_ENV="$WEB_ENV_FILE" CHAIN_ID=4663 \
      PUBLIC_URL=https://sharepons.family CLAIMS_ADDRESS="$CLAIMS" ATTESTATION_KEY="$1" \
      npm run --silent preflight 2>&1)
}

echo "==> the preflight must PASS on this deployment"
if OUT=$(preflight "$SIGNER_KEY"); then
  echo "$OUT" | sed 's/^/   | /'
else
  echo "$OUT" | sed 's/^/   | /'
  fail "the preflight rejected a correctly wired deployment"
fi

# ⛔⛔ A CHECKER THAT HAS NEVER FAILED IS NOT A CHECKER. This is the exact production incident it
# exists for: the server holding a key that is not the vault's signer. Everything else about the
# deployment is right, so nothing but this check can see it.
echo "==> and it must FAIL when the server holds the wrong signing key"
set +e
OUT=$(preflight "$WRONG_KEY")
RC=$?
set -e
[ "$RC" -ne 0 ] || fail "the preflight PASSED a server whose key is not the vault's signer"
echo "$OUT" | grep -q "NOT THE VAULT'S SIGNER" || fail "it failed, but not for the signer mismatch"
# ⭐ Printed, not just matched. The value of this alarm is entirely in whether an operator reading it
# at 2am knows what to do, and that is not something a grep can assert.
echo "$OUT" | sed -n '/NOT THE VAULT/,/setSigner/p' | sed 's/^/   | /'
ok "rejected the wrong key, and said which address the vault expects"

echo
echo "✅ deploy.sh and the preflight both work end to end. Nothing above touched a real chain or key."
