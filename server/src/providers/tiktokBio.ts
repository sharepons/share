/**
 * Proving control of a TikTok handle by putting a one-time code in the profile bio.
 *
 * ## ⛔⛔ WHY THIS EXISTS INSTEAD OF SIGN-IN
 *
 * TikTok's Login Kit needs an approved app: a new one is sandboxed, and `user.info.profile` — the
 * scope that carries `username`, which is the only field a TikTok share can be keyed on — is gated
 * behind review. Until that clears, a `tiktok:@jane` share accrues fees on chain that @jane cannot
 * reach.
 *
 * ⭐⭐ AND THE CONTRACT DOES NOT CARE HOW IDENTITY WAS PROVEN. `/api/attestation` signs
 * `beneficiaryOf(session.identity)`; nothing on chain, and nothing in `ShareClaims`, learns whether
 * that session came from OAuth or from here. So this is a server-only path to the same place, with
 * no contract change and no new trust in the signer key than already exists.
 *
 * ## What it proves, and what it does not
 *
 * A code that only the account holder could have placed in the bio proves **control of the account
 * at that moment** — the same guarantee an OAuth sign-in gives, and the same guarantee the key
 * `tiktok:@jane` is worth. ⚠ It does NOT make a handle-keyed share safe from a rename: whoever
 * controls the name controls the share, which is true under OAuth too and is disclosed in six
 * places on the site.
 *
 * ⛔⛔ THE CODE IS BOUND TO A WALLET. Without that, anybody watching a public bio could see the code
 * and race the claim. The attestation names `recipient`, so a code minted for one wallet cannot mint
 * a claim to another — the observer learns a string that is useless to them.
 *
 * ## ⚠⚠ "COULD NOT READ" IS NOT "NOT FOUND"
 *
 * TikTok serves this page to a datacenter IP today; it may not tomorrow, and the failure would be a
 * 200 with a challenge body, or a 403, or a redirect. Reporting any of those as "the code is not in
 * your bio" tells somebody their correct action failed — and sends them to re-paste a code that is
 * already there. Every outcome here is a distinct value and the caller must render the difference.
 * @see [[rhc-anvil-and-blockscout-traps]] — the same lesson, three times, on this stack.
 */
import { randomBytes } from 'node:crypto'
import type { Identity } from '../identity.ts'

/** ⚠ A browser agent. TikTok serves an app-shell with no profile data to an obvious bot. */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36'

/** TikTok's own rule: letters, digits, underscore and period, 2–24. ⚠ Checked before any fetch. */
const HANDLE = /^[A-Za-z0-9_.]{2,24}$/

/**
 * ⭐ Deliberately unmistakable and hard to typo. No `0`/`O` or `1`/`l`, because somebody is copying
 * this by hand into a phone, and a code that fails on a look-alike character reads as a broken
 * product rather than a mistyped letter.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export function newBioCode(): string {
  const bytes = randomBytes(10)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return `share-${out}`
}

/**
 * Normalise whatever somebody pastes into a bare handle, or `null`.
 *
 * ⛔⛔ A URL IS PARSED AS A URL; ANYTHING ELSE MUST BE A WHOLE HANDLE. The first version stripped a
 * `https://tiktok.com/` prefix and then split on `/`, which looks equivalent and is not: a
 * SCHEMELESS paste — `tiktok.com/@jane?lang=en`, which is exactly what a phone's share sheet and a
 * browser's address bar both produce — did not match the prefix, so the split returned
 * **`tiktok.com`**. That passes the handle rule (letters and a period are both legal), so the code
 * would have gone looking for a profile called "tiktok.com" and told the user their account does not
 * exist. ⚠ Splitting also quietly truncated `bad/slash` to `bad`, accepting nonsense as a handle.
 */
export function cleanHandle(handle: string): string | null {
  const raw = handle.trim()
  if (!raw) return null

  // ⚠ Scheme optional, `www.` optional, `@` optional, and anything after the handle ignored — that
  // covers a copied profile link, a share-sheet link and a link to one of their videos.
  const url = /^(?:https?:\/\/)?(?:www\.|vm\.)?tiktok\.com\/@?([^/?#]+)/i.exec(raw)

  /* ⛔ ANYTHING THAT MENTIONS THE HOST MUST PARSE AS A URL, OR IT IS REFUSED. `tiktok.com` on its own
     names no account, and it satisfies the handle rule — letters and a period are both legal in a
     real handle like `khaby.lame` — so without this it would fall through as a "handle" and we would
     tell somebody that TikTok has no account called tiktok.com. Same for a bare
     `https://www.tiktok.com/`. */
  const mentionsHost = /^(?:https?:\/\/)|^(?:www\.|vm\.)?tiktok\.com/i.test(raw)
  if (mentionsHost && !url?.[1]) return null

  const candidate = url ? url[1]! : raw.replace(/^@/, '')

  // ⛔ Whole-string match. No truncating a typo into something that happens to be valid.
  return HANDLE.test(candidate) ? candidate : null
}

/**
 * ⛔ Three outcomes, never two.
 *  - `verified` the code is in the bio
 *  - `missing`  the profile was read and the code is not there  (their action is not done yet)
 *  - `no-such-account` TikTok says the handle does not exist
 *  - `unreadable` we could not read the page at all             (OUR problem, not theirs)
 */
export type BioCheck =
  | { result: 'verified'; identity: Identity }
  | { result: 'missing' }
  | { result: 'no-such-account' }
  | { result: 'unreadable'; detail: string }

/**
 * Read a public TikTok profile and look for `code` in its bio.
 *
 * ⚠ `fetch` with a redirect check rather than following blindly: a redirect to a login or captcha
 * page returns 200 with a body that contains no bio, which would otherwise read as `missing`.
 */
export async function checkBioCode(handle: string, code: string): Promise<BioCheck> {
  const clean = cleanHandle(handle)
  if (!clean) return { result: 'no-such-account' }

  let res: Response
  try {
    res = await fetch(`https://www.tiktok.com/@${encodeURIComponent(clean)}`, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    })
  } catch (e) {
    return { result: 'unreadable', detail: e instanceof Error ? e.message : 'network error' }
  }

  if (res.status === 404) return { result: 'no-such-account' }
  if (!res.ok) return { result: 'unreadable', detail: `TikTok answered ${res.status}` }

  const html = await res.text()

  /* ⛔ The page must actually be the profile. TikTok answers 200 with a captcha or an empty app
     shell when it does not want to serve us, and both contain no `uniqueId` — treating that as
     "code not in bio" is the confident-zero failure this file exists to avoid. */
  const unique = /"uniqueId":"([^"]+)"/.exec(html)?.[1]
  if (!unique) {
    return { result: 'unreadable', detail: 'TikTok served a page with no profile data on it' }
  }
  if (unique.toLowerCase() !== clean.toLowerCase()) {
    // ⚠ A redirect to a different profile, or a suggestion page. Not this account.
    return { result: 'no-such-account' }
  }

  const bio = /"signature":"((?:[^"\\]|\\.)*)"/.exec(html)?.[1] ?? ''
  /* ⚠ The bio arrives JSON-escaped inside the page's embedded state — `\n`, `é` and friends.
     Decoded before matching, or a code sitting after a newline is invisible to a plain search. */
  let decoded = bio
  try {
    decoded = JSON.parse(`"${bio}"`) as string
  } catch {
    /* ⚠ Kept raw rather than failing: an unparseable escape must not block somebody whose code is
       plainly there. The match below is case-insensitive on ASCII either way. */
  }

  if (!decoded.toLowerCase().includes(code.toLowerCase())) return { result: 'missing' }

  const name = /"nickname":"((?:[^"\\]|\\.)*)"/.exec(html)?.[1] ?? unique

  return {
    result: 'verified',
    identity: {
      platform: 'tiktok',
      /* ⛔⛔ THE LOWER-CASED HANDLE IS THE ID, exactly as in `tiktok.ts`. TikTok's `open_id` is
         scoped to the asking app, so it is not something a launch could ever have named. If these
         two files ever disagree, a person who signed in would be a different beneficiary from the
         same person who verified by bio — and only one of them could claim. */
      id: unique.toLowerCase(),
      handle: unique,
      name,
      avatar: null,
    },
  }
}
