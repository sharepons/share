/**
 * The first-launch gate.
 *
 * ⛔⛔ THE TESTS THAT MATTER ARE THE ONES ABOUT NOT KNOWING. A gate that opens when the chain cannot
 * be read is not a gate, and one that stays shut on the wallet it exists to admit is a bug that
 * looks exactly like a broken wallet connection. Both are pinned below.
 *
 * ⚠ This gate is unrelated to the site's private-preview cookie gate. @see src/lib/launchGate.ts.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { FIRST_LAUNCHER, GATE_MESSAGE, isFirstLauncher, launchGate } from '../src/lib/launchGate.ts'

/** ⚠ Written out in full rather than derived from the constant — a test that computes its own
 *  expectation from the value under test agrees with any typo it contains. */
const OPERATOR = '0x3c5EDCb0c426828E8B237e81Bd5937964a822434'
const STRANGER = '0x1111111111111111111111111111111111111111'

test('the gated wallet is the one the operator named', () => {
  assert.equal(FIRST_LAUNCHER, OPERATOR)
})

test('before any launch, only that wallet may pass', () => {
  assert.equal(launchGate(0, OPERATOR), 'allowed')
  assert.equal(launchGate(0, STRANGER), 'blocked')
})

test('⛔ the address comparison is case-insensitive, in both directions', () => {
  /* A wallet hands back a checksummed address; viem hands back a lower-cased one from some paths.
     `===` between them refuses the operator's own wallet and reads as a connection fault. */
  assert.equal(launchGate(0, OPERATOR.toLowerCase()), 'allowed')
  assert.equal(launchGate(0, OPERATOR.toUpperCase().replace('0X', '0x')), 'allowed')
  assert.ok(isFirstLauncher(OPERATOR.toLowerCase()))
  assert.ok(isFirstLauncher(OPERATOR))
})

test('⭐ the gate opens by itself the moment the register is not empty', () => {
  /* Nothing is switched off and nobody is asked. This is the whole mechanism. */
  assert.equal(launchGate(1, STRANGER), 'open')
  assert.equal(launchGate(1, OPERATOR), 'open')
  assert.equal(launchGate(42, STRANGER), 'open')
  assert.equal(launchGate(1, null), 'open')
})

test('⛔⛔ an unreadable count FAILS CLOSED for a stranger', () => {
  /* An RPC that will not answer must not read as "no launches yet, carry on" — and must not read
     as "already launched, gate is off" either. Unknown means no. */
  assert.equal(launchGate(null, STRANGER), 'blocked')
  assert.equal(launchGate(null, null), 'blocked')
})

test('an unreadable count never locks out the first launcher', () => {
  /* They are allowed whether the count is 0 or unknown, so a slow or failing RPC cannot strand the
     one person who is supposed to get through. */
  assert.equal(launchGate(null, OPERATOR), 'allowed')
})

test('no wallet connected is blocked, not a third maybe-state', () => {
  assert.equal(launchGate(0, null), 'blocked')
  assert.equal(launchGate(0, undefined), 'blocked')
  assert.equal(launchGate(0, ''), 'blocked')
  assert.equal(isFirstLauncher(''), false)
  assert.equal(isFirstLauncher(null), false)
  assert.equal(isFirstLauncher(undefined), false)
})

test('the dialog says exactly what the operator asked it to say', () => {
  assert.equal(GATE_MESSAGE, 'Launching is not available yet')
})
