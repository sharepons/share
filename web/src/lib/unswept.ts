import { parseAbi, type Address, type Hex } from 'viem'
import { publicClient } from './chain.ts'
import { PONS_FACTORY } from './launchpad.ts'
import { PHASE, poolIdOf } from './pool.ts'

/**
 * Where a launch's fees actually are, before anything sweeps them.
 *
 * ## ⛔⛔ THE ESCROW IS THE LAST HOP, AND EVERY NUMBER ON THIS SITE READ ONLY THE LAST HOP
 *
 * Pons pays a creator fee in three steps:
 *
 *   1. it accrues **on the curve** — or, after graduation, **in the meme hook**
 *   2. a **sweep** splits it and credits Pons's shared fee escrow
 *   3. `harvest` pulls the escrow and the splitter divides it
 *
 * `ShareSplitter.pending()` reads the escrow, which is step 3's question. A launch whose fees are
 * sitting at step 1 answers a truthful, useless **zero** — and the token page rendered that zero as
 * "Waiting 0", which reads as "this token has earned nothing".
 *
 * ⛔ That is not hypothetical. A sibling project's largest earner showed *"In the escrow 0 ETH —
 * Nothing to collect"* for days while real money sat in the hook, because its only sweep path was
 * `sweepCurve` and graduation had killed the curve. See `../../HANDOFF.md`.
 *
 * ➤ So this module reads where the money is, in **both currencies**, and says whether we are the
 *   ones who can move it. A figure the page cannot act on is still worth showing: "0.16 ETH waiting
 *   on Pons's sweep" is a true answer to the question a recipient is asking. "Nothing" is not.
 *
 * ⭐ Every fact below was verified against the LIVE hook on 4 Sep 2026 — `npm run verify:graduation`
 *   re-runs it. Nothing here is inferred from a comment in another repo.
 */

const FACTORY_ABI = parseAbi([
  'function getLaunchedToken(address token) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))',
  /** ⚠ Without this the pool id cannot be derived at all — the hook is part of the key. */
  'function memeHook() view returns (address)',
  /** ⭐ Permissionless, and the ONLY thing that moves a phase-1 launch along. Selector 0x2f53ef2f,
      confirmed present in the live factory's bytecode. */
  'function createGraduatedPool(address token)',
])

const CURVE_ABI = parseAbi([
  'function protocolFeeShareBps() view returns (uint16)',
  /* ⛔⛔ THREE BALANCES, NOT ONE. The plain fee is split with Pons, the creator tax is NOT, and a
     pending buyback is carved out of the creator's side. Reading only `quoteFeeBalance`
     under-reports a taxed launch by more than half. @see splitCreatorShare */
  'function quoteFeeBalance() view returns (uint256)',
  'function creatorTaxBalance() view returns (uint256)',
  'function buybackQuoteBalance() view returns (uint256)',
])

const HOOK_ABI = parseAbi([
  'function launches(bytes32 poolId) view returns (bool registered, bool memecoinIsCurrency0, address memecoin, address quoteToken, address creator, address buybackCreatorRecipient, address protocolFeeRecipient, uint16 creatorTaxBps, uint16 protocolFeeShareBps, uint16 buybackBurnBps, uint16 hookFeeBps, uint16 maxInternalPriceImpactBps, bool buybackEnabled)',
  'function pendingFees(bytes32 poolId, address currency) view returns (uint256)',
  'function pendingCreatorTax(bytes32 poolId, address currency) view returns (uint256)',
  'function pendingBuyback(bytes32 poolId, address currency) view returns (uint256)',
])

/* ⚠ Re-exported, not redeclared. It is defined in `pool.ts` so that this module and `launchpad.ts`
   can both branch on it without importing each other — see the note there. */
export { PHASE } from './pool.ts'

/**
 * ⛔ Raised when a sweep would have to run an internal swap. Only Pons's `feeSweepOperator` may do
 * that, so the fee recipient — our splitter — cannot.
 *
 * ⭐ VERIFIED LIVE against $CHARITY's pool, as three different callers:
 * a stranger gets `NotFeeSweepOperator()`, the fee recipient gets this, and Pons's operator
 * succeeds. So the fee recipient is *past* the authorisation gate and stopped by the swap rule
 * specifically — which is why the copy for this case must not say "not allowed".
 */
export const INTERNAL_SWAP_REQUIRES_OPERATOR = '0x31cdb504'
const NOT_FEE_SWEEP_OPERATOR = '0x8d42130c'
/** ⚠ `minConversionQuoteOut` of ZERO, when a conversion would actually happen. @see sweep args. */
const MINIMUM_OUTPUT_REQUIRED = '0x3672d25f'

export type Unswept = {
  /** Where the money is. `none` covers a launch that has genuinely earned nothing anywhere. */
  where: 'curve' | 'pool' | 'none'
  /** 0 · 1 · 2, or null when the factory record could not be read. @see PHASE */
  phase: number | null
  /** The curve, for `sweepCurve`. */
  curve: Address | null
  /** The hook and pool id, for `sweepPool`. ⛔ Null unless the pool exists AND is registered. */
  pool: { hook: Address; poolId: Hex } | null
  /**
   * What a sweep right now would credit the splitter, in the pair asset's own units.
   *
   * ⚠ The CREATOR's share, not the gross fee: Pons keeps `protocolFeeShareBps` of the plain fee.
   * Showing the gross would promise a number that never arrives.
   */
  creatorShare: bigint
  /**
   * Fees denominated in the MEMECOIN, waiting in the pool.
   *
   * ⛔⛔ NEVER ADDED TO `creatorShare` — different unit, and the exchange rate does not exist until
   * the swap happens. On $CHARITY this leg was 1,461,625 tokens against 0.0178 ETH on the other
   * side; a page reporting only the quote leg was understating by more than half.
   * ⭐ It is also the *reason* a sweep is operator-only, so it explains the button as well.
   */
  memePending: bigint
  /** False when only Pons's operator can run this sweep. @see INTERNAL_SWAP_REQUIRES_OPERATOR */
  weMaySweep: boolean
}

export const NOTHING_UNSWEPT: Unswept = {
  where: 'none', phase: null, curve: null, pool: null,
  creatorShare: 0n, memePending: 0n, weMaySweep: false,
}

/**
 * What a sweep would credit the fee recipient, from the three pending balances.
 *
 * ```
 * protocol = fee * protocolFeeShareBps / 10000     // Pons's cut of the plain fee
 * creator  = fee - protocol - buyback + tax        // ⭐ the creator TAX is not split
 * ```
 *
 * ⭐ Pure and exported so the arithmetic is tested rather than eyeballed on a screenshot. Same shape
 * on the curve and in the pool, which is why one function serves both.
 */
export function splitCreatorShare(fee: bigint, tax: bigint, buyback: bigint, protocolFeeShareBps: number): bigint {
  if (fee < 0n) return 0n
  const bps = BigInt(Math.max(0, Math.min(10_000, protocolFeeShareBps)))
  const bucket = fee - (fee * bps) / 10_000n
  /* ⚠ Clamped, not subtracted blind. The buyback comes out of the creator's bucket, so one larger
     than the bucket would go negative and render as a nonsense figure. */
  const afterBuyback = buyback > bucket ? 0n : bucket - buyback
  return afterBuyback + tax
}

/** ⚠ viem and raw RPC bury revert data at different depths. Look all the way down the cause chain. */
function revertData(e: unknown): string {
  const seen = new Set<unknown>()
  let cur: unknown = e
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur)
    const d = (cur as { data?: unknown }).data
    if (typeof d === 'string' && d.startsWith('0x')) return d.toLowerCase()
    if (typeof d === 'object' && d && typeof (d as { data?: unknown }).data === 'string') {
      return ((d as { data: string }).data).toLowerCase()
    }
    cur = (cur as { cause?: unknown }).cause
  }
  return ''
}

/**
 * Whether a failed sweep means "only Pons can move this", rather than anything else.
 *
 * ⛔⛔ MATCHED ON THE SELECTOR, NEVER ON THE MESSAGE TEXT. viem renders an unknown custom error as
 * bare hex with no name, so a `/revert/i` string match classifies this — the single most likely
 * failure on a graduated launch — as "there is nothing to move". That is the exact sentence a
 * sibling project showed a recipient who had real money waiting.
 */
export function isOperatorOnly(e: unknown): boolean {
  const d = revertData(e)
  return d.startsWith(INTERNAL_SWAP_REQUIRES_OPERATOR) || d.startsWith(NOT_FEE_SWEEP_OPERATOR)
}

/** ⚠ Distinct from the above: this one means the ARGUMENTS were wrong, not the caller. */
export function isMinimumOutputRequired(e: unknown): boolean {
  return revertData(e).startsWith(MINIMUM_OUTPUT_REQUIRED)
}

/**
 * Read where one launch's unswept fees are.
 *
 * ⚠ Never throws. Every read is caught: this hangs off a page whose primary job — the split, the
 * recipients, the vault balances — must still render when the factory or the hook cannot be reached.
 * ⛔ But "could not read" returns `phase: null`, NOT a zero that renders as "earned nothing".
 */
export async function readUnswept(token: Address, pairToken: Address): Promise<Unswept> {
  const [record, hook] = await Promise.all([
    publicClient
      .readContract({ address: PONS_FACTORY, abi: FACTORY_ABI, functionName: 'getLaunchedToken', args: [token] })
      .catch(() => null),
    publicClient.readContract({ address: PONS_FACTORY, abi: FACTORY_ABI, functionName: 'memeHook' }).catch(() => null),
  ])
  if (!record || !record.exists) return NOTHING_UNSWEPT

  const phase = Number(record.phase)
  const curve = record.curve

  /* ── 0 · still trading on the curve ─────────────────────────────────────────────────────── */
  if (phase === PHASE.onCurve) {
    const [bps, fee, tax, buyback] = await Promise.all([
      publicClient.readContract({ address: curve, abi: CURVE_ABI, functionName: 'protocolFeeShareBps' }).catch(() => 3000),
      publicClient.readContract({ address: curve, abi: CURVE_ABI, functionName: 'quoteFeeBalance' }).catch(() => 0n),
      publicClient.readContract({ address: curve, abi: CURVE_ABI, functionName: 'creatorTaxBalance' }).catch(() => 0n),
      publicClient.readContract({ address: curve, abi: CURVE_ABI, functionName: 'buybackQuoteBalance' }).catch(() => 0n),
    ])
    const creatorShare = splitCreatorShare(fee as bigint, tax as bigint, buyback as bigint, Number(bps))
    /* ⚠ A pending buyback needs a swap, which is operator-only on the curve too. SHARE launches
       leave the buyback off, so this is defensive rather than the normal case. */
    const weMaySweep = (buyback as bigint) === 0n
    if (creatorShare === 0n && (buyback as bigint) === 0n) return { ...NOTHING_UNSWEPT, phase, curve }
    return { where: 'curve', phase, curve, pool: null, creatorShare, memePending: 0n, weMaySweep }
  }

  /* ── 1 · swept off the curve, but nobody has seeded the pool ─────────────────────────────
     ⛔ There is genuinely nothing to sweep here, and no amount of retrying changes that. What is
     needed is `createGraduatedPool`, which anybody may call. @see createGraduatedPool */
  if (phase === PHASE.swept) return { ...NOTHING_UNSWEPT, phase, curve }

  /* ── 2 · trading in the V4 pool ─────────────────────────────────────────────────────────── */
  if (!hook) return { ...NOTHING_UNSWEPT, phase, curve }
  const poolId = poolIdOf(token, pairToken, Number(record.poolFee), Number(record.tickSpacing), hook as Address)

  /* ⛔⛔ THE GUARD ON THE DERIVATION, AND IT IS NOT OPTIONAL. V4 has no registry to ask, so the id
     is reproduced from the pool key. `pendingFees` on an id that does not exist returns **zero
     rather than reverting** — verified live — so a derivation that is subtly wrong reports "no
     fees" and is indistinguishable from the truth. Only a registered pool naming THIS memecoin is
     believed. */
  const info = await publicClient
    .readContract({ address: hook as Address, abi: HOOK_ABI, functionName: 'launches', args: [poolId] })
    .catch(() => null)
  if (!info || info[0] !== true || info[2].toLowerCase() !== token.toLowerCase()) {
    return { ...NOTHING_UNSWEPT, phase, curve }
  }

  const [qFee, qTax, qBuy, mFee, mTax, mBuy] = await Promise.all(
    (
      [
        [pairToken, 'pendingFees'], [pairToken, 'pendingCreatorTax'], [pairToken, 'pendingBuyback'],
        [token, 'pendingFees'], [token, 'pendingCreatorTax'], [token, 'pendingBuyback'],
      ] as const
    ).map(([currency, fn]) =>
      publicClient
        .readContract({ address: hook as Address, abi: HOOK_ABI, functionName: fn, args: [poolId, currency] })
        .catch(() => 0n),
    ),
  )

  /* ⚠ The pool's OWN frozen split, off `launches`, not the factory's current global. A launch keeps
     the terms it registered with. */
  const creatorShare = splitCreatorShare(qFee, qTax, qBuy, Number(info[8]))
  const memePending = mFee + mTax + mBuy
  const pool = { hook: hook as Address, poolId }

  if (creatorShare === 0n && memePending === 0n && qBuy === 0n) {
    return { ...NOTHING_UNSWEPT, phase, curve, pool }
  }

  /* ⛔⛔ Mirrors the hook's own `_requiresTrustedOperator` rather than restating it loosely: a
     pending buyback needs a swap, and so does ANY fee sitting in the memecoin, because it has to be
     converted before it can be credited. Either one makes the WHOLE sweep operator-only —
     including the quote leg that would otherwise have been ours to move. */
  const needsSwap = qBuy > 0n || memePending > 0n
  return { where: 'pool', phase, curve, pool, creatorShare, memePending, weMaySweep: !needsSwap }
}
