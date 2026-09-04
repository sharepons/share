/**
 * Meta's `signed_request`, as used by Instagram's deauthorize callback.
 *
 * ⛔⛔ THE SIGNATURE CHECK IS THE ENTIRE SECURITY OF THAT ENDPOINT. There is no cookie, no session
 * and no Origin header on a server-to-server POST from Meta — anybody on the internet can reach the
 * URL. So the tests that matter here are the REFUSALS, and each one is a distinct way the check
 * could be written to pass everything while looking correct.
 */
import { strict as assert } from 'node:assert'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'

import { verifySignedRequest } from '../src/providers/metaSignedRequest.ts'

const SECRET = 'an-instagram-app-secret'

/** Builds one the way Meta does: base64url payload, HMAC-SHA256 over the ENCODED payload. */
function sign(payload: object, secret = SECRET): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', secret).update(encoded).digest('base64url')
  return `${sig}.${encoded}`
}

const REAL = { algorithm: 'HMAC-SHA256', issued_at: 1_757_000_000, user_id: '17841400000000000' }

test('a genuine signed_request decodes', () => {
  const out = verifySignedRequest(sign(REAL), SECRET)
  assert.ok(out)
  assert.equal(out.user_id, '17841400000000000')
  assert.equal(out.algorithm, 'HMAC-SHA256')
})

test('a payload edited after signing is refused', () => {
  /* The attack this endpoint actually faces: take a real callback and change whose it is. */
  const [sig] = sign(REAL).split('.')
  const forged = Buffer.from(JSON.stringify({ ...REAL, user_id: '999' })).toString('base64url')
  assert.equal(verifySignedRequest(`${sig}.${forged}`, SECRET), null)
})

test('a request signed with the wrong secret is refused', () => {
  assert.equal(verifySignedRequest(sign(REAL, 'not-our-secret'), SECRET), null)
})

test('an unsigned or half-formed request is refused, not crashed on', () => {
  /* ⛔ The length-mismatch case is the one that matters: `timingSafeEqual` THROWS rather than
     returning false when the buffers differ in length, so a one-character signature is an easy
     way to turn the endpoint into a 500 if the length is not checked first. */
  for (const bad of ['', '.', 'x', 'a.b.c', 'AA.' + Buffer.from('{}').toString('base64url')]) {
    assert.equal(verifySignedRequest(bad, SECRET), null, `should refuse: ${JSON.stringify(bad)}`)
  }
})

test('an empty app secret refuses everything, rather than verifying against ""', () => {
  /* ⛔⛔ A deployment with INSTAGRAM_CLIENT_SECRET unset must not accept requests signed with the
     empty string — which is exactly what an unguarded HMAC would do, consistently and silently. */
  assert.equal(verifySignedRequest(sign(REAL, ''), ''), null)
})

test('the algorithm named in the payload must be the one we verified with', () => {
  assert.equal(verifySignedRequest(sign({ ...REAL, algorithm: 'none' }), SECRET), null)
})

test('base64url is decoded as base64url, not base64', () => {
  /* ⚠ A payload whose base64 contains `-` or `_` is decoded to different bytes by a plain base64
     decoder, so a signature check that agreed would still hand the caller garbage. Sign a payload
     until the encoding carries one, then assert it round-trips to the SAME object. */
  let payload = { ...REAL, user_id: '' }
  for (let n = 0; n < 500; n++) {
    payload = { ...REAL, user_id: `1784${n}${'~?'.repeat((n % 3) + 1)}` }
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
    if (/[-_]/.test(encoded)) break
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  assert.match(encoded, /[-_]/, 'the fixture must actually exercise the url alphabet')
  const out = verifySignedRequest(sign(payload), SECRET)
  assert.ok(out)
  assert.equal(out.user_id, payload.user_id)
})
