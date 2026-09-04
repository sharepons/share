/**
 * The attestation, checked the way the contract checks it.
 *
 * ⛔⛔ THE DOMAIN STRINGS ARE PINNED HERE AGAINST `ShareClaims.NAME` AND `.VERSION`. Renaming the
 * contract changes the domain separator baked into it at deployment while this file keeps signing
 * against the old one, and every signature is rejected as bad with nothing looking wrong.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { hashTypedData, recoverTypedDataAddress, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { ATTESTATION_TYPES, Attester, DOMAIN_NAME, DOMAIN_VERSION } from '../src/attest.ts'

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const
const CLAIMS = '0x1111111111111111111111111111111111111111' as Address
const RECIPIENT = '0x2222222222222222222222222222222222222222' as Address
const BEN = '0x3333333333333333333333333333333333333333333333333333333333333333' as const

test('the domain strings match the contract constants', () => {
  assert.equal(DOMAIN_NAME, 'ShareClaims')
  assert.equal(DOMAIN_VERSION, '1')
})

test('the signature recovers to the configured signer', async () => {
  const attester = new Attester(KEY, 4663, CLAIMS, 900)
  assert.equal(attester.address, privateKeyToAccount(KEY).address)

  const { attestation, signature } = await attester.sign(BEN, RECIPIENT)
  const domain = { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId: 4663, verifyingContract: CLAIMS }
  const recovered = await recoverTypedDataAddress({
    domain,
    types: ATTESTATION_TYPES,
    primaryType: 'Attestation',
    message: attestation,
    signature,
  })
  assert.equal(recovered, attester.address)
})

/** ⚠ A different chain id is a different domain separator, so the same key produces a signature the
 *  deployed contract will not accept. Worth a test because it is invisible otherwise. */
test('the chain id is part of what is signed', async () => {
  const a = new Attester(KEY, 4663, CLAIMS, 900)
  const b = new Attester(KEY, 1, CLAIMS, 900)
  const { attestation } = await a.sign(BEN, RECIPIENT)
  const base = { types: ATTESTATION_TYPES, primaryType: 'Attestation', message: attestation } as const
  assert.notEqual(
    hashTypedData({ ...base, domain: { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId: a.chainId, verifyingContract: CLAIMS } }),
    hashTypedData({ ...base, domain: { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId: b.chainId, verifyingContract: CLAIMS } }),
  )
})

test('the deadline is in the future and the salt never repeats', async () => {
  const attester = new Attester(KEY, 4663, CLAIMS, 900)
  const one = await attester.sign(BEN, RECIPIENT)
  const two = await attester.sign(BEN, RECIPIENT)
  assert.ok(one.attestation.deadline > BigInt(Math.floor(Date.now() / 1000)))
  assert.notEqual(one.attestation.salt, two.attestation.salt)
  // ⚠ Two attestations for the same person are two distinct digests, so one being redeemed does not
  // consume the other.
  assert.notEqual(one.signature, two.signature)
})

/** ⭐⭐ The property the whole design rests on: there is nowhere in here to put an amount. */
test('no amount is signed', () => {
  const fields = ATTESTATION_TYPES.Attestation.map((f) => f.name)
  assert.deepEqual(fields, ['beneficiary', 'recipient', 'deadline', 'salt'])
})
