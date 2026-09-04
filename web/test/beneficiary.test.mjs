/**
 * ⛔⛔ THE SAME VECTORS AS `contracts/test/Keys.t.sol` AND `server/test/identity.test.ts`.
 *
 * Three implementations derive this key: Solidity for the launch, TypeScript on the server for the
 * attestation, and TypeScript here for what a launcher is shown BEFORE they sign. If they drift, a
 * launch is recorded paying one account while the money sits under another, every claim reverts, and
 * the fault reads as a contract bug. All three suites hard-code the strings rather than sharing a
 * helper that could be wrong in all three places at once.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { keccak256, toBytes } from 'viem'

import { BadAccountRef, beneficiary, identityString, tryBeneficiary, walletId } from '../src/lib/beneficiary.ts'

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

test('the same id on two platforms is two people', () => {
  assert.notEqual(beneficiary('x', '12345'), beneficiary('github', '12345'))
})

test('the beneficiary is keccak of the identity string and nothing else', () => {
  assert.equal(beneficiary('x', '1465280448'), keccak256(toBytes('x:1465280448')))
  assert.equal(beneficiary('instagram', 'Jane'), keccak256(toBytes('instagram:@jane')))
})

/** ⚠ Used while a launch form row is still half-filled in, so it must never throw. */
test('tryBeneficiary is null rather than an exception', () => {
  assert.equal(tryBeneficiary('x', 'not-an-id'), null)
  assert.equal(tryBeneficiary('wallet', '0x1234'), null)
  assert.notEqual(tryBeneficiary('x', '7'), null)
})

test('walletId refuses anything that is not an address', () => {
  assert.throws(() => walletId('0x1234'), BadAccountRef)
})
