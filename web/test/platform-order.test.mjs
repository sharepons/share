/**
 * The display order must never become the wire order.
 * ⛔ `PLATFORMS.indexOf()` is sent on chain as ShareKeys.Platform. Reordering it for presentation
 * files every recipient under the wrong platform, and the launch still succeeds.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/lib/platforms.ts', import.meta.url), 'utf8')
const arr = (name) => {
  const m = src.match(new RegExp(`${name}[^=]*=\\s*\\[([^\\]]*)\\]`))
  assert.ok(m, `${name} not found`)
  return [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1])
}

test('PLATFORMS matches the Solidity ShareKeys.Platform enum, in order', () => {
  // ⛔ Wallet=0, X=1, GitHub=2, Instagram=3, TikTok=4 — see contracts/src/ShareKeys.sol
  assert.deepEqual(arr('PLATFORMS'), ['wallet', 'x', 'github', 'instagram', 'tiktok'])
})

test('PLATFORM_ORDER is display-only and holds the same set', () => {
  const wire = arr('PLATFORMS')
  const shown = arr('PLATFORM_ORDER')
  assert.deepEqual([...shown].sort(), [...wire].sort(), 'a platform is missing from or extra in the menu')
  assert.notDeepEqual(shown, wire, 'if these match, PLATFORM_ORDER is not doing anything')
})
