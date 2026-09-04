/**
 * The browser's copy of the identity scheme.
 *
 * ## ⛔⛔ THREE IMPLEMENTATIONS OF ONE THING
 *
 * `contracts/src/ShareKeys.sol` derives the key that gets paid. `server/src/identity.ts` derives the
 * key it attests to. This derives the key the interface shows a launcher BEFORE they sign, so they
 * can see the same hash the chain will compute. All three must agree exactly; if they drift, a
 * launch is recorded paying one account and the money sits under another, every claim reverts, and
 * the fault reads as a contract bug.
 *
 * ⚠ This one is checked in `test/beneficiary.test.mjs` against the identical vectors used by
 * `contracts/test/Keys.t.sol` and `server/test/identity.test.ts`.
 *
 * ⭐ Deriving it here rather than asking the server means the launch form works with the server
 * down: only resolving a handle to an id needs it.
 */
import { keccak256, toBytes, type Hex } from 'viem'
import type { Platform } from './platforms.ts'

export class BadAccountRef extends Error {}

export function walletId(address: string): string {
  const clean = address.trim().toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(clean)) throw new BadAccountRef('that is not an address')
  return clean
}

/** The canonical identity string — the one `string.concat` builds on chain. */
export function identityString(platform: Platform, accountRef: string): string {
  if (platform === 'wallet') return `wallet:${walletId(accountRef)}`

  const ref = accountRef.trim()
  if (!ref) throw new BadAccountRef('there is no account there')
  if (ref.length > 40) throw new BadAccountRef('that is longer than any account name')

  if (platform === 'x' || platform === 'github') {
    /* ⛔ Digits, and no leading zero. "07" and "7" are one account to the platform and would be two
       beneficiaries here. */
    if (!/^(0|[1-9][0-9]*)$/.test(ref)) throw new BadAccountRef(`${platform} is keyed by account id, not by name`)
    return `${platform}:${ref}`
  }

  const lower = ref.toLowerCase()
  if (!/^[a-z0-9._]+$/.test(lower)) throw new BadAccountRef('a handle is letters, digits, dots and underscores')
  return `${platform}:@${lower}`
}

export function beneficiary(platform: Platform, accountRef: string): Hex {
  return keccak256(toBytes(identityString(platform, accountRef)))
}

/** ⚠ Never throws. For rendering a row that may still be half-filled in. */
export function tryBeneficiary(platform: Platform, accountRef: string): Hex | null {
  try {
    return beneficiary(platform, accountRef)
  } catch {
    return null
  }
}
