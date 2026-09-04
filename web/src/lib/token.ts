import { formatUnits, keccak256, parseAbi, toBytes, type Address } from 'viem'
import { publicClient } from './chain.ts'
import { capUsdScaled } from './marketCap.ts'
import { pairBy } from './pairs.ts'
import { poolIdOf, poolPrice } from './pool.ts'
import { PHASE, readUnswept, NOTHING_UNSWEPT, type Unswept } from './unswept.ts'
import { usdPerAsset } from './usdPrice.ts'
import {
  CLAIMS,
  CLAIMS_ABI,
  FACTORY_ABI,
  LAUNCHPAD,
  LAUNCHPAD_ABI,
  PONS_FACTORY,
  SPLITTER_ABI,
  claimsLive,
  isLive,
  toRecipient,
  type Entry,
  type Recipient,
} from './launchpad.ts'

/**
 * Everything a token page shows, read from the chain and nowhere else.
 *
 * ⚠⚠ There is no API behind these numbers and no database. Every figure is an `eth_call` made in the
 * visitor's own browser, which is what lets the page be checked: anybody can make the same calls and
 * get the same answers, including the recipients.
 */
export { poolPrice, poolIdOf }

/** ⚠ The identity scheme itself lives in `beneficiary.ts`; this hashes a string the CHAIN built, so
 *  it deliberately does not re-derive it. @see the note on `RecipientView.beneficiary`. */
const keccakOf = (identity: string) => keccak256(toBytes(identity))

const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function logo() view returns (string)',
  'function description() view returns (string)',
])

const CURVE_ABI = parseAbi([
  'function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)',
  'function graduated() view returns (bool)',
])

/** One row of the split, with what it has actually been paid. */
export type RecipientView = Recipient & {
  /** `keccak256(identity)` — the key the vault pays. ⭐ Derived here so it can be checked on screen. */
  beneficiary: `0x${string}`
  /** Credited to them by the splitter, in the pair asset's units. */
  credited: bigint
  /** Of that, what they have taken out. ⚠ Zero for somebody who has never signed in. */
  claimed: bigint
}

export type TokenView = {
  address: Address
  name: string
  symbol: string
  decimals: number
  totalSupply: bigint
  logo: string
  description: string

  splitter: Address
  creator: Address
  launchedAt: bigint
  socialBps: number
  recipients: RecipientView[]

  pairToken: Address
  pairSymbol: string
  pairDecimals: number
  curve: Address
  creatorTaxBps: number
  /**
   * ⛔⛔ THE LIFECYCLE HAS THREE STATES AND A BOOLEAN CANNOT HOLD THEM. 0 on the curve · 1 swept but
   * the pool is not seeded · 2 trading in the pool. Phases 1 and 2 both look "graduated" and need
   * opposite things done to them — at 1 there is nothing to sweep and the fix is to create the
   * pool. Taken from the FACTORY record, not from `curve.graduated()`, which is a bool. @see PHASE
   */
  phase: number
  /** ⚠ Convenience for copy only — `phase >= 1`. ⛔ Never branch a SWEEP on this. */
  graduated: boolean

  /** ⚠ Needed to sweep a graduated launch, and only derivable once the pool key is known. */
  hook: Address | null
  poolId: `0x${string}` | null

  /**
   * Where the fees actually are, before any sweep.
   *
   * ⛔⛔ `pending` below is the ESCROW, which is the LAST hop — it reads a truthful zero for the
   * whole time fees sit on the curve or in the hook. This is the figure that answers "has this
   * launch earned anything". @see readUnswept
   */
  unswept: Unswept

  /** Price of one token in the pair asset. ⛔ `null` when it cannot be read, never 0. */
  price: number | null
  /**
   * ⛔⛔ THE ONE PEOPLE READ, in USD, scaled by 1e6. A cap denominated in the pair asset cannot be
   * compared between two tokens paired against different assets, and it moves when ETH moves though
   * nothing about the token changed.
   */
  marketCapUsd: bigint | null

  /** Credited to recipients in total. ⚠ Money that has MOVED — not what the launch has earned. */
  shared: bigint
  claimedOut: bigint
  /** Swept or held, waiting on a harvest. */
  pending: bigint
}

export async function readToken(address: Address): Promise<TokenView | null> {
  if (!isLive()) return null

  /* ⛔ The register is the gate. A token this launchpad did not create has no split, and rendering it
     with zeroes would show a launch paying nobody as though that were a fact about it. `launchOf`
     REVERTS for an unknown token rather than answering with an empty struct, which is why this is a
     catch and not a truthiness check. */
  const found = await publicClient
    .readContract({ address: LAUNCHPAD as Address, abi: LAUNCHPAD_ABI, functionName: 'launchOf', args: [address] })
    .catch(() => null)
  if (!found) return null

  const [entry, rawRecipients] = found as unknown as [Entry, readonly {
    platform: number; bps: number; wallet: Address; identity: string; handle: string
  }[]]

  const pair = pairBy(entry.pairToken)
  const pairDecimals = pair?.decimals ?? 18

  const [name, symbol, decimals, totalSupply, logo, description, launched, hook, shared, claimedOut, pending] =
    await Promise.all([
      publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'name' }).catch(() => 'Unknown'),
      publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => '???'),
      publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18),
      publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'totalSupply' }).catch(() => 0n),
      publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'logo' }).catch(() => ''),
      publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'description' }).catch(() => ''),
      publicClient
        .readContract({ address: PONS_FACTORY, abi: FACTORY_ABI, functionName: 'getLaunchedToken', args: [address] })
        .catch(() => null),
      publicClient.readContract({ address: PONS_FACTORY, abi: FACTORY_ABI, functionName: 'memeHook' }).catch(() => null),
      claimsLive()
        ? publicClient
            .readContract({ address: CLAIMS as Address, abi: CLAIMS_ABI, functionName: 'creditedForLaunch', args: [address, entry.pairToken] })
            .catch(() => 0n)
        : Promise.resolve(0n),
      claimsLive()
        ? publicClient
            .readContract({ address: CLAIMS as Address, abi: CLAIMS_ABI, functionName: 'claimedForLaunch', args: [address, entry.pairToken] })
            .catch(() => 0n)
        : Promise.resolve(0n),
      publicClient
        .readContract({ address: entry.splitter, abi: SPLITTER_ABI, functionName: 'pending', args: [entry.pairToken] })
        .catch(() => 0n),
    ])

  const dec = Number(decimals)

  /* ⛔⛔ THE PHASE COMES FROM THE FACTORY RECORD, NOT FROM `curve.graduated()`.
     That call answers a boolean and this lifecycle has three states: phase 1 — swept off the curve
     but the pool not yet seeded — reads as "graduated" and has no pool to sweep, so a page built on
     the boolean offers a Sweep button that can only revert. ⚠ Falls back to the curve's bool only
     when the factory record could not be read at all, so a bad RPC degrades rather than lying. */
  const [curveGraduated, reserves, unswept] = await Promise.all([
    publicClient.readContract({ address: entry.curve, abi: CURVE_ABI, functionName: 'graduated' }).catch(() => false),
    publicClient.readContract({ address: entry.curve, abi: CURVE_ABI, functionName: 'getReserves' }).catch(() => null),
    readUnswept(address, entry.pairToken).catch(() => NOTHING_UNSWEPT),
  ])
  const phase = launched ? Number(launched.phase) : curveGraduated ? PHASE.swept : PHASE.onCurve
  const graduated = phase >= PHASE.swept

  /*
    ⚠⚠ Price comes from wherever the token actually trades, and the two places are different maths.
    Before graduation it is the curve's reserves; after, the Uniswap V4 pool. Reading the curve on a
    graduated token returns the reserves it stopped at — a stale price presented with full confidence.
  */
  let price: number | null = null
  /* ⛔ Only phase 2 has a pool to price from. At phase 1 the curve is drained and the pool does not
     exist, so BOTH sources are wrong — a null is the honest answer, not the curve's last reserves. */
  if (phase === PHASE.inPool && launched && hook) {
    price = await poolPrice(
      address, entry.pairToken, Number(launched.poolFee), Number(launched.tickSpacing), hook as Address, dec, pairDecimals,
    )
  } else if (phase === PHASE.onCurve && reserves) {
    const [q, t] = reserves as readonly [bigint, bigint]
    if (t > 0n) price = Number(formatUnits(q, pairDecimals)) / Number(formatUnits(t, dec))
  }

  const recipients = await Promise.all(
    rawRecipients.map(async (r) => {
      const base = toRecipient(r)
      /* ⭐ Recomputed in the browser from the string on chain, not taken on trust from anywhere. This
         is the number a recipient can check against the vault themselves. */
      const beneficiary = keccakOf(base.identity)
      const [credited, claimed] = claimsLive()
        ? await Promise.all([
            publicClient
              .readContract({ address: CLAIMS as Address, abi: CLAIMS_ABI, functionName: 'credited', args: [address, beneficiary, entry.pairToken] })
              .catch(() => 0n),
            publicClient
              .readContract({ address: CLAIMS as Address, abi: CLAIMS_ABI, functionName: 'claimed', args: [address, beneficiary, entry.pairToken] })
              .catch(() => 0n),
          ])
        : [0n, 0n]
      return { ...base, beneficiary, credited: credited as bigint, claimed: claimed as bigint }
    }),
  )

  const supply = Number(formatUnits(totalSupply as bigint, dec))
  return {
    address,
    name: name as string,
    symbol: symbol as string,
    decimals: dec,
    totalSupply: totalSupply as bigint,
    logo: logo as string,
    description: description as string,
    splitter: entry.splitter,
    creator: entry.creator,
    launchedAt: entry.launchedAt,
    socialBps: Number(entry.socialBps),
    recipients,
    pairToken: entry.pairToken,
    pairSymbol: pair?.symbol ?? 'TOKEN',
    pairDecimals,
    curve: entry.curve,
    creatorTaxBps: Number(launched?.creatorTaxBps ?? 0),
    phase,
    graduated,
    unswept,
    hook: (hook as Address | null) ?? null,
    /* ⛔⛔ THE ID `readUnswept` VERIFIED, NOT A SECOND DERIVATION OF IT. A pool id that is subtly
       wrong reads `pendingFees` on a pool that does not exist and gets a confident ZERO instead of a
       revert — verified live — so the only id this page will act on is one that came back
       registered from `hook.launches()`. ⚠ Deriving it again here would reintroduce exactly the
       unchecked value the check exists to catch. */
    poolId: unswept.pool?.poolId ?? null,
    price,
    marketCapUsd:
      price === null
        ? null
        : capUsdScaled(
            BigInt(Math.round(price * supply * 10 ** pairDecimals)),
            pairDecimals,
            await usdPerAsset(entry.pairToken, pairDecimals),
          ),
    shared: shared as bigint,
    claimedOut: claimedOut as bigint,
    pending: pending as bigint,
  }
}
