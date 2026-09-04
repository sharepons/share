#!/usr/bin/env bash
#
# Checks the key files against the addresses the operator named, BEFORE `deploy.sh` spends anything.
#
# ⛔⛔ A KEY THAT DOES NOT MATCH ITS ADDRESS IS A SILENT, EXPENSIVE MISTAKE. The vault is deployed
# with `signer` as a CONSTRUCTOR ARGUMENT. Hand it an address whose key nobody has and the deploy
# succeeds, the site renders, wallet claims work, `/api/health` says claiming is available — and
# every SOCIAL claim fails forever, because nothing can produce a signature the vault accepts. The
# only repair is an owner transaction. This costs one second and rules that out.
#
# ⛔ NO KEY IS EVER PRINTED, LOGGED OR COPIED. Only the addresses derived from them.
#
#   OWNER=0x… DEPLOYER=0x… SIGNER=0x… ./check-deploy-keys.sh
set -euo pipefail
cd "$(dirname "$0")"

RPC="${RHC_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
DEPLOY_KEY_FILE="${DEPLOY_KEY_FILE:-.deploy.key}"
SIGNER_KEY_FILE="${SIGNER_KEY_FILE:-.signer.key}"

: "${OWNER:?set OWNER — the cold address that can rotate the signer and pause claims}"
: "${DEPLOYER:?set DEPLOYER — the address whose key is in $DEPLOY_KEY_FILE}"
: "${SIGNER:?set SIGNER — the address whose key is in $SIGNER_KEY_FILE}"

fail() { echo "   ⛔ $*" >&2; FAILED=1; }
ok()   { echo "   ✓ $*"; }
FAILED=0

lower() { echo "$1" | tr 'A-Z' 'a-z'; }

# Derives the address from a key file, and prints ONLY the address.
#
# ⛔⛔ THE KEY NEVER BECOMES A COMMAND-LINE ARGUMENT. `cast wallet address --private-key 0x…` puts it
# in the process list, where `ps` shows it to every other user on the machine for as long as the
# command runs. `cast` has no stdin option for this, so the derivation goes through node with the key
# piped in — it exists in this script as a shell variable and in node's stdin, and nowhere else.
# ⚠ viem lives in ../server, so node runs from there.
#
# ⭐ The file may carry `#` comment lines and blank lines, so it can hold its own instructions for
# whoever pastes the key in. The key is the first line that is exactly a 32-byte hex value.
read_key() {
  local f="$1"
  [ -f "$f" ] || { echo "MISSING"; return; }
  local k
  # ⭐ BOTH FORMS. Plenty of wallets export the raw 64 hex characters with no `0x`, and refusing
  # those sends somebody back to edit a file holding a private key — more handling of the secret, to
  # satisfy a prefix. It is normalised to `0x` here instead, because everything downstream (forge,
  # viem, the server's ATTESTATION_KEY check) wants it that way.
  k=$(grep -v '^[[:space:]]*#' "$f" | tr -d ' \t\r' | grep -m1 -E '^(0x)?[0-9a-fA-F]{64}$' || true)
  if [ -z "$k" ]; then echo "MALFORMED"; return; fi
  case "$k" in 0x*) ;; *) k="0x$k" ;; esac
  printf '%s' "$k" | (cd ../server && node -e '
    let s = ""
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const { privateKeyToAccount } = require("viem/accounts")
        process.stdout.write(privateKeyToAccount(s.trim()).address)
      } catch { process.stdout.write("UNREADABLE") }
    })') 2>/dev/null || echo "UNREADABLE"
}

echo "==> key files"
for f in "$DEPLOY_KEY_FILE" "$SIGNER_KEY_FILE"; do
  if [ ! -f "$f" ]; then
    fail "$f does not exist"
  else
    # ⚠ 600 or better. A key readable by every process on the box is not a secret.
    PERM=$(stat -f '%Lp' "$f" 2>/dev/null || stat -c '%a' "$f")
    [ "$PERM" = "600" ] || fail "$f is mode $PERM — should be 600. chmod 600 $f"
    [ "$PERM" = "600" ] && ok "$f is 600"
  fi
done
[ "$FAILED" = "0" ] || { echo; echo "⛔ fix the above first. Nothing was read."; exit 1; }

echo "==> the keys derive the addresses you named"
GOT_DEPLOYER=$(read_key "$DEPLOY_KEY_FILE")
GOT_SIGNER=$(read_key "$SIGNER_KEY_FILE")

for pair in "deployer:$GOT_DEPLOYER:$DEPLOYER" "signer:$GOT_SIGNER:$SIGNER"; do
  NAME="${pair%%:*}"; REST="${pair#*:}"; GOT="${REST%%:*}"; WANT="${REST#*:}"
  case "$GOT" in
    MISSING|MALFORMED|UNREADABLE) fail "$NAME key is $GOT" ;;
    *) if [ "$(lower "$GOT")" = "$(lower "$WANT")" ]; then ok "$NAME key signs as $WANT"
       else fail "$NAME key signs as $GOT, but you named $WANT — one of the two is wrong"; fi ;;
  esac
done

echo "==> the three roles are separate"
# ⛔ The rule deploy.sh refuses to break: the signer lives on a server and is the one that gets
# stolen; the owner is what revokes it. One key doing both jobs is no separation at all.
[ "$(lower "$OWNER")" != "$(lower "$SIGNER")" ] || fail "OWNER and SIGNER are the same address"
[ "$(lower "$OWNER")" != "$(lower "$SIGNER")" ] && ok "owner is not the signer"

# ⛔⛔ AND THE COLD KEY MUST NOT BE ON THIS MACHINE. `deploy.sh` only compares OWNER to SIGNER, so a
# deployer key that happens to BE the owner's slips straight past it — and the whole point of the
# owner is that it never touches a machine that is on the internet.
for pair in "deployer:$GOT_DEPLOYER" "signer:$GOT_SIGNER"; do
  NAME="${pair%%:*}"; GOT="${pair#*:}"
  if [ "$(lower "$GOT")" = "$(lower "$OWNER")" ]; then
    fail "the $NAME key IS the owner's key. The cold key must never be on this machine — use a different one"
  fi
done
[ "$FAILED" = "0" ] && ok "neither key on this machine is the owner's"

echo "==> gas"
BAL=$(cast balance "$DEPLOYER" --rpc-url "$RPC")
ETH=$(python3 -c "print(f'{$BAL/1e18:.6f}')")
# 6,537,931 gas measured on a fork of live RHC (ShareClaims 1,925,341 + ShareLaunchpad 4,612,590).
NEED=$(python3 -c "print(int(6537931 * $(cast gas-price --rpc-url "$RPC") * 3))")
NEEDETH=$(python3 -c "print(f'{$NEED/1e18:.6f}')")
if [ "$BAL" -ge "$NEED" ]; then ok "deployer holds $ETH ETH (needs about $NEEDETH at 3x current gas)"
else fail "deployer holds $ETH ETH — not enough. 6,537,931 gas at 3x the current price is $NEEDETH ETH"; fi

OWNERBAL=$(cast balance "$OWNER" --rpc-url "$RPC")
if [ "$OWNERBAL" = "0" ]; then
  # ⚠ A warning, not a failure: it does not block the deploy, it blocks the RECOVERY.
  echo "   ⚠ the owner holds 0 ETH. It is the only address that can call setSigner, and the moment"
  echo "     you need that is the moment the server key was stolen. Fund it before you rely on it."
else
  ok "owner holds $(python3 -c "print(f'{$OWNERBAL/1e18:.6f}')") ETH for owner calls"
fi

echo
if [ "$FAILED" = "0" ]; then echo "✅ ready to deploy."; else echo "⛔ NOT ready. Nothing was deployed."; exit 1; fi
