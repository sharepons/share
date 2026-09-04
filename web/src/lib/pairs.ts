import type { Address } from 'viem'

/**
 * The assets a Pons V2 launch can be priced in.
 *
 * ⭐⭐ EVERY ONE OF THEM WORKS HERE, AND THAT IS NOT TRUE OF EVERY LAUNCHPAD ON THIS CHAIN. A
 * launchpad that has to move money OFF Robinhood Chain is limited to what a bridge carries — native
 * ETH and USDG — and has to sell the other twenty-one into USDG first, which costs a swap and fails
 * outright for a stock with no liquid pool.
 *
 * SHARE pays its recipients ON this chain, in whatever the launch was paired against. A launch
 * paired against GME pays its recipients in GME. So there is no bridge, no seller, no blocked asset
 * and no conversion slippage anywhere in the path.
 *
 * ⛔⛔ THE PAIR ASSET IS FIXED AT LAUNCH, FOREVER. It decides what every recipient is paid in for the
 * life of the token, and Pons ships no way to change it.
 */
export type PairAsset = {
  address: Address
  symbol: string
  decimals: number
  /** ⚠ Shown on the launch form. A thin pool is a real thing to know before pricing a token in it. */
  note?: string
}

export const NATIVE = '0x0000000000000000000000000000000000000000' as Address
export const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as Address

export const PAIR_ASSETS: PairAsset[] = [
  { address: NATIVE, symbol: 'ETH', decimals: 18, note: 'The default. Fees arrive as ether.' },
  { address: USDG, symbol: 'USDG', decimals: 6, note: 'A dollar-denominated share. ⚠ Six decimals, not eighteen.' },
  { address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', symbol: 'AAPL', decimals: 18 },
  { address: '0x86923f96303D656E4aa86D9d42D1e57ad2023fdC', symbol: 'AMD', decimals: 18 },
  { address: '0x12f190a9F9d7D37a250758b26824B97CE941bF54', symbol: 'AMZN', decimals: 18 },
  { address: '0x6330D8C3178a418788dF01a47479c0ce7CCF450b', symbol: 'COIN', decimals: 18 },
  { address: '0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2', symbol: 'COST', decimals: 18 },
  { address: '0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5', symbol: 'CRCL', decimals: 18 },
  { address: '0x1D11f0496982706C5e14A514D4E79F2e6BdE4516', symbol: 'DJT', decimals: 18 },
  { address: '0x1b0E319c6A659F002271B69dB8A7df2F911c153E', symbol: 'GME', decimals: 18, note: 'A thin pool. Fine to be paid in; harder to sell in size.' },
  { address: '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3', symbol: 'GOOGL', decimals: 18 },
  { address: '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35', symbol: 'META', decimals: 18 },
  { address: '0xe93237C50D904957Cf27E7B1133b510C669c2e74', symbol: 'MSFT', decimals: 18 },
  { address: '0xec262a75e413fAfD0dF80480274532C79D42da09', symbol: 'MSTR', decimals: 18, note: '⚠ No liquid pool on this chain today. A recipient paid in MSTR cannot readily sell it.' },
  { address: '0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD', symbol: 'MU', decimals: 18 },
  { address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', symbol: 'NVDA', decimals: 18 },
  { address: '0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A', symbol: 'PLTR', decimals: 18 },
  { address: '0xD5f3879160bc7c32ebb4dC785F8a4F505888de68', symbol: 'QQQ', decimals: 18 },
  { address: '0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C', symbol: 'RDDT', decimals: 18 },
  { address: '0xB90A19fF0Af67f7779afF50A882A9CfF42446400', symbol: 'SNDK', decimals: 18 },
  { address: '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa', symbol: 'SPCX', decimals: 18 },
  { address: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C', symbol: 'SPY', decimals: 18 },
  { address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d', symbol: 'TSLA', decimals: 18 },
  { address: '0x5e81213613b6B86EaB4c6c50d718d34359459786', symbol: 'TTWO', decimals: 18 },
]

export const pairBy = (a: string) => PAIR_ASSETS.find((p) => p.address.toLowerCase() === a.toLowerCase())
export const pairSymbol = (a: string) => pairBy(a)?.symbol ?? 'TOKEN'
export const pairDecimals = (a: string) => pairBy(a)?.decimals ?? 18
