/**
 * Prints the address `ShareClaims.signer` has to be set to.
 *
 * ```
 *   npm run signer:address
 * ```
 *
 * ⛔⛔ RUN THIS BEFORE DEPLOYING, NOT AFTER. `signer` is a constructor argument on the vault, and
 * getting it wrong means every attestation this server issues is refused as a bad signature — with
 * nothing anywhere looking wrong. Rotating it afterwards is possible and costs a transaction from
 * the cold owner key.
 */
import { privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'
import { loadDotEnv } from '../src/config.ts'

loadDotEnv()
const key = process.env.ATTESTATION_KEY?.trim()
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error('ATTESTATION_KEY is not set in .env (nor the environment).')
  process.exit(1)
}
console.log(privateKeyToAccount(key as Hex).address)
