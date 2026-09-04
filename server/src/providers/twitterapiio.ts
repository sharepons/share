/**
 * Resolving an X @handle through twitterapi.io instead of X's own API.
 *
 * ⚠⚠ PORTED FROM `~/ponsi/server/src/providers/twitterapiio.ts` ON 4 Sep 2026, and deliberately a
 * COPY rather than a shared module: these are two separate deployments with separate release
 * cycles, and a shared file would couple them. ⛔ If twitterapi.io changes its response shape, BOTH
 * copies need the change — the other one is the reference implementation and was proven against a
 * real unclaimed share.
 * ⚠ The only edit is `platform` where the original says `provider`: SHARE's `Identity` names that
 * field differently.
 *
 * ## ⚠ WHY A SECOND SERVICE EXISTS FOR ONE LOOKUP
 *
 * Sign-in and handle resolution are different problems with different bills. Sign-in is OAuth
 * against X directly and is free; `GET /2/users/by/username` is PREPAID PER LOOKUP, billed per
 * developer PROJECT, and a new project starts at zero. Moving to a new X developer account on
 * 30 Aug therefore left the launch form unable to resolve a single handle — `402 Payment Required`
 * — while sign-in worked perfectly.
 * ⭐ twitterapi.io is already a dependency of `launcher/` and already funded, so this reuses a
 * balance that exists rather than asking for a second one.
 *
 * ## ⛔⛔ THE ID IS THE WHOLE POINT, AND GETTING IT WRONG IS UNRECOVERABLE
 *
 * The id this returns does not merely label a payee — it BECOMES one, permanently:
 *
 *     beneficiary = keccak256("x:" + id)          @see identity.ts
 *
 * That hash is written into the launch contract's splits, on chain, with no setter. A launch whose
 * payee was resolved to the wrong id sends that share to a beneficiary whose preimage nobody can
 * produce, so the money is not misdirected — it is BURNED, quietly, and only discovered when the
 * person it was for tries to claim and is told they are owed nothing.
 *
 * ➤ So this file's contract is narrow and absolute: **the id must be X's own global user id, the
 * identical value `GET /2/users/me` returns when that same person signs in to claim.** Verified on
 * 30 Aug against @MEADGod, who has a real unclaimed share: both services answer
 * `1792724913528172544`. ⚠ That is a fact about twitterapi.io's behaviour TODAY, not a promise, and
 * it is a third party — hence `assertGlobalXId` below, which refuses anything that is not
 * snowflake-shaped rather than letting a surprise reach the chain.
 *
 * ⚠ A snowflake is a decimal integer, currently 19 digits and monotonically increasing with time.
 * The check is deliberately loose on LENGTH (X ids from 2006 are 8 digits, and length will grow
 * again) and strict on SHAPE: digits only, no sign, no exponent, no `id_str` weirdness. What it
 * actually excludes is the realistic failure — a service returning its OWN surrogate key, a
 * username echoed back, or a UUID.
 */
import type { Identity } from '../identity.ts'

const BASE = 'https://api.twitterapi.io'

/**
 * ⛔ THE GUARD THAT STANDS BETWEEN A THIRD PARTY AND AN IRREVERSIBLE ON-CHAIN WRITE.
 * Throwing here surfaces as "could not resolve that handle", which is the correct outcome: a launch
 * that cannot name its payee safely must not be launched with a guess.
 */
function assertGlobalXId(id: unknown, handle: string): string {
  const s = String(id ?? '')
  if (!/^[0-9]{1,25}$/.test(s)) {
    throw new Error(
      `twitterapi.io returned an id for @${handle} that is not an X user id (${JSON.stringify(id)}). ` +
        'Refusing to use it: this value becomes keccak256("x:<id>") in a launch contract and cannot ' +
        'be corrected afterwards.',
    )
  }
  return s
}

/**
 * ⚠ Returns `null` for "no such account", THROWS for "the service failed".
 * Collapsing those would tell somebody their colleague's handle does not exist because our API key
 * expired. @see the same distinction in `x.ts`.
 */
export async function lookupViaTwitterApiIo(
  apiKey: string,
  handle: string,
): Promise<Identity | null> {
  /*
    ⛔ SHAPE CHECKED BEFORE THE CALL, because every lookup is PREPAID. X's own rule is
    `^[A-Za-z0-9_]{1,15}$`. Sending anything else spends a credit to be told the string could not
    possibly be a handle. @see the identical guard in x.ts, which this deliberately mirrors.
  */
  const clean = handle.replace(/^@/, '')
  if (!/^[A-Za-z0-9_]{1,15}$/.test(clean)) return null

  const url = new URL('/twitter/user/info', BASE)
  url.searchParams.set('userName', clean)

  const res = await fetch(url, { headers: { 'X-API-Key': apiKey } })
  if (res.status === 404) return null
  if (res.status === 402) throw new Error('X_CREDITS_DEPLETED')
  if (!res.ok) throw new Error(`twitterapi.io refused the handle lookup: ${res.status}`)

  const body = (await res.json()) as {
    status?: string
    msg?: string
    data?: { id?: unknown; userName?: string; name?: string; profilePicture?: string }
  }

  /*
    ⚠⚠ IT ANSWERS 200 FOR A MISSING ACCOUNT. twitterapi.io reports application-level failures in the
    BODY (`status: "error"`) with an HTTP 200, so a status-code-only check reads "found" and then
    hands back an Identity full of undefined — which `assertGlobalXId` would catch, but with a
    message about a malformed id rather than about an account that does not exist.
  */
  if (body.status === 'error') {
    const msg = String(body.msg ?? '')
    if (/not\s*found|no\s*such|does\s*not\s*exist/i.test(msg)) return null
    throw new Error(`twitterapi.io: ${msg || 'unknown error'}`)
  }

  const d = body.data
  if (!d || d.id === undefined || d.id === null) return null

  return {
    /* ⚠ `platform`, not `provider` — SHARE's Identity names this field differently from the
       launchpad this file was ported from. Same value, and the compiler is the only thing that
       would have caught it, because both are string literal types on an otherwise identical shape. */
    platform: 'x',
    id: assertGlobalXId(d.id, clean),
    handle: String(d.userName ?? clean),
    name: String(d.name ?? d.userName ?? clean),
    /* ⚠ `profilePicture` here, `profile_image_url` on X's own API. Same picture, different key. */
    avatar: d.profilePicture ? String(d.profilePicture) : null,
  }
}
