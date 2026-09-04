/**
 * Meta's `signed_request` — how Instagram tells a server that somebody revoked the app.
 *
 * ⛔⛔ THIS IS NOT AN OAUTH CALLBACK AND HAS NO SESSION. Meta POSTs it server-to-server, from its
 * own machines, with no cookie and no `Origin` header. There is nothing to authenticate the request
 * except the signature below, which is why the verification here is the whole security of the
 * endpoint — not a formality on the way to trusting the body.
 *
 * ## The format
 *
 *   base64url(HMAC-SHA256(payload, app_secret))  "."  base64url(json_payload)
 *
 * ⚠ base64URL, not base64: `-` and `_` for `+` and `/`, and the `=` padding stripped. Decoding it
 * with a plain base64 decoder appears to work on roughly three quarters of inputs and produces
 * garbage on the rest, which is the worst possible failure shape — it looks intermittent.
 *
 * The payload decodes to:
 *
 *   { "algorithm": "HMAC-SHA256", "issued_at": <unix>, "user_id": "<app-scoped id>" }
 *
 * ## ⛔⛔ THE `user_id` IS USELESS TO US, AND THAT IS BY DESIGN
 *
 * `user_id` is APP-SCOPED. `providers/instagram.ts` deliberately throws Instagram's numeric id away
 * and keys a session on the lower-cased handle, because no third party can look an app-scoped id up
 * and so a share could never be *named* by one. The cost of that decision shows up right here: when
 * Meta says "user 1784… revoked you", we cannot tell whose session that is.
 *
 * ➤ WHICH DOES NOT MAKE THIS ENDPOINT A LIE. A deauthorization asks us to stop acting on that
 *   person's behalf, and we already cannot: the access token was used once during sign-in and
 *   thrown away (`instagram.ts` never stores it). Nothing here can call Instagram for anybody. The
 *   only residue is a sign-in session that expires in seven days on its own.
 *
 * ⛔ DO NOT "FIX" THIS BY STORING THE APP-SCOPED ID ON THE SESSION. It would mean retaining a second
 * identifier for every Instagram user, permanently in the code, so that a seven-day cookie could be
 * deleted a few days earlier. That is more data held, not less. Deletion is documented instead, at
 * `/data-deletion` — @see web/src/components/Legal.tsx.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export type SignedRequest = {
  algorithm: string
  issued_at?: number
  user_id?: string
}

/** ⚠ base64url → Buffer. Node accepts 'base64url' natively; the padding is restored for us. */
function decode(part: string): Buffer {
  return Buffer.from(part, 'base64url')
}

/**
 * Verifies and decodes a `signed_request`, or returns null.
 *
 * ⛔ NULL FOR EVERY FAILURE, DELIBERATELY UNIFORM. A caller that distinguished "bad signature" from
 * "malformed" from "wrong algorithm" would be answering questions for whoever is probing it.
 */
export function verifySignedRequest(raw: string, appSecret: string): SignedRequest | null {
  if (!raw || !appSecret) return null

  /* ⚠ Exactly two parts. `split('.')` on a three-part string would otherwise hand the signature
     check a truncated payload that still verifies against a truncated signature. */
  const parts = raw.split('.')
  if (parts.length !== 2) return null
  /* ⚠ Read by index rather than destructured: with `noUncheckedIndexedAccess` the pair is
     `string | undefined` no matter what the length check above proved. */
  const sig = parts[0] ?? ''
  const payload = parts[1] ?? ''

  let expected: Buffer
  let given: Buffer
  try {
    given = decode(sig)
    expected = createHmac('sha256', appSecret).update(payload).digest()
  } catch {
    return null
  }

  /* ⛔ timingSafeEqual THROWS on a length mismatch rather than returning false, and a forged
     signature of the wrong length is the easy case to send. Check the length first. */
  if (given.length !== expected.length) return null
  if (!timingSafeEqual(given, expected)) return null

  let body: SignedRequest
  try {
    body = JSON.parse(decode(payload).toString('utf8')) as SignedRequest
  } catch {
    return null
  }

  /* ⚠ Meta names the algorithm inside the signed payload. Accepting whatever it says without
     checking is how a `"algorithm":"none"` style downgrade gets in — the signature above was
     computed with SHA-256 regardless, so this is belt and braces, but it is one line. */
  if (body.algorithm !== 'HMAC-SHA256') return null

  return body
}
