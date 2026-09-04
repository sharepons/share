/**
 * Verifies, against LIVE Robinhood Chain, the graduated-pool facts SHARE is about to depend on.
 * Read-only: eth_call and eth_estimateGas only, no key, no transaction.
 */
import { createPublicClient, http, parseAbi, keccak256, encodeAbiParameters } from 'viem'

const RPC = 'https://rpc.mainnet.chain.robinhood.com'
const FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e'
const CHARITY = '0x030FA758daD53f0D6e23cfD3a8Fe7bC7B54E5Ac9'
const CHARITY_FEE_RECIPIENT = '0xB4308041' // prefix only; resolved from the factory record below

const client = createPublicClient({ transport: http(RPC) })

const FACTORY_ABI = parseAbi([
  'function getLaunchedToken(address token) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))',
  'function memeHook() view returns (address)',
])
const HOOK_ABI = parseAbi([
  'function launches(bytes32 poolId) view returns (bool registered, bool memecoinIsCurrency0, address memecoin, address quoteToken, address creator, address buybackCreatorRecipient, address protocolFeeRecipient, uint16 creatorTaxBps, uint16 protocolFeeShareBps, uint16 buybackBurnBps, uint16 hookFeeBps, uint16 maxInternalPriceImpactBps, bool buybackEnabled)',
  'function pendingFees(bytes32 poolId, address currency) view returns (uint256)',
  'function pendingCreatorTax(bytes32 poolId, address currency) view returns (uint256)',
  'function pendingBuyback(bytes32 poolId, address currency) view returns (uint256)',
  'function sweepPoolFees(bytes32 poolId, uint256 minConversionQuoteOut, uint256 minBuybackTokensOut)',
])

function poolIdFor(token, pairToken, poolFee, tickSpacing, hook) {
  const [c0, c1] =
    pairToken.toLowerCase() < token.toLowerCase() ? [pairToken, token] : [token, pairToken]
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [c0, c1, poolFee, tickSpacing, hook],
    ),
  )
}

function revertData(e) {
  const seen = new Set()
  let cur = e
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur)
    const d = cur.data
    if (typeof d === 'string' && d.startsWith('0x')) return d.toLowerCase()
    if (d && typeof d === 'object' && typeof d.data === 'string') return d.data.toLowerCase()
    cur = cur.cause
  }
  return ''
}

const SELECTORS = {
  '0x8d42130c': 'NotFeeSweepOperator()',
  '0x31cdb504': 'InternalSwapRequiresOperator()',
  '0x3672d25f': 'MinimumOutputRequired() / zero-min guard',
}

async function trySweep(hook, poolId, caller, minConv, minBuy) {
  try {
    await client.simulateContract({
      address: hook,
      abi: HOOK_ABI,
      functionName: 'sweepPoolFees',
      args: [poolId, minConv, minBuy],
      account: caller,
    })
    return 'OK (would succeed)'
  } catch (e) {
    const d = revertData(e)
    const sel = d.slice(0, 10)
    return `${sel || 'no data'}  ${SELECTORS[sel] ?? (e.shortMessage ?? '').slice(0, 70)}`
  }
}

const rec = await client.readContract({
  address: FACTORY, abi: FACTORY_ABI, functionName: 'getLaunchedToken', args: [CHARITY],
})
const hook = await client.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: 'memeHook' })

console.log('\n$CHARITY factory record')
console.log('  phase           ', Number(rec.phase), '  (0 curve · 1 swept, pool not seeded · 2 in the pool)')
console.log('  pairToken       ', rec.pairToken)
console.log('  poolFee         ', Number(rec.poolFee), ' tickSpacing', Number(rec.tickSpacing))
console.log('  creatorTaxBps   ', Number(rec.creatorTaxBps), ' buybackEnabled', rec.buybackEnabled)
console.log('  feeRecipient    ', rec.creatorFeeRecipient)
console.log('  memeHook        ', hook)

const derived = poolIdFor(CHARITY, rec.pairToken, Number(rec.poolFee), Number(rec.tickSpacing), hook)
const KNOWN = '0x6956ad626704d890e90601e4a7497e6b6a34220ef4016795f3f8031449fb5303'
console.log('\npool id')
console.log('  derived         ', derived)
console.log('  known golden    ', KNOWN)
console.log('  MATCH           ', derived.toLowerCase() === KNOWN.toLowerCase())

const info = await client.readContract({ address: hook, abi: HOOK_ABI, functionName: 'launches', args: [derived] })
console.log('\nhook.launches(derived)')
console.log('  registered      ', info[0])
console.log('  memecoin        ', info[2], info[2].toLowerCase() === CHARITY.toLowerCase() ? '(matches)' : '(MISMATCH)')
console.log('  quoteToken      ', info[3])
console.log('  protocolFeeShareBps', Number(info[8]), ' creatorTaxBps', Number(info[7]))

// ⚠ A deliberately WRONG id, to confirm the failure mode is a silent zero rather than a revert.
const wrong = poolIdFor(CHARITY, rec.pairToken, Number(rec.poolFee) + 1, Number(rec.tickSpacing), hook)
const wrongInfo = await client.readContract({ address: hook, abi: HOOK_ABI, functionName: 'launches', args: [wrong] })
const wrongFees = await client.readContract({ address: hook, abi: HOOK_ABI, functionName: 'pendingFees', args: [wrong, rec.pairToken] })
console.log('\na WRONG pool id')
console.log('  launches().registered', wrongInfo[0])
console.log('  pendingFees          ', wrongFees, '  <- returns zero, does NOT revert')

const [qFee, qTax, qBuy, mFee, mTax, mBuy] = await Promise.all([
  client.readContract({ address: hook, abi: HOOK_ABI, functionName: 'pendingFees', args: [derived, rec.pairToken] }),
  client.readContract({ address: hook, abi: HOOK_ABI, functionName: 'pendingCreatorTax', args: [derived, rec.pairToken] }),
  client.readContract({ address: hook, abi: HOOK_ABI, functionName: 'pendingBuyback', args: [derived, rec.pairToken] }),
  client.readContract({ address: hook, abi: HOOK_ABI, functionName: 'pendingFees', args: [derived, CHARITY] }),
  client.readContract({ address: hook, abi: HOOK_ABI, functionName: 'pendingCreatorTax', args: [derived, CHARITY] }),
  client.readContract({ address: hook, abi: HOOK_ABI, functionName: 'pendingBuyback', args: [derived, CHARITY] }),
])
console.log('\npending in the hook')
console.log('  quote leg  fee', qFee, 'tax', qTax, 'buyback', qBuy)
console.log('  meme  leg  fee', mFee, 'tax', mTax, 'buyback', mBuy)

const feeRecipient = rec.creatorFeeRecipient
const stranger = '0x000000000000000000000000000000000000dEaD'
console.log('\nsweepPoolFees simulations (minConversionQuoteOut, minBuybackTokensOut)')
const operator = '0x49BbF2b70955Fb3a106e084D4BFDa92d334573d2'
for (const [label, caller] of [['fee recipient', feeRecipient], ['a stranger', stranger], ['pons operator', operator]]) {
  for (const [mc, mb] of [[0n, 0n], [1n, 0n], [1n, 1n], [10n ** 15n, 0n]]) {
    console.log(`  ${label.padEnd(14)} (${String(mc).padEnd(16)}, ${mb})  ->  ${await trySweep(hook, derived, caller, mc, mb)}`)
  }
}
console.log('')
