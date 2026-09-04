#!/usr/bin/env bash
# Deploys SHARE's three contracts, in the only order they can go in.
#
# ⛔⛔ THE ORDER IS FORCED. Every splitter is constructed with the vault's address and cannot be
# repointed, so the vault has to exist first and can never be replaced afterwards without orphaning
# every launch made against the old one.
#
# ⛔ RHC's RPC sits behind Cloudflare and 403s a request with no User-Agent. `cast` takes
# `--rpc-headers`; forge does NOT, so a broadcast goes through the loopback proxy.
#   node scripts/rpc-proxy.mjs &   then   RPC=http://127.0.0.1:8545
#
# ⭐⭐ RUN `./rehearse.sh` FIRST. It launches, buys, sweeps and pays out against the REAL Pons V2 on
# a fork, and it is the only check here that can fail because the factory below is stale or because
# Pons closed launches. The 71 mock tests go green either way — a sibling project rehearsed a dead
# factory green twice.
# ⛔⛔ NO APOSTROPHES IN A `${VAR:?message}`. Bash reads a single quote inside a parameter expansion
# as opening a quoted string even in the middle of a double-quoted word, and the whole file then
# fails to PARSE — every line of it, before a single one runs. It shipped that way and only
# `bash -n deploy.sh` found it, because the script had never been run.
set -euo pipefail

RPC="${RHC_RPC_URL:-http://127.0.0.1:8545}"
: "${DEPLOYER_KEY:?set DEPLOYER_KEY}"
: "${OWNER:?set OWNER — the cold key that can rotate the signer and pause claims}"
: "${SIGNER:?set SIGNER — the attestation key the server holds, never the same as OWNER}"

# The live Pons V2 factory. ⛔ Not the retired one every older project here still points at.
# ⚠ Duplicated in test/PonsFork.t.sol ON PURPOSE — a rehearsal reading this same variable could not
# detect it being wrong. Change one, change both.
FACTORY="${PONS_FACTORY:-0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e}"
# The floor on how much of a launch has to reach social accounts. 20%.
# ⛔⛔ THE FLOOR IS ZERO, AND `minSocialBps` IS `immutable` — THIS CANNOT BE CHANGED AFTER DEPLOY.
#
# It was 2000 (20%), so a launch had to give at least a fifth to social accounts and wallet
# recipients did not count towards it. The operator removed that rule on 4 Sep 2026: a launcher sets
# whatever split they want, and a launch paying one wallet 100% is now a launch this contract will
# accept.
#
# ⚠ Deploy with any non-zero value and every launch below it reverts `SocialShareTooSmall` forever,
# with no setter to relax it — the only fix is redeploying the launchpad and orphaning the register.
MIN_SOCIAL_BPS="${MIN_SOCIAL_BPS:-0}"

if [ "$OWNER" = "$SIGNER" ]; then
  echo "⛔ OWNER and SIGNER must differ. The signer lives on a server and is the one that gets"
  echo "   stolen; the owner is what revokes it. One key is no separation at all." >&2
  exit 1
fi

# ⛔⛔ `--json` GOES BEFORE `--constructor-args`, NEVER AFTER IT.
#
# `--constructor-args` is variadic and greedy: it keeps taking words until the end of the command,
# so a trailing `--json` is read as a THIRD CONSTRUCTOR ARGUMENT. The whole deploy then dies on
# `Constructor argument count mismatch: expected 2 but got 3` — an error that names the constructor
# and says nothing about the flag, so it reads like the contract is wrong rather than the line.
# It shipped that way; `./deploy-rehearse.sh` is what found it.
#
# ⚠ And the parse below is deliberately not a bare `json.load`. `forge create` prints build progress
# on a cold cache, and one "Compiling 1 files" line ahead of the object turns a deploy into a
# traceback holding a private key's output. It takes the JSON and ignores everything before it.
deployed_to() {
  python3 -c 'import json,sys
t = sys.stdin.read()
i = t.find("{")
if i < 0:
    sys.exit("forge create printed no JSON:\n" + t)
a = json.loads(t[i:])["deployedTo"]
if not (isinstance(a, str) and a.startswith("0x") and len(a) == 42):
    sys.exit("forge create returned no address: " + repr(a))
print(a)'
}

echo "→ ShareClaims"
CLAIMS=$(forge create src/ShareClaims.sol:ShareClaims --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" \
  --broadcast --json --constructor-args "$OWNER" "$SIGNER" | deployed_to)
echo "   $CLAIMS"

echo "→ ShareLaunchpad"
PAD=$(forge create src/ShareLaunchpad.sol:ShareLaunchpad --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" \
  --broadcast --json --constructor-args "$FACTORY" "$CLAIMS" "$MIN_SOCIAL_BPS" | deployed_to)
echo "   $PAD"

cat <<TXT

Put these in web/.env.production and server/.env:

  VITE_LAUNCHPAD=$PAD
  VITE_CLAIMS=$CLAIMS
  CLAIMS_ADDRESS=$CLAIMS

⚠ ShareSplitter is NOT deployed here. One is created per launch, by the launchpad, inside the
  launch transaction. There is never a splitter without a token.
TXT
