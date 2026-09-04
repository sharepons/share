/**
 * The burn guards.
 *
 * ⛔⛔ EVERY TEST HERE IS ABOUT REFUSING. Burning is the one irreversible thing this site can do,
 * and the two ways it goes wrong are both silent: a decimals mistake burns a millionth of what was
 * meant (or, reversed, everything), and "sending to 0xdEaD" leaves totalSupply untouched forever
 * while looking exactly like a burn. A sibling project on this stack did the second one with 29.37M
 * tokens and its supply still reads 1,000,000,000.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canSeeBurn, checkBurnAmount, BURN_OPERATOR } from '../src/lib/burn.ts'

const D = 18
const BAL = 22801302931596091205211726n // the real holding, 22,801,302.9315… tokens

test('the panel is shown to the operator wallet and nobody else', () => {
  assert.equal(canSeeBurn(BURN_OPERATOR), true)
  assert.equal(canSeeBurn('0x1111111111111111111111111111111111111111'), false)
  assert.equal(canSeeBurn(null), false)
  assert.equal(canSeeBurn(undefined), false)
  assert.equal(canSeeBurn(''), false)
})

test('⛔ the address is compared case-insensitively', () => {
  /* A wallet returns checksummed, viem hands back lower-cased on some paths. `===` here is a gate
     that hides the control from the very wallet it exists for. @see lib/launchGate.ts. */
  assert.equal(canSeeBurn(BURN_OPERATOR.toLowerCase()), true)
  assert.equal(canSeeBurn(BURN_OPERATOR.toUpperCase().replace('0X', '0x')), true)
})

test('⛔⛔ the amount is in TOKENS, not wei — the whole point of checkBurnAmount', () => {
  /* Somebody holding 22,801,302 tokens types that number. It must mean 2.28e25 wei, not 22801302
     wei — which would burn 0.000000000000022801302 of a token and look like nothing happened. */
  const r = checkBurnAmount('22801302', BAL, D)
  assert.equal(r.ok, true)
  assert.equal(r.wei, 22801302000000000000000000n)
})

test('the full balance round-trips exactly, to the last wei', () => {
  /* "Burn all of it" fills the field from formatUnits. If that does not parse back to the exact
     balance, the last few wei survive and the holder is left with dust they cannot explain. */
  const r = checkBurnAmount('22801302.931596091205211726', BAL, D)
  assert.equal(r.ok, true)
  assert.equal(r.wei, BAL)
})

test('⛔ more than the balance is refused here, not left to revert on chain', () => {
  const r = checkBurnAmount('22801303', BAL, D)
  assert.equal(r.ok, false)
  assert.match(r.error, /less than that/)
})

test('⛔ zero and negative are refused', () => {
  assert.equal(checkBurnAmount('0', BAL, D).ok, false)
  assert.equal(checkBurnAmount('0.0', BAL, D).ok, false)
  assert.equal(checkBurnAmount('-5', BAL, D).ok, false)
})

test('⛔ an empty or junk amount is refused with a message about tokens', () => {
  assert.match(checkBurnAmount('', BAL, D).error, /Enter how many/)
  assert.match(checkBurnAmount('abc', BAL, D).error, /Numbers only/)
  assert.match(checkBurnAmount('1e18', BAL, D).error, /Numbers only/)
  /* ⚠ Hex is the shape someone pastes when they think the field wants wei. */
  assert.match(checkBurnAmount('0x1', BAL, D).error, /Numbers only/)
})

test('⛔ more precision than the token has is refused, not silently truncated', () => {
  const r = checkBurnAmount(`1.${'0'.repeat(18)}1`, BAL, D)
  assert.equal(r.ok, false)
  assert.match(r.error, /more precise/)
})

test('thousands separators are tolerated — people paste them from the balance line', () => {
  const r = checkBurnAmount('1,000', BAL, D)
  assert.equal(r.ok, true)
  assert.equal(r.wei, 1000000000000000000000n)
})

test('a token with different decimals is handled by the parameter, never a hard-coded 18', () => {
  const sixDp = 5000000n // 5.0 of a 6-decimal token
  const r = checkBurnAmount('5', sixDp, 6)
  assert.equal(r.ok, true)
  assert.equal(r.wei, 5000000n)
})

test('burning the exact balance is allowed — the boundary is inclusive', () => {
  assert.equal(checkBurnAmount('5', 5000000n, 6).ok, true)
})
