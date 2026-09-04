/**
 * Signing the one sentence this server is allowed to say: "this browser proved it holds that
 * account, and asked to be paid at this address."
 *
 * ## ⭐⭐ THERE IS NO AMOUNT IN HERE, AND THAT IS THE DESIGN
 *
 * The voucher pattern this replaces has the server compute what somebody has earned and sign for
 * that number, which puts the arithmetic of every payout inside a process nobody can audit after
 * the fact. Here the splitter already divided each fee on chain, so the amount is a subtraction the
 * vault performs on its own ledger and the signer never touches it.
 *
 * ➤ The blast radius of this key is therefore: redirect an UNCLAIMED balance to an address of the
 * attacker's choosing, for as long as it takes `owner` to call `setSigner`. It cannot invent money,
 * cannot touch a claimed balance, and cannot change a split.
 *
 * ## ⛔⛔ THE DOMAIN MUST MATCH THE DEPLOYED CONTRACT EXACTLY
 *
 * `name`, `version`, `chainId` and `verifyingContract` are hashed into the domain separator baked
 * into `ShareClaims` at deployment. A single character out and every signature is rejected as a bad
 * one, with nothing anywhere looking wrong. The strings are pinned in `test/attest.test.ts` against
 * the constants in the contract.
 */
import { randomBytes } from 'node:crypto'
import { privateKeyToAccount } from 'viem/accounts'
import type { Address, Hex } from 'viem'

export const DOMAIN_NAME = 'ShareClaims'
export const DOMAIN_VERSION = '1'

/** ⚠ Field order and names are part of the hash and must match `ATTESTATION_TYPEHASH`. */
export const ATTESTATION_TYPES = {
  Attestation: [
    { name: 'beneficiary', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'deadline', type: 'uint256' },
    { name: 'salt', type: 'bytes32' },
  ],
} as const

export type Attestation = {
  beneficiary: Hex
  recipient: Address
  deadline: bigint
  salt: Hex
}

export class Attester {
  private readonly account: ReturnType<typeof privateKeyToAccount>
  readonly chainId: number
  readonly claims: Address
  readonly ttlSeconds: number

  constructor(privateKey: Hex, chainId: number, claims: Address, ttlSeconds: number) {
    this.account = privateKeyToAccount(privateKey)
    this.chainId = chainId
    this.claims = claims
    this.ttlSeconds = ttlSeconds
  }

  /** The address `ShareClaims.signer` has to be set to. ⚠ Printed by `npm run signer:address`. */
  get address(): Address {
    return this.account.address
  }

  async sign(beneficiary: Hex, recipient: Address): Promise<{ attestation: Attestation; signature: Hex }> {
    const attestation: Attestation = {
      beneficiary,
      recipient,
      deadline: BigInt(Math.floor(Date.now() / 1000) + this.ttlSeconds),
      /* ⚠ 32 random bytes, never a counter. The vault marks the DIGEST redeemed, so a predictable
         salt is not a double-spend — it is a way for somebody watching the chain to know what the
         next attestation will look like before it is issued. */
      salt: `0x${randomBytes(32).toString('hex')}` as Hex,
    }

    const signature = await this.account.signTypedData({
      domain: {
        name: DOMAIN_NAME,
        version: DOMAIN_VERSION,
        chainId: this.chainId,
        verifyingContract: this.claims,
      },
      types: ATTESTATION_TYPES,
      primaryType: 'Attestation',
      message: attestation,
    })

    return { attestation, signature }
  }
}
