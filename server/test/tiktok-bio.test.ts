/**
 * Proving a TikTok handle by a code in the bio.
 *
 * ⛔⛔ THE TEST THAT MATTERS MOST IS THE ONE ABOUT NOT FINDING THINGS. Three of the four outcomes
 * are failures, and collapsing them is the actual hazard: telling somebody "that code is not in your
 * bio" when the truth is "TikTok would not talk to us" sends them to re-paste a code that is already
 * there, and no amount of retrying will help. Every branch below asserts the DIFFERENCE.
 */
import { strict as assert } from 'node:assert'
import { test, mock } from 'node:test'

import { checkBioCode, cleanHandle, newBioCode } from '../src/providers/tiktokBio.ts'

/** A minimal stand-in for the embedded JSON TikTok ships inside the profile page. */
function profileHtml(opts: { unique: string; bio: string; nickname?: string }) {
  return `<html><body><script>{"uniqueId":"${opts.unique}","nickname":"${opts.nickname ?? opts.unique}","signature":"${opts.bio}"}</script></body></html>`
}

function mockFetch(impl: (url: string) => { status?: number; body?: string } | Error) {
  mock.method(globalThis, 'fetch', async (input: unknown) => {
    const out = impl(String(input))
    if (out instanceof Error) throw out
    const status = out.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => out.body ?? '',
    } as unknown as Response
  })
}

test('a code in the bio verifies, and the identity is keyed by the lower-cased handle', async () => {
  mockFetch(() => ({ body: profileHtml({ unique: 'JaneDoe', bio: 'hello share-abc123 world', nickname: 'Jane' }) }))
  const out = await checkBioCode('JaneDoe', 'share-abc123')
  assert.equal(out.result, 'verified')
  if (out.result !== 'verified') return
  /* ⛔ The SAME key `tiktok.ts` produces on sign-in. If these two ever disagree, the person who
     signed in and the person who verified by bio are two different beneficiaries, and only one of
     them can be paid. */
  assert.equal(out.identity.platform, 'tiktok')
  assert.equal(out.identity.id, 'janedoe')
  assert.equal(out.identity.handle, 'JaneDoe')
  mock.restoreAll()
})

test('the code match is case-insensitive — somebody will retype it in their own case', async () => {
  mockFetch(() => ({ body: profileHtml({ unique: 'jane', bio: 'SHARE-ABC123' }) }))
  assert.equal((await checkBioCode('jane', 'share-abc123')).result, 'verified')
  mock.restoreAll()
})

test('a bio without the code is MISSING, which is their action being incomplete', async () => {
  mockFetch(() => ({ body: profileHtml({ unique: 'jane', bio: 'link in bio' }) }))
  assert.equal((await checkBioCode('jane', 'share-abc123')).result, 'missing')
  mock.restoreAll()
})

test('a code after an escaped newline is still found', async () => {
  // ⚠ The bio arrives JSON-escaped inside the page. A plain substring search over the raw escape
  // misses a code that sits on its own line, which is exactly where somebody would put it.
  mockFetch(() => ({ body: profileHtml({ unique: 'jane', bio: 'my links\\nshare-abc123' }) }))
  assert.equal((await checkBioCode('jane', 'share-abc123')).result, 'verified')
  mock.restoreAll()
})

/* ── the failures that must not be confused with each other ──────────────────────────────────── */

test('a 200 with no profile data is UNREADABLE, never missing', async () => {
  // ⛔⛔ TikTok answers 200 with a captcha or an empty app shell when it will not serve us. Read as
  // "missing", this tells somebody their correct action failed.
  mockFetch(() => ({ body: '<html><body>please verify you are human</body></html>' }))
  const out = await checkBioCode('jane', 'share-abc123')
  assert.equal(out.result, 'unreadable')
  mock.restoreAll()
})

test('a 403 is UNREADABLE — our problem, not theirs', async () => {
  mockFetch(() => ({ status: 403, body: '' }))
  assert.equal((await checkBioCode('jane', 'share-abc123')).result, 'unreadable')
  mock.restoreAll()
})

test('a network failure is UNREADABLE and does not throw', async () => {
  mockFetch(() => new Error('ECONNRESET'))
  const out = await checkBioCode('jane', 'share-abc123')
  assert.equal(out.result, 'unreadable')
  mock.restoreAll()
})

test('a 404 is no-such-account', async () => {
  mockFetch(() => ({ status: 404, body: '' }))
  assert.equal((await checkBioCode('jane', 'share-abc123')).result, 'no-such-account')
  mock.restoreAll()
})

test('a page for a DIFFERENT profile is no-such-account, not a match', async () => {
  /* ⛔ TikTok redirects an unknown handle to a suggestion page. Matching the code on whatever came
     back would verify somebody against a profile that is not theirs. */
  mockFetch(() => ({ body: profileHtml({ unique: 'someoneelse', bio: 'share-abc123' }) }))
  assert.equal((await checkBioCode('jane', 'share-abc123')).result, 'no-such-account')
  mock.restoreAll()
})

/* ── handles and codes ───────────────────────────────────────────────────────────────────────── */

test('handles are accepted however they are pasted', () => {
  /* ⛔ `tiktok.com/@jane?lang=en` — no scheme — is what a phone share sheet and a browser address
     bar both produce, and it is the case the first implementation got wrong: it returned
     "tiktok.com", which passes the handle rule and would have sent us looking for a profile of that
     name and told the user their account does not exist. */
  for (const given of [
    'jane', '@jane', ' jane ',
    'https://www.tiktok.com/@jane',
    'tiktok.com/@jane?lang=en',
    'www.tiktok.com/@jane',
    'https://www.tiktok.com/@jane/video/7300000000000000000',
  ]) {
    assert.equal(cleanHandle(given), 'jane', given)
  }
})

test('a handle that cannot exist is refused before any network call', () => {
  // ⚠ Refused locally: a fetch to find out that a string could not possibly be a handle is a wasted
  // round trip and, on a blocked IP, a wasted retry budget.
  for (const bad of ['', 'a', '@', 'has spaces', 'way-too-long-a-handle-for-tiktok-to-allow', 'bad/slash', 'tiktok.com', 'https://www.tiktok.com/']) {
    assert.equal(cleanHandle(bad), null, bad)
  }
})

test('the code avoids characters that get mistyped by hand', () => {
  // ⭐ Somebody is copying this into a phone. A code that fails on an l/1 or O/0 look-alike reads as
  // a broken product rather than as a typo.
  for (let i = 0; i < 200; i++) {
    const c = newBioCode()
    assert.match(c, /^share-[a-hj-km-np-z2-9]{10}$/, c)
  }
})

test('codes do not repeat', () => {
  const seen = new Set(Array.from({ length: 500 }, () => newBioCode()))
  assert.equal(seen.size, 500)
})
