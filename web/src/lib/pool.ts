import { encodeAbiParameters, keccak256, parseAbi, type Address } from 'viem'
import { publicClient } from './chain.ts'

/**
 * The price of a GRADUATED token, read straight out of the Uniswap V4 singleton's storage.
 *
 * ⛔⛔ IN ITS OWN MODULE ON PURPOSE. The launch feed needs it and so does the token page, and having
 * it live in either one makes those two import each other — a cycle that works until a bundler
 * hoists the wrong half and one of them sees `undefined` at module scope.
 *
 * ⚠ Same maths as the pool key: the id is keccak of the ordered key, and the pool's slot0 sits at
 * `keccak(poolId, 6)` in the singleton's storage.
 * ⛔ `sqrtPriceX96` is up to 2^160, so squaring it in JS floats loses precision fast. The ratio is
 * taken in float only at the end, and only because this figure is a display value that never becomes
 * an input to a transaction.
 */
const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951' as Address
const PM_ABI = parseAbi(['function extsload(bytes32 slot) view returns (bytes32)'])

export async function poolPrice(
  token: Address,
  pair: Address,
  fee: number,
  tickSpacing: number,
  hooks: Address,
  tokenDecimals: number,
  pairDecimals: number,
): Promise<number | null> {
  try {
    const tokenIsZero = BigInt(token) < BigInt(pair)
    const [c0, c1] = tokenIsZero ? [token, pair] : [pair, token]
    const id = keccak256(
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
        [c0, c1, fee, tickSpacing, hooks],
      ),
    )
    const base = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [id, 6n]))
    const word = await publicClient.readContract({
      address: POOL_MANAGER,
      abi: PM_ABI,
      functionName: 'extsload',
      args: [base],
    })
    const sq = BigInt(word) & ((1n << 160n) - 1n)
    if (sq === 0n) return null
    const ratio = Number(sq) ** 2 / 2 ** 192
    const [d0, d1] = tokenIsZero ? [tokenDecimals, pairDecimals] : [pairDecimals, tokenDecimals]
    const human = ratio * 10 ** (d0 - d1)
    return tokenIsZero ? human : 1 / human
  } catch {
    return null
  }
}

/**
 * Pons's launch lifecycle. **0** trading on the curve · **1** swept off it but the pool is NOT
 * seeded · **2** trading in the V4 pool.
 *
 * ⛔⛔ `curve.graduated()` IS A BOOLEAN AND CANNOT HOLD THIS. Phases 1 and 2 both answer true, and
 * they need opposite things: at 1 there is nothing to sweep and nothing to price, and the only
 * thing that helps is `createGraduatedPool`. Read `getLaunchedToken().phase` instead.
 *
 * ⚠⚠ IT LIVES HERE, BESIDE THE POOL KEY, FOR THE SAME REASON `poolPrice` DOES. The feed
 * (`launchpad.ts`) and the fee reader (`unswept.ts`) both branch on it, and `unswept.ts` already
 * imports `launchpad.ts` for the factory address — so putting it in either one makes those two
 * import each other. That cycle works until a bundler hoists the wrong half and one of them sees
 * `undefined` at module scope. This module imports nothing but the chain.
 */
export const PHASE = { onCurve: 0, swept: 1, inPool: 2 } as const

/** The pool id a graduated launch's fees accrue under. ⚠ Needed by `sweepPool`. */
export function poolIdOf(token: Address, pair: Address, fee: number, tickSpacing: number, hooks: Address): `0x${string}` {
  const [c0, c1] = BigInt(token) < BigInt(pair) ? [token, pair] : [pair, token]
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [c0, c1, fee, tickSpacing, hooks],
    ),
  )
}
