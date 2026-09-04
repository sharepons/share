/**
 * The FIRST-LAUNCH GATE.
 *
 * Until this launchpad has been used once, only one wallet may launch from the site. The moment the
 * register holds a launch, the gate is gone — for everybody, permanently, with nothing to switch
 * off and nobody to ask.
 *
 * ⚠⚠ THIS IS UNRELATED TO THE SITE'S PRIVATE-PREVIEW GATE. That one is a cookie compared by Caddy
 * and it covers the whole domain. This one is about who may create token #1. They are switched off
 * independently and neither knows the other exists.
 *
 * ## ⛔⛔ THIS IS A FRONT-END GATE AND IT IS NOT A SECURITY CONTROL — SAY SO OUT LOUD
 *
 * `ShareLaunchpad` is already deployed, has **no owner and no admin functions**, and every field on
 * it is `immutable`. There is no call that could add a restriction to it. So this gate lives in the
 * interface, and anybody who reads the public repo can call `launch()` on the contract directly and
 * bypass it completely.
 *
 * ➤ What that costs, precisely: whoever does it takes **token #1** — the register is append-only —
 *   and by existing, their launch OPENS THE GATE for everyone. So the failure mode is not "somebody
 *   sneaks a launch past us", it is "the first launch is not the one that was planned", and it is
 *   not recoverable.
 *
 * ➤ The only way to make this unbypassable is to REDEPLOY the launchpad with the address below as
 *   an `immutable` and the check in `_launch`. That is affordable — `ShareClaims` is not pinned to
 *   the launchpad, so the vault, the signer and every attestation stay exactly as they are; it costs
 *   a redeploy, a new address in `server/.env`, `web/.env.production` and the README, and a re-run
 *   of the deploy rehearsals. @see docs/first-launch-gate.md.
 *
 * ⛔ Do not describe this to anyone as "only that wallet can launch". It is "only that wallet can
 * launch *from this site*", which is a different and weaker sentence.
 */

/**
 * The one wallet allowed to create token #1.
 *
 * ⛔⛔ COMPARED CASE-INSENSITIVELY, ALWAYS. A wallet returns a checksummed address, this constant is
 * written checksummed, and `viem` will hand you a lower-cased one from some paths — comparing them
 * with `===` is a gate that silently refuses the very wallet it exists to admit, and looks exactly
 * like a wallet-connection bug. @see `isFirstLauncher`.
 */
export const FIRST_LAUNCHER = '0x3c5EDCb0c426828E8B237e81Bd5937964a822434'

/**
 * `open`    — the register is not empty. The gate is finished; everyone launches.
 * `allowed` — the gate is up and this wallet is the one that may pass it.
 * `blocked` — the gate is up and this wallet may not. The interface shows the dialog.
 */
export type LaunchGate = 'open' | 'allowed' | 'blocked'

/** ⚠ Case-folded on both sides. See the warning on `FIRST_LAUNCHER`. */
export function isFirstLauncher(address: string | null | undefined): boolean {
  if (!address) return false
  return address.toLowerCase() === FIRST_LAUNCHER.toLowerCase()
}

/**
 * The whole rule, in one place.
 *
 * @param launchCount how many launches the register holds, or `null` if it could not be read.
 * @param address     the connected wallet, or null/undefined if there is none.
 *
 * ⛔⛔ `null` MEANS UNKNOWN AND IT FAILS CLOSED. An unreachable RPC must not read as "no launches
 * yet, carry on" and equally must not read as "already launched, gate is off" — an unknown count
 * leaves a stranger BLOCKED. The first launcher is unaffected either way, because they are allowed
 * whether the count is 0 or not, which is why their check comes first and needs no count at all.
 *
 * ⚠ A count of 0 with no wallet connected is `blocked`, not some third "unknown wallet" state. The
 * form does not render a launch button without a wallet, so nobody ever sees it — but a caller that
 * asks anyway should be told no rather than maybe.
 */
export function launchGate(launchCount: number | null, address: string | null | undefined): LaunchGate {
  if (launchCount !== null && launchCount > 0) return 'open'
  if (isFirstLauncher(address)) return 'allowed'
  return 'blocked'
}

/** What the dialog says. ⚠ The operator's words — do not reword it without asking. */
export const GATE_MESSAGE = 'Launching is not available yet'
