/**
 * ⛔⛔ THE VECTORS HERE ARE THE SAME ONES `contracts/test/Keys.t.sol` PINS ON CHAIN.
 *
 * If the two files disagree the server attests to one beneficiary while the money sits under
 * another: every claim reverts, and the token page shows a balance its owner cannot touch. That
 * reads as a contract fault and is not one, which is why both suites hard-code the strings rather
 * than deriving them from a shared helper that could be wrong in both places at once.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { keccak256, toBytes } from 'viem'

import { BadAccountRef, beneficiary, identityString, key, walletId } from '../src/identity.ts'

test('x and github are keyed by numeric id', () => {
  assert.equal(identityString('x', '1465280448'), 'x:1465280448')
  assert.equal(identityString('github', '583231'), 'github:583231')
})

test('instagram and tiktok are keyed by handle, lower cased', () => {
  assert.equal(identityString('instagram', 'JaNe'), 'instagram:@jane')
  assert.equal(identityString('tiktok', 'jane'), 'tiktok:@jane')
})

test('a wallet is lower case hex, always', () => {
  assert.equal(
    identityString('wallet', '0xABC1230000000000000000000000000000000DEF'),
    'wallet:0xabc1230000000000000000000000000000000def',
  )
})

test('an id platform refuses a handle, and a leading zero', () => {
  assert.throws(() => identityString('github', 'octocat'), BadAccountRef)
  assert.throws(() => identityString('x', '0123'), BadAccountRef)
})

test('a handle platform refuses a pasted url or an at sign', () => {
  assert.throws(() => identityString('instagram', '@jane'), BadAccountRef)
  assert.throws(() => identityString('tiktok', 'tiktok.com/@jane'), BadAccountRef)
})

test('a handle keeps dots and underscores', () => {
  assert.equal(identityString('instagram', 'ja_ne.01'), 'instagram:@ja_ne.01')
})

/** ⛔ The collision the platform prefix exists to prevent. Both platforms number from small ints. */
test('the same id on two platforms is two people', () => {
  assert.notEqual(beneficiary('x', '12345'), beneficiary('github', '12345'))
  assert.notEqual(key({ platform: 'x', id: '1' }), key({ platform: 'github', id: '1' }))
})

test('the beneficiary is keccak of the identity string and nothing else', () => {
  assert.equal(beneficiary('x', '1465280448'), keccak256(toBytes('x:1465280448')))
  assert.equal(beneficiary('instagram', 'Jane'), keccak256(toBytes('instagram:@jane')))
})

test('walletId refuses anything that is not an address', () => {
  assert.throws(() => walletId('0x1234'), BadAccountRef)
  assert.equal(walletId('  0xABC1230000000000000000000000000000000DEF '), '0xabc1230000000000000000000000000000000def')
})

test('an over long account reference is refused before it is hashed', () => {
  assert.throws(() => identityString('instagram', 'a'.repeat(41)), BadAccountRef)
  assert.throws(() => identityString('x', ''), BadAccountRef)
})
