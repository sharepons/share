/**
 * Who somebody is, in the exact words the chain uses.
 *
 * ## ⛔⛔ THIS FILE AND `contracts/src/ShareKeys.sol` ARE ONE THING IN TWO LANGUAGES
 *
 * The launchpad derives a recipient's key on chain. This derives the same key for the browser and
 * for the attestation the server signs. If they ever disagree, the server attests to one beneficiary
 * while the money sits under another, every claim reverts, and the token page shows a balance the
 * owner cannot touch — a bug that looks like a contract fault and is not.
 *
 * ➤ `contracts/test/Keys.t.sol` and `test/identity.test.ts` hard-code the SAME strings on both
 * sides. Change one, change all four.
 *
 * ## ⛔⛔ THE ID IS THE IDENTITY, NEVER THE HANDLE — WHERE THERE IS AN ID
 *
 * X and GitHub both let a name be changed, released, and taken by somebody else, and both expose a
 * stable numeric id that is never reissued. A launch tied to the text `@alice` follows whoever holds
 * that name later, so the day they rename, a stranger inherits the money.
 *
 * ⚠⚠ Instagram and TikTok are keyed by HANDLE, because neither will resolve a username to an id
 * until that person has personally authorised this app — which has not happened at the moment
 * somebody launches a token for them. That is a real and disclosed weakness, not a shortcut: an
 * Instagram share follows the NAME. @see the same note in ShareKeys.sol.
 */

import { keccak256, toBytes, type Hex } from 'viem'

/** ⚠ Order matches `ShareKeys.Platform` on chain. The integer is what the registry stores. */
export const PLATFORMS = ['wallet', 'x', 'github', 'instagram', 'tiktok'] as const
export type Platform = (typeof PLATFORMS)[number]

export const platformIndex = (p: Platform): number => PLATFORMS.indexOf(p)

/** The platforms whose key is an account id resolved before the launch. */
export const ID_KEYED: readonly Platform[] = ['x', 'github']
/** The platforms whose key is the handle itself, because no public lookup exists. */
export const HANDLE_KEYED: readonly Platform[] = ['instagram', 'tiktok']

export const isPlatform = (v: unknown): v is Platform =>
  typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v)

export type Identity = {
  platform: Platform
  /**
   * ⛔ For `x` and `github`, the stable numeric id. For `instagram` and `tiktok`, the lower-cased
   * handle, because that is what the key is made of there.
   */
  id: string
  /** Display only. Refreshed on every sign-in. */
  handle: string
  name: string
  avatar: string | null
}

export class BadAccountRef extends Error {}

/** ⚠ The only spelling of an address allowed anywhere near a key. @see ShareKeys.hexAddress. */
export function walletId(address: string): string {
  const clean = address.trim().toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(clean)) throw new BadAccountRef('that is not an address')
  return clean
}

/**
 * The canonical identity string — the one the contract builds with `string.concat`.
 *
 * ```
 *   x:1465280448     github:583231     instagram:@jane     tiktok:@jane     wallet:0xabc…
 * ```
 */
export function identityString(platform: Platform, accountRef: string): string {
  if (platform === 'wallet') return `wallet:${walletId(accountRef)}`

  const ref = accountRef.trim()
  if (!ref) throw new BadAccountRef('there is no account there')
  if (ref.length > 40) throw new BadAccountRef('that is longer than any account name')

  if (platform === 'x' || platform === 'github') {
    /* ⛔ Digits only, and no leading zero: "07" and "7" are one account to the platform and two
       beneficiaries here, so exactly one spelling is allowed to exist. Mirrors `_requireDigits`. */
    if (!/^(0|[1-9][0-9]*)$/.test(ref)) throw new BadAccountRef(`${platform} is keyed by account id, not by name`)
    return `${platform}:${ref}`
  }

  const lower = ref.toLowerCase()
  // ⚠ The intersection of what Instagram and TikTok allow. A pasted URL is rejected, not hashed.
  if (!/^[a-z0-9._]+$/.test(lower)) throw new BadAccountRef('a handle is letters, digits, dots and underscores')
  return `${platform}:@${lower}`
}

/**
 * ⭐⭐ The `bytes32` the vault keys one person's money by.
 *
 * ⚠ The contracts never interpret it. That is deliberate: adding another way of proving who you are
 * needs no contract change at all.
 */
export function beneficiary(platform: Platform, accountRef: string): Hex {
  return keccak256(toBytes(identityString(platform, accountRef)))
}

export const beneficiaryOf = (i: Pick<Identity, 'platform' | 'id'>): Hex => beneficiary(i.platform, i.id)

/**
 * The only correct way to compare two identities, or to key one in a store.
 *
 * ⚠ A `===` on ids somewhere would compile, pass every ordinary test, and hand one platform's users
 * another platform's money: both X and GitHub number from small integers.
 */
export const key = (i: Pick<Identity, 'platform' | 'id'>): string => `${i.platform}:${i.id}`

export type IdentityProvider = {
  readonly name: Platform
  /** Human name for buttons and prose. */
  readonly label: string
  /** Where to send the browser, plus what to keep for the callback. */
  begin(redirectUri: string): { url: string; state: string; verifier: string }
  complete(code: string, verifier: string, redirectUri: string): Promise<Identity>
  /**
   * Resolves a typed handle to whoever currently holds it, or null when there is no such account.
   *
   * ⛔ Null on a platform with no public lookup, ALWAYS — never a guess. @see the header.
   */
  lookup(handle: string): Promise<Identity | null>
  /** ⭐ False for Instagram and TikTok. The launch form reads this and says so on the row. */
  readonly canLookup: boolean
}
