import { formatUnits, parseAbi, type Address, type Hex } from 'viem'
import { ENV, publicClient } from './chain.ts'
import { NATIVE, pairBy } from './pairs.ts'
import { capUsdScaled, marketCapInPair } from './marketCap.ts'
import { PHASE, poolPrice } from './pool.ts'
import { usdPerAsset } from './usdPrice.ts'
import { platformFromIndex, type Platform } from './platforms.ts'

/**
 * `ShareLaunchpad`, and everything the site reads off it.
 *
 * ⛔⛔ NOT DEPLOYED UNTIL THIS IS SET. Left unset the site renders honestly — the launch form says so
 * and the feed says so — rather than showing a zero that reads as "nobody has launched yet". A
 * launchpad reporting an empty register when it is really pointing at nothing is the same class of
 * lie as reading one fee ledger and reporting zero.
 */
export const LAUNCHPAD = (ENV?.VITE_LAUNCHPAD || '') as Address | ''
export const CLAIMS = (ENV?.VITE_CLAIMS || '') as Address | ''

/**
 * ⛔ The LIVE Pons V2 factory. The one most older projects on this chain still point at is retired,
 * and its `launchEnabled` reads false — which surfaces as "launches are closed" for a chain where
 * they are wide open.
 */
export const PONS_FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e' as Address
export const LAUNCH_CONFIG_ID = 0n

export const isLive = () => /^0x[0-9a-fA-F]{40}$/.test(LAUNCHPAD)
export const claimsLive = () => /^0x[0-9a-fA-F]{40}$/.test(CLAIMS)

export const LAUNCHPAD_ABI = parseAbi([
  'struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }',
  'struct LaunchParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }',
  'struct RecipientInput { uint8 platform; string accountRef; string handle; address wallet; uint16 bps; }',
  'struct Recipient { uint8 platform; uint16 bps; address wallet; string identity; string handle; }',
  'struct Entry { address token; address curve; address splitter; address creator; address pairToken; uint64 launchedAt; uint16 socialBps; uint8 recipientCount; }',
  'struct DevBuy { uint256 quoteIn; uint256 minTokensOut; }',
  'function launch(LaunchParams params, uint256 launchConfigId, address pairToken, RecipientInput[] recipients) payable returns (address token, address curve, address splitter)',
  /**
   * ⛔⛔ The value is EXACT: `launchFee + quoteIn` for a native pair, `launchFee` alone otherwise.
   * Anything else reverts `NativeValueMismatch`. There is no slack and no tip.
   */
  'function launchWithBuy(LaunchParams params, uint256 launchConfigId, address pairToken, RecipientInput[] recipients, DevBuy devBuy, address[] snipeTaxExemptions) payable returns (address token, address curve, address splitter)',
  'function count() view returns (uint256)',
  'function page(uint256 offset, uint256 limit) view returns (Entry[])',
  'function recipientsPage(uint256 offset, uint256 limit) view returns (Recipient[][])',
  'function launchOf(address token) view returns (Entry entry, Recipient[] recipients)',
  'function minSocialBps() view returns (uint16)',
  'function isShareLaunch(address token) view returns (bool)',
  'error LaunchesClosed()',
  'error SocialShareTooSmall(uint16 asked, uint16 floorRequired)',
  'error BadSplit(uint256 total)',
  'error DuplicateRecipient(bytes32 beneficiary)',
  'error TooManyRecipients(uint256 given, uint8 max)',
  'error EmptyHandle()',
  'error HandleTooLong()',
  'error PairTokenNotApproved(address pairToken)',
  'error EconomicsMoved(bytes32 pinned, bytes32 live)',
  'error DevBuyUnavailable()',
  'error NativeValueMismatch(uint256 supplied, uint256 expected)',
  'error NotNumericId(string accountRef)',
  'error BadHandleCharacter(string accountRef)',
])

export const FACTORY_ABI = parseAbi([
  'function launchEnabled() view returns (bool)',
  'function launchFee() view returns (uint256)',
  'function maxCreatorTaxBps() view returns (uint256)',
  'function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)',
  'function memeHook() view returns (address)',
  'function getLaunchedToken(address token) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))',
])

export const SPLITTER_ABI = parseAbi([
  /** ⚠ Both escrow ledgers plus what the splitter is already holding. NOT what the launch earned. */
  'function pending(address asset) view returns (uint256)',
  'function recipients() view returns (bytes32[] beneficiaries, uint16[] bps)',
  'function harvest() returns (uint256)',
  'function harvestToken(address asset) returns (uint256)',
  /** ⚠ Permissionless passthrough. Pons refuses a sweep from anyone but its operator or the fee
   *  recipient, so without this a launch's fees wait on Pons's own schedule. */
  'function sweepCurve(address curve, uint256 minBuybackTokensOut)',
  /** ⛔⛔ The sweep for a GRADUATED launch. The curve stops earning and the meme hook starts, and a
   *  page that only knows `sweepCurve` cannot move those fees or even see them. */
  'function sweepPool(address hook, bytes32 poolId, uint256 minConversionQuoteOut, uint256 minBuybackTokensOut)',
  'function release(address asset)',
])

export const CLAIMS_ABI = parseAbi([
  'struct Attestation { bytes32 beneficiary; address recipient; uint256 deadline; bytes32 salt; }',
  'function owed(address launch, bytes32 beneficiary, address asset) view returns (uint256)',
  'function owedMany(address[] launches, bytes32 beneficiary, address[] assets) view returns (uint256[])',
  'function credited(address launch, bytes32 beneficiary, address asset) view returns (uint256)',
  'function claimed(address launch, bytes32 beneficiary, address asset) view returns (uint256)',
  'function creditedForLaunch(address launch, address asset) view returns (uint256)',
  'function claimedForLaunch(address launch, address asset) view returns (uint256)',
  'function claimAsWallet(address[] launches, address[] assets) returns (uint256)',
  'function claimWithAttestation(Attestation attestation, bytes signature, address[] launches, address[] assets) returns (uint256)',
  'function paused() view returns (bool)',
  'error NothingOwed()',
  'error IsPaused()',
  'error AttestationExpired()',
  'error AttestationAlreadyUsed()',
  'error BadSignature()',
])

const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  /* ⛔ The graduated branch used to hard-code 18 for the token while reading the pair's decimals
     properly, so any other precision priced orders of magnitude out — as a plausible number. */
  'function decimals() view returns (uint8)',
  /* ⭐ Read from the token itself rather than guessed from an explorer icon path. The explorer only
     has an icon once it has indexed one, so a brand new launch shows a broken image for its first
     minutes — which is exactly when somebody is looking at it. */
  'function logo() view returns (string)',
])

const CURVE_ABI = parseAbi([
  'function graduated() view returns (bool)',
  /* ⚠ `quoteReserve` INCLUDES the curve's phantom quote, which is virtual and not real money. It
     belongs in the PRICE and must be excluded from anything describing liquidity. */
  'function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)',
])

/* ── shapes ────────────────────────────────────────────────────────────────────────────────── */

export type Recipient = {
  platform: Platform
  bps: number
  wallet: Address
  /**
   * ⭐⭐ The canonical identity string, built ON CHAIN. `keccak256` of this is the beneficiary the
   * splitter actually pays, so the label and the key cannot disagree. Anyone can check it.
   */
  identity: string
  /** Display text as typed. ⚠ Never used to decide who gets paid. */
  handle: string
}

export type Entry = {
  token: Address
  curve: Address
  splitter: Address
  creator: Address
  pairToken: Address
  launchedAt: bigint
  socialBps: number
  recipientCount: number
}

export type Launch = Entry & {
  name: string
  symbol: string
  logo: string
  recipients: Recipient[]
  pairSymbol: string
  pairDecimals: number
  /**
   * What the splitter has credited to recipients, in the pair asset's own units.
   *
   * ⚠⚠ NOT "what the launch earned". Fees sit on the curve — or, after graduation, in the meme
   * hook — until somebody sweeps. This is money that has moved, which is the only kind worth
   * printing next to somebody's name.
   */
  shared: bigint
  /** Of that, what recipients have already taken out. */
  claimedOut: bigint
  /** Swept into the escrow, or held by the splitter, and not yet credited. */
  pending: bigint
  /**
   * ⭐⭐ WHAT THE LAUNCH HAS ACTUALLY EARNED FOR ITS RECIPIENTS — `shared + pending`.
   *
   * ⛔⛔ THIS EXISTS BECAUSE "0 ETH shared" WAS A LIE ON A TOKEN HOLDING 0.93 ETH. Fees reach
   * recipients in TWO hops: a sweep moves them into Pons's escrow under the splitter's name, and
   * `harvest()` then divides them into the vault. `shared` only counts the second hop, so between
   * the two — which can be hours, because harvest is permissionless and nobody is obliged to run
   * it — a launch earning real money reports zero, on its card and in the site total.
   *
   * ⚠ Both halves are already the recipients' money. The escrow balance is credited to the
   * splitter, which has no owner and no way to send it anywhere else. The only difference is
   * whether it has been divided yet.
   * ⛔ It does NOT include fees still unswept on the curve or in the hook — that money is real but
   * nobody has moved it, and the token page shows it separately as "Not swept yet".
   */
  earned: bigint
  /**
   * `shared`, in USD, scaled by 1e6. ⛔ **Null when the asset cannot be priced**, never zero.
   *
   * ⚠⚠ THE ONLY FIGURE TWO LAUNCHES CAN BE COMPARED ON. Fees are denominated in whatever the launch
   * was paired against, so a total across the site adds ETH to USDG to GME unless it is converted
   * first — and a launch whose pair asset has no readable pool contributes NOTHING rather than a
   * zero, with the count of what was left out shown beside the total.
   */
  sharedUsd: bigint | null
  /** `earned` in USD, scaled by 1e6. ⛔ Null when the asset cannot be priced, never zero. */
  earnedUsd: bigint | null
  /**
   * ⛔⛔ 0 on the curve · 1 swept but the pool is NOT seeded · 2 trading in the pool.
   *
   * Taken from the factory record, not from `curve.graduated()` — that call returns a bool and
   * phases 1 and 2 both answer true, though only one of them is a token anybody can trade. A card
   * badged "Graduated" on a phase-1 launch invites a click through to something that does not
   * trade and cannot earn. @see PHASE
   */
  phase: number
  /** ⚠ `phase >= 1`, for copy only. ⛔ Never branch pricing or a sweep on this. */
  graduated: boolean
  /**
   * Market cap in USD, scaled by 1e6. ⛔ **Null when it cannot be known**, never zero.
   *
   * Null while a launch sits between graduating and its pool existing: graduating drains the curve,
   * so pricing off it would report a live token as worthless.
   */
  marketCapUsd: bigint | null
}

/* ── reads ─────────────────────────────────────────────────────────────────────────────────── */

export async function readFactoryState() {
  const f = { address: PONS_FACTORY, abi: FACTORY_ABI } as const
  const [enabled, fee, maxTax] = await Promise.all([
    publicClient.readContract({ ...f, functionName: 'launchEnabled' }),
    publicClient.readContract({ ...f, functionName: 'launchFee' }),
    publicClient.readContract({ ...f, functionName: 'maxCreatorTaxBps' }),
  ])
  return { enabled: enabled as boolean, fee: fee as bigint, maxTax: Number(maxTax) }
}

export const previewEconomics = (pairToken: Address) =>
  publicClient.readContract({
    address: PONS_FACTORY,
    abi: FACTORY_ABI,
    functionName: 'previewLaunchEconomics',
    args: [LAUNCH_CONFIG_ID, pairToken],
  }) as Promise<Hex>

export async function readMinSocialBps(): Promise<number> {
  /* ⚠ The fallback has to match what `contracts/deploy.sh` will actually deploy, or the form
     enforces a rule the chain does not have (or worse, permits one it does). Zero since 4 Sep 2026.
     ⭐ Once deployed this is read from the contract, so a launchpad deployed WITH a floor still
     shows and enforces it — the check below is not dead, it is driven by the chain. */
  if (!isLive()) return 0
  return Number(
    await publicClient.readContract({ address: LAUNCHPAD as Address, abi: LAUNCHPAD_ABI, functionName: 'minSocialBps' }),
  )
}

/**
 * ⛔⛔ HOW MANY LAUNCHES ARE READ PER CALL — A REQUEST SIZE, NOT A CAP ON THE REGISTER.
 *
 * A sibling project shipped this as a single `page(0, 24)` and the register outgrew it. Launch 25
 * onward stopped existing as far as the site was concerned, including the launchpad's largest token,
 * which appeared on no dashboard at all while its own page rendered it fine. `count()` decides how
 * many there are and every page is fetched.
 */
export const PAGE_SIZE = 50

/**
 * How many launches the register holds, or `null` if the chain could not be asked.
 *
 * ⛔⛔ NULL RATHER THAN 0 ON FAILURE, AND THAT DISTINCTION IS THE WHOLE POINT OF THIS FUNCTION.
 * The first-launch gate treats 0 as "nobody has launched, keep the gate up" and null as "unknown,
 * fail closed" — collapsing them would mean an unreachable RPC reads as a definite empty register.
 * `readLaunches` returns `[]` for both cases quite correctly, which is why the gate cannot use it.
 * @see lib/launchGate.ts
 */
export async function readLaunchCount(): Promise<number | null> {
  if (!isLive()) return null
  try {
    return Number(
      await publicClient.readContract({ address: LAUNCHPAD as Address, abi: LAUNCHPAD_ABI, functionName: 'count' }),
    )
  } catch {
    return null
  }
}

export async function readLaunches(): Promise<Launch[]> {
  if (!isLive()) return []

  const total = Number(
    await publicClient.readContract({ address: LAUNCHPAD as Address, abi: LAUNCHPAD_ABI, functionName: 'count' }),
  )
  if (total === 0) return []

  const offsets: number[] = []
  for (let o = 0; o < total; o += PAGE_SIZE) offsets.push(o)

  /* ⭐ Entries and recipients are fetched as PARALLEL PAGES with the same bounds, so a launch's split
     never has to be fetched per row. Every call in this tick is multicall-batched into one request. */
  const [entryPages, recipientPages] = await Promise.all([
    Promise.all(
      offsets.map(
        (o) =>
          publicClient.readContract({
            address: LAUNCHPAD as Address,
            abi: LAUNCHPAD_ABI,
            functionName: 'page',
            args: [BigInt(o), BigInt(PAGE_SIZE)],
          }) as Promise<readonly Entry[]>,
      ),
    ),
    Promise.all(
      offsets.map(
        (o) =>
          publicClient.readContract({
            address: LAUNCHPAD as Address,
            abi: LAUNCHPAD_ABI,
            functionName: 'recipientsPage',
            args: [BigInt(o), BigInt(PAGE_SIZE)],
          }) as Promise<readonly (readonly RawRecipient[])[]>,
      ),
    ),
  ])

  const entries = entryPages.flat()
  const recipients = recipientPages.flat()

  /* ⭐ Once for the whole feed, not once per graduated row. @see hydrate */
  const hook = await publicClient
    .readContract({ address: PONS_FACTORY, abi: FACTORY_ABI, functionName: 'memeHook' })
    .catch(() => null)

  return Promise.all(entries.map((e, i) => hydrate(e, recipients[i] ?? [], (hook as Address | null) ?? null)))
}

type RawRecipient = { platform: number; bps: number; wallet: Address; identity: string; handle: string }

export const toRecipient = (r: RawRecipient): Recipient => ({
  platform: platformFromIndex(Number(r.platform)),
  bps: Number(r.bps),
  wallet: r.wallet,
  identity: r.identity,
  handle: r.handle,
})

/**
 * ⚠ `memeHook` is the same address for every launch on the site, so it is read ONCE per feed and
 * handed down. It used to be fetched inside each graduated row — a wasted round trip per card
 * against a public RPC that rate limits, on the very rows that already cost the most reads.
 */
async function hydrate(e: Entry, raw: readonly RawRecipient[], hook: Address | null): Promise<Launch> {
  const pair = pairBy(e.pairToken)
  const pairDecimals = pair?.decimals ?? 18

  const [name, symbol, logo, decimals, totalSupply, shared, claimedOut, pending, launched, reserves] = await Promise.all([
    publicClient.readContract({ address: e.token, abi: ERC20_ABI, functionName: 'name' }).catch(() => 'Unknown'),
    publicClient.readContract({ address: e.token, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => '???'),
    publicClient.readContract({ address: e.token, abi: ERC20_ABI, functionName: 'logo' }).catch(() => ''),
    /* ⛔ READ, NOT ASSUMED 18. The graduated branch below used a hard-coded 18 for the token while
       reading the pair's decimals properly, so a launch of any other precision priced orders of
       magnitude out — silently, as a plausible number rather than an obvious break. */
    publicClient.readContract({ address: e.token, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18),
    publicClient.readContract({ address: e.token, abi: ERC20_ABI, functionName: 'totalSupply' }).catch(() => 0n),
    claimsLive()
      ? publicClient
          .readContract({ address: CLAIMS as Address, abi: CLAIMS_ABI, functionName: 'creditedForLaunch', args: [e.token, e.pairToken] })
          .catch(() => 0n)
      : Promise.resolve(0n),
    claimsLive()
      ? publicClient
          .readContract({ address: CLAIMS as Address, abi: CLAIMS_ABI, functionName: 'claimedForLaunch', args: [e.token, e.pairToken] })
          .catch(() => 0n)
      : Promise.resolve(0n),
    publicClient
      .readContract({ address: e.splitter, abi: SPLITTER_ABI, functionName: 'pending', args: [e.pairToken] })
      .catch(() => 0n),
    /* ⭐ The factory record, in the SAME batch rather than behind a later `if`. It carries the
       phase, the pool fee and the tick spacing, so the graduated branch no longer needs a second
       sequential round trip before it can price anything. */
    publicClient
      .readContract({ address: PONS_FACTORY, abi: FACTORY_ABI, functionName: 'getLaunchedToken', args: [e.token] })
      .catch(() => null),
    publicClient.readContract({ address: e.curve, abi: CURVE_ABI, functionName: 'getReserves' }).catch(() => null),
  ])

  /* ⛔⛔ THE PHASE, NOT `curve.graduated()`. Phase 1 — swept off the curve, pool not yet seeded — is
     not a tradeable token, and a bool cannot say so. ⚠ Falls back to the curve's bool only when the
     factory record could not be read, so a bad RPC degrades rather than lying. */
  const curveGraduated = launched
    ? null
    : await publicClient.readContract({ address: e.curve, abi: CURVE_ABI, functionName: 'graduated' }).catch(() => false)
  const phase = launched ? Number(launched.phase) : curveGraduated ? PHASE.swept : PHASE.onCurve
  const dec = Number(decimals)

  /* ⚠ The USD rate is per pair ASSET, so it is fetched once per asset and cached, not once per
     launch. A dozen rows priced in ETH make one set of pool reads between them. */
  const usdPerUnit = await usdPerAsset(e.pairToken, pairDecimals)

  /*
    ⛔⛔ A GRADUATED TOKEN IS PRICED BY ITS POOL, NOT BY THE CURVE IT LEFT. Graduating drains the
    curve, so pricing off it is refusing to price — and refusing is only right if nothing else can.
  */
  let capInPair: bigint | null = null
  /* ⛔ ONLY PHASE 2 HAS A POOL TO PRICE FROM. At phase 1 the curve is drained and the pool does not
     exist yet, so both sources are wrong and `null` is the honest answer — the card renders an em
     dash, never "$0", because a zero there reports a live token as worthless. */
  if (phase === PHASE.inPool) {
    if (launched && hook) {
      const price = await poolPrice(
        e.token, e.pairToken, Number(launched.poolFee), Number(launched.tickSpacing), hook, dec, pairDecimals,
      )
      if (price !== null && (totalSupply as bigint) > 0n) {
        const whole = price * Number(formatUnits(totalSupply as bigint, dec))
        if (Number.isFinite(whole) && whole > 0) capInPair = BigInt(Math.round(whole * 10 ** pairDecimals))
      }
    }
  } else if (phase === PHASE.onCurve && reserves) {
    const [q, t] = reserves as readonly [bigint, bigint]
    capInPair = marketCapInPair({ quoteReserve: q, tokenReserve: t, totalSupply: totalSupply as bigint, graduated: false })
  }

  return {
    ...e,
    socialBps: Number(e.socialBps),
    recipientCount: Number(e.recipientCount),
    name: name as string,
    symbol: symbol as string,
    logo: logo as string,
    recipients: raw.map(toRecipient),
    pairSymbol: pair?.symbol ?? 'TOKEN',
    pairDecimals,
    shared: shared as bigint,
    earned: (shared as bigint) + (pending as bigint),
    claimedOut: claimedOut as bigint,
    pending: pending as bigint,
    sharedUsd: capUsdScaled(shared as bigint, pairDecimals, usdPerUnit),
    earnedUsd: capUsdScaled((shared as bigint) + (pending as bigint), pairDecimals, usdPerUnit),
    phase,
    graduated: phase >= PHASE.swept,
    marketCapUsd: capUsdScaled(capInPair, pairDecimals, usdPerUnit),
  }
}

export const NATIVE_ADDRESS = NATIVE
