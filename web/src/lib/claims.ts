import { parseAbi, type Address, type Hex, type WalletClient } from 'viem'
import { publicClient } from './chain.ts'
import { pairBy } from './pairs.ts'
import { CLAIMS, CLAIMS_ABI, PONS_FACTORY, SPLITTER_ABI, claimsLive, type Launch } from './launchpad.ts'
import { requestAttestation } from './api.ts'
import { rhc } from './chain.ts'
import { PHASE } from './pool.ts'

/**
 * Taking money out.
 *
 * ## ⭐⭐ TWO PATHS, AND ONE OF THEM NEEDS NOBODY
 *
 * A wallet recipient's beneficiary is `keccak256("wallet:0x…")`, which the vault recomputes from
 * `msg.sender`. So a launcher who kept a share of their own launch claims it with no server, no
 * sign-in and no signature from anybody: if this site disappears tomorrow, that money is still
 * reachable from a block explorer.
 *
 * A social recipient needs one thing the chain cannot check — that a browser really holds the
 * account — and that is the entire job of the attestation. ⚠ It carries no amount.
 */

export type OwedRow = {
  launch: Launch
  /** In the launch's pair asset, its own units. */
  owed: bigint
}

/**
 * What one beneficiary can take, across every launch on the site.
 *
 * ⭐ ONE `eth_call` for the whole list. Robinhood Chain makes a block roughly every 100ms and its
 * public RPC caps `eth_getLogs` at 2,000 blocks — about three minutes of history — so none of this
 * can be answered from events, and a read per launch would be dozens of round trips against a
 * rate-limited endpoint.
 */
export async function owedAcross(launches: Launch[], beneficiary: Hex): Promise<OwedRow[]> {
  if (!claimsLive() || launches.length === 0) return []
  const amounts = (await publicClient.readContract({
    address: CLAIMS as Address,
    abi: CLAIMS_ABI,
    functionName: 'owedMany',
    args: [launches.map((l) => l.token), beneficiary, launches.map((l) => l.pairToken)],
  })) as readonly bigint[]

  return launches
    .map((launch, i) => ({ launch, owed: amounts[i] ?? 0n }))
    .filter((r) => r.owed > 0n)
}

/** ⚠ Grouped by asset only for display. Two launches paired against different assets are two
 *  separate figures and are never added together. */
export function totalsByAsset(rows: OwedRow[]): { asset: Address; symbol: string; decimals: number; total: bigint }[] {
  const byAsset = new Map<string, bigint>()
  for (const r of rows) {
    const k = r.launch.pairToken.toLowerCase()
    byAsset.set(k, (byAsset.get(k) ?? 0n) + r.owed)
  }
  return [...byAsset].map(([asset, total]) => {
    const pair = pairBy(asset)
    return { asset: asset as Address, symbol: pair?.symbol ?? 'TOKEN', decimals: pair?.decimals ?? 18, total }
  })
}

const args = (rows: OwedRow[]) => [rows.map((r) => r.launch.token), rows.map((r) => r.launch.pairToken)] as const

/**
 * Claim as a wallet recipient. No server in the path at all.
 *
 * ⚠ Simulated first. The vault reverts `NothingOwed` on a claim that would move nothing, and a
 * wallet popping up for a transaction that is already doomed is the worst place to find that out.
 */
export async function claimAsWallet(wallet: WalletClient, account: Address, rows: OwedRow[]): Promise<Hex> {
  const [launches, assets] = args(rows)
  const { request } = await publicClient.simulateContract({
    address: CLAIMS as Address,
    abi: CLAIMS_ABI,
    functionName: 'claimAsWallet',
    args: [launches, assets],
    account,
  })
  return wallet.writeContract({ ...request, chain: rhc, account })
}

/**
 * Claim as a social recipient.
 *
 * ⛔⛔ THE ATTESTATION IS MINTED AT THE MOMENT OF THE CLAIM, not held. It expires in minutes and is
 * consumed by the transaction whether it pays one launch or twenty, so one signature covers the
 * whole list. Requesting it early and sitting on it is how somebody's claim fails with
 * `AttestationExpired` after they have already approved it in a wallet.
 */
export async function claimWithAttestation(
  wallet: WalletClient,
  account: Address,
  rows: OwedRow[],
  recipient: Address,
): Promise<Hex> {
  const { attestation, signature } = await requestAttestation(recipient)
  const [launches, assets] = args(rows)
  const typed = {
    beneficiary: attestation.beneficiary,
    recipient: attestation.recipient,
    // ⚠ Back to a bigint. It crosses JSON as a string because JSON has no 64 bit integer, and a
    // deadline that silently lost precision is a signature the contract rejects for no visible reason.
    deadline: BigInt(attestation.deadline),
    salt: attestation.salt,
  }
  const { request } = await publicClient.simulateContract({
    address: CLAIMS as Address,
    abi: CLAIMS_ABI,
    functionName: 'claimWithAttestation',
    args: [typed, signature, launches, assets],
    account,
  })
  return wallet.writeContract({ ...request, chain: rhc, account })
}

/* ── moving fees into the vault ─────────────────────────────────────────────────────────────── */

const FACTORY_POOL_ABI = parseAbi(['function createGraduatedPool(address token)'])

/**
 * Seed the Uniswap V4 pool for a launch that has graduated but has no pool yet — Pons **phase 1**.
 *
 * ⛔⛔ THE ONE THING THAT UNSTICKS A PHASE-1 LAUNCH, AND NOTHING ELSE DOES. Graduating sweeps the
 * curve and kills it; until somebody seeds the pool the token does not trade, earns nothing, and
 * `sweepPool` has no pool to sweep. A page that offers only "Sweep" in this state shows a button
 * that always reverts and never names the action that would actually help.
 *
 * ⭐ Permissionless — anybody may call it, and it needs nothing but gas. Selector `0x2f53ef2f`,
 * confirmed present in the live factory's bytecode.
 */
export async function createGraduatedPool(wallet: WalletClient, account: Address, token: Address): Promise<Hex> {
  const { request } = await publicClient.simulateContract({
    address: PONS_FACTORY,
    abi: FACTORY_POOL_ABI,
    functionName: 'createGraduatedPool',
    args: [token],
    account,
  })
  return wallet.writeContract({ ...request, chain: rhc, account })
}


/**
 * Sweep a launch's fees out of wherever Pons is holding them and credit every recipient.
 *
 * ⛔⛔ WHICH SWEEP DEPENDS ON WHETHER IT HAS GRADUATED, AND GETTING IT WRONG LOOKS LIKE ZERO EARNINGS.
 * Before graduation the fees are on the bonding curve; after, they are in the meme hook and
 * `sweepCurve` reverts forever. A page that only knows the curve sweep cannot move a graduated
 * launch's fees and cannot even see them — the escrow it reads is what the sweep is what fills.
 *
 * ⭐ Permissionless. Anybody can pay the gas, including the recipient.
 */
/**
 * What a sweep-and-harvest actually did.
 *
 * ⚠ `swept: 'skipped'` with a `hash` is a SUCCESS, not a partial failure — the harvest ran and paid
 * out; only the attempt to pull in NEW fees could not. On a graduated launch that is the normal
 * case, because only Pons's own sweeper may move a pool's fees.
 */
export type SweepAndHarvest = { hash: Hex; swept: 'done' | 'skipped' | 'nothing'; sweepError: string | null }

export async function sweepAndHarvest(
  wallet: WalletClient,
  account: Address,
  opts: {
    splitter: Address
    curve: Address
    pairToken: Address
    /**
     * ⛔⛔ THE PHASE, NOT A BOOLEAN. This took a `graduated: boolean` and the two sweeps are chosen
     * by three states: `sweepCurve` reverts from phase 2 on, `sweepPool` has no pool before it, and
     * phase 1 has neither. A bool here is an invitation to pass `curve.graduated()` — which answers
     * true for both 1 and 2 — and get the wrong sweep on half of them. @see PHASE
     */
    phase: number
    hook: Address | null
    poolId: Hex | null
  },
): Promise<SweepAndHarvest> {
  const { splitter, curve, pairToken, phase, hook, poolId } = opts

  if (phase === PHASE.swept) {
    /* ⛔ Not a sweep at all. Nothing has accrued anywhere and nothing will until the pool exists. */
    throw new Error('this launch has graduated but its pool has not been created yet')
  }

  /**
   * ⛔⛔ THE SWEEP IS BEST-EFFORT AND MUST NEVER BLOCK THE HARVEST.
   *
   * These are two independent hops over two different piles of money. The sweep moves fees out of
   * the curve or the pool into Pons's escrow; the harvest divides what is ALREADY in the escrow
   * among the recipients. Money that arrived in an earlier sweep is sitting there waiting, and it
   * has nothing to do with whether a new sweep can run today.
   *
   * 🔴🔴 RUNNING THEM AS ONE SEQUENCE STRANDED REAL MONEY. On a graduated launch `sweepPool`
   * reverts for anyone but Pons's own operator (`0x31cdb504` — the hook's swap gate shuts on the
   * fee recipient). The revert happened at the SIMULATION, so the function threw before it reached
   * the harvest, and the button did nothing at all — on a launch with 0.93 ETH sitting in the
   * escrow that a lone `harvest()` would have credited in 140k gas. The owner reported it as the
   * button not working, and the money being missing. It was neither: it was reachable the whole
   * time, behind a call that could never succeed.
   *
   * ➤ So a sweep that cannot run is recorded and stepped over, never thrown. The harvest is what
   * this function is for.
   */
  let swept: 'done' | 'skipped' | 'nothing' = 'nothing'
  let sweepError: string | null = null

  if (phase === PHASE.inPool) {
    if (!hook || !poolId) {
      sweepError = 'the pool is not created yet'
      swept = 'skipped'
    } else {
      try {
        await sweepThePool(splitter, hook, poolId, account, wallet)
        swept = 'done'
      } catch (e) {
        /* ⚠ Recorded, not thrown. @see the note above. */
        sweepError = e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e)
        swept = 'skipped'
      }
    }
  } else {
    try {
      await sweepTheCurve(splitter, curve, account, wallet)
      swept = 'done'
    } catch (e) {
      sweepError = e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e)
      swept = 'skipped'
    }
  }

  /* ⛔⛔ TWO ESCROW LEDGERS, AND A LAUNCH LANDS IN EXACTLY ONE. A launch paired against USDG credits
     only the token side and its native balance reads a truthful, useless zero forever. Calling the
     wrong one succeeds and moves nothing. */
  const native = /^0x0+$/.test(pairToken)
  const { request } = await publicClient.simulateContract({
    address: splitter,
    abi: SPLITTER_ABI,
    functionName: native ? 'harvest' : 'harvestToken',
    args: native ? [] : [pairToken],
    account,
  } as never)
  const hash = await wallet.writeContract({ ...request, chain: rhc, account })
  return { hash, swept, sweepError }
}

/** ⚠ Split out only so the caller above reads as the two independent hops it is. */
async function sweepThePool(
  splitter: Address,
  hook: Address,
  poolId: Hex,
  account: Address,
  wallet: WalletClient,
): Promise<void> {
  {
    const { request } = await publicClient.simulateContract({
      address: splitter,
      abi: SPLITTER_ABI,
      functionName: 'sweepPool',
      /* ⛔⛔ `minConversionQuoteOut` IS 1, NOT 0, AND THE OBVIOUS REASONING HERE IS BACKWARDS.
         This used to pass `0` with a comment arguing that a floor could "only be a way for the
         sweep to revert". The opposite is true: the hook has an explicit guard that REJECTS a zero
         minimum whenever a conversion would actually run — `MinimumOutputRequired()` `0x3672d25f`.
         Verified on the live pool: as Pons's own operator, `(0, 0)` reverts and `(1, 0)` succeeds.
         A 1-wei floor cannot cause a revert that 0 would not; 0 can cause one that 1 would not.
         ⚠ Today the swap gate shuts on the fee recipient first, so we cannot yet reach the guard —
         which is exactly why it would have sat here unnoticed until the day we could.
         ⚠ `minBuybackTokensOut` stays 0: SHARE launches leave the buyback off, and 0 is accepted
         there (the operator's `(1, 0)` succeeded). */
      args: [hook, poolId, 1n, 0n],
      account,
    })
    await wallet.writeContract({ ...request, chain: rhc, account })
  }
}

async function sweepTheCurve(
  splitter: Address,
  curve: Address,
  account: Address,
  wallet: WalletClient,
): Promise<void> {
  const { request } = await publicClient.simulateContract({
    address: splitter,
    abi: SPLITTER_ABI,
    functionName: 'sweepCurve',
    args: [curve, 0n],
    account,
  })
  await wallet.writeContract({ ...request, chain: rhc, account })
}

/** Whether the vault is accepting claims at all. ⚠ Funding is never paused; only claiming is. */
export async function claimsPaused(): Promise<boolean> {
  if (!claimsLive()) return false
  return (await publicClient
    .readContract({ address: CLAIMS as Address, abi: CLAIMS_ABI, functionName: 'paused' })
    .catch(() => false)) as boolean
}
