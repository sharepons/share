/**
 * The token image as a permanent launch requirement.
 *
 * ⛔⛔ EVERY TEST HERE GUARDS SOMETHING THAT CANNOT BE UNDONE. Pons V2 writes name, symbol and logo
 * into the token's constructor and ships no setter for any of them, so a launch that gets this
 * wrong is wrong for the life of the token. Two of those three were required by the form and this
 * one was not — the only permanent field whose wrongness is invisible was also the only optional
 * one. Pons accepts an empty logo silently; see the fork test
 * `test_anEmptyLogoIsAcceptedByPons_whichIsWhyTheInterfaceMustNotAllowIt`, which runs against the
 * live deployed launchpad and PASSES.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenImageProblem, checkLogo, LOGO_MAX_BYTES } from '../src/lib/logo.ts'

const GOOD = 'https://sharepons.family/logos/446a55f04b820db560bab0f87ffac021.png'

test('⛔ an EMPTY image blocks the launch — it cannot be added later', () => {
  const p = tokenImageProblem('', null)
  assert.ok(p, 'an empty image must block')
  assert.match(p, /cannot be added after the launch/)
})

test('⛔ whitespace is empty', () => {
  assert.ok(tokenImageProblem('   ', null))
})

test('a good https link with the image not yet loaded does NOT block', () => {
  /* ⚠ `null` is "the browser has not finished trying". Blocking on it would show an error for the
     moment between pasting a correct link and it appearing — an error for doing the right thing. */
  assert.equal(tokenImageProblem(GOOD, null), null)
})

test('a good https link that LOADED does not block', () => {
  assert.equal(tokenImageProblem(GOOD, true), null)
})

test('⛔⛔ a well-formed link that does NOT load blocks — shape is not reachability', () => {
  /* This server has shipped exactly this bug: logos were stored and never served, so every upload
     returned a URL that 404'd. `checkLogo` says yes to it, because the string is fine. */
  assert.equal(checkLogo(GOOD).ok, true, 'the string itself is valid — that is the trap')
  const p = tokenImageProblem(GOOD, false)
  assert.ok(p, 'an unreachable image must block')
  assert.match(p, /does not load/)
})

test('ipfs:// is accepted and is not required to be reachable through a gateway', () => {
  /* ⚠ The ipfs URI goes on chain as typed; gateways are only used to draw a preview. A gateway
     being down must not block a launch. */
  assert.equal(tokenImageProblem('ipfs://bafyfakecidfortests', null), null)
})

test('⛔ a bare CID, a relative path and javascript: are all refused', () => {
  for (const bad of ['bafyfakecid', '/logos/a.png', 'javascript:alert(1)', 'data:text/html,x']) {
    assert.ok(tokenImageProblem(bad, null), `${bad} must not be launchable`)
  }
})

test('⛔ an oversized URI is refused — Pons reverts above the metadata limit without naming a field', () => {
  const long = `https://sharepons.family/logos/${'a'.repeat(LOGO_MAX_BYTES)}.png`
  const p = tokenImageProblem(long, true)
  assert.ok(p, 'an over-limit logo must block')
  assert.match(p, /not usable/)
})

test('⚠ reachability is only consulted AFTER the shape passes', () => {
  /* An empty field with reachable=false must report the empty problem, not the load problem —
     otherwise somebody who has typed nothing is told their link is broken. */
  assert.match(tokenImageProblem('', false), /cannot be added after the launch/)
})
