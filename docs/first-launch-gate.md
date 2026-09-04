# The first-launch gate

Until this launchpad has been used once, only one wallet may create a token **from this site**. The
moment the register holds a launch, the gate is gone — for everybody, permanently.

> ⚠⚠ **This has nothing to do with the site's private-preview gate.** That one is a cookie compared
> by Caddy and covers the whole domain. This one is about who may create token #1. They are switched
> off independently and neither knows the other exists.

| | |
|---|---|
| the wallet | `0x3c5EDCb0c426828E8B237e81Bd5937964a822434` |
| what it may do | create the first token, and only the first |
| what lifts the gate | `ShareLaunchpad.count() > 0` — nothing else, and nobody has to do it |
| what a blocked visitor sees | a dialog: **"Launching is not available yet"** |
| where it lives | `web/src/lib/launchGate.ts`, enforced in `LaunchForm.submit()` |
| tests | `web/test/launch-gate.test.mjs`, 8 |

---

## How it behaves

The whole rule is one function, `launchGate(count, address)`:

| register | wallet | result |
|---|---|---|
| **not empty** | anyone | `open` — the gate is finished |
| empty | the first launcher | `allowed` |
| empty | anyone else | `blocked` → the dialog |
| **unreadable** | the first launcher | `allowed` |
| **unreadable** | anyone else | `blocked` |

⛔⛔ **An unreadable count fails closed.** An RPC that will not answer must not read as "no launches
yet, carry on" — and must not read as "already launched, gate is off" either. Unknown means no.
⭐ And it never strands the operator: the first launcher is allowed whether the count is `0` or
unknown, so their check runs first and needs no network call at all.

⛔ **The address comparison is case-insensitive.** A wallet returns a checksummed address and viem
returns a lower-cased one from some paths; `===` between them is a gate that refuses the very wallet
it exists to admit, and it looks exactly like a broken wallet connection.

⚠ **The count is read fresh at the click**, not taken from the page's loaded list — so the gate opens
the instant token #1 lands, even for somebody who had the form open the whole time.

⚠ **The launch button stays enabled while the gate is up.** The press is what triggers the dialog. A
greyed-out button with no explanation is indistinguishable from a broken site.

## Where the check lives

Inside `submit()`, before the factory read and before the wallet is touched — so a blocked visitor
never sees a signature prompt. ⛔ Not in the button's `onClick`: that would leave `submit` reachable
by any later caller. One door, one lock.

---

## ⛔⛔ WHAT THIS GATE IS NOT

**It is an interface gate, and it is not a security control.**

`ShareLaunchpad` at `0x6E96c9EC71e60893F7C3084bECfAb712a72779f7` is already deployed, has **no owner
and no admin functions**, and every field on it is `immutable`. There is no call that could add a
restriction to it. So anybody who reads the public repo can call `launch()` on the contract directly
and bypass this completely.

➤ **What that costs, precisely:** whoever does it takes **token #1** — the register is append-only
and Explore reads it straight off `count()`/`page()` — and by existing, their launch **opens the gate
for everyone**. So the failure is not "somebody sneaks a launch past us"; it is "the first launch is
not the one that was planned", and it is not recoverable.

⛔ Do not describe this to anyone as "only that wallet can launch". It is *"only that wallet can
launch from this site"*, which is a different and weaker sentence.

### The two ways to close that hole

**1. Launch soon.** The gate only protects the window before the first launch. Once `count() > 0` the
question is moot. This costs nothing and is the shortest path.

**2. Redeploy the launchpad with the rule on chain.** Affordable, because `ShareClaims` is **not**
pinned to the launchpad — the vault, the signer, the EIP-712 domain and every attestation stay
exactly as they are. Only the launchpad address changes.

```solidity
// constructor
firstLauncher = firstLauncher_;      // immutable, permanent

// at the top of _launch, which BOTH entrypoints funnel through
if (_count() == 0 && msg.sender != firstLauncher) revert FirstLaunchReserved();
```

What a redeploy costs:

- ~0.002 ETH, and a fresh deployer key.
- The new address in `server/.env`, `web/.env.production` and the README (which is public).
- A re-run of `contracts/deploy-rehearse.sh`, `contracts/rehearse.sh` and `server/npm run preflight`.
- Nothing is stranded: the current launchpad holds **0 launches**, so there is nothing on it to lose.

⛔ **Until that redeploy happens, the deployed contract does not enforce any of this** — and the
source in this repo must not be edited to suggest otherwise. If `ShareLaunchpad.sol` ever gains the
check above, the deployed address in `HANDOFF.md` changes in the same commit.
