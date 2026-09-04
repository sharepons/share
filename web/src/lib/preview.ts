import type { Address } from 'viem'
import { keccak256, toBytes } from 'viem'
import { PHASE } from './unswept.ts'
import type { Launch } from './launchpad.ts'
import type { TokenView } from './token.ts'

/*
 * A fabricated launch, for looking at the card design before anything is deployed.
 *
 * ⛔⛔⛔ THIS IS NOT REAL AND MUST NEVER RENDER FOR SOMEBODY WHO DID NOT ASK FOR IT.
 *
 * Every number below is invented. On a launchpad, a token that appears to exist and does not is the
 * worst possible bug: somebody can buy the wrong contract address on the strength of it. So it is
 * behind an explicit `?preview` in the URL — never a build flag, never a fallback for "the chain is
 * empty", and never on by default in development either, because a dev session is where a
 * screenshot gets taken.
 *
 *   http://localhost:5235/explore?preview
 *
 * ⚠ `Explore` also draws a banner whenever this is on, so a screenshot of the page carries the
 * disclaimer with it.
 *
 * ➤ Delete this file once a real launch exists. It has no other purpose.
 */
export function isPreview(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('preview')
}

/**
 * ⚠ Not real tokens. Unmistakable, but still VALID HEX.
 *
 * ⛔ The first attempt spelled `0xPREV1EW…`, which is not hex, so `parsePath` refused the route and
 * clicking the preview card silently fell through to the home page — the router behaving exactly as
 * designed while looking like a broken link.
 * ⛔⛔ AND IT MUST BE LOWERCASE. viem's `isAddress` validates the EIP-55 CHECKSUM on any address that
 * carries mixed case, so a nicely capitalised `0xFACADE…FACADE` fails too, in exactly the same
 * silent way. All-lowercase is checksum-exempt. Anything standing in for an address has to survive
 * `isAddress` or it is not standing in for an address.
 */
const FAKE = '0x0000000000000000000000000000000000000000' as Address
const PREVIEW_TOKEN = '0xfacade0000000000000000000000000000facade' as Address

export function previewLaunches(): Launch[] {
  /* ⚠ Absolute, because `resolveImage` refuses relative paths — putting an unvalidated string into
     an `src` is how a token's metadata becomes a way to load something nobody chose. */
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  return [
    {
      token: PREVIEW_TOKEN,
      curve: FAKE,
      splitter: FAKE,
      creator: FAKE,
      pairToken: FAKE,
      launchedAt: BigInt(Math.floor(Date.now() / 1000) - 60 * 60 * 26),
      socialBps: 9200,
      recipientCount: 5,

      name: 'Share Pons',
      symbol: 'SHARE',
      logo: `${origin}/logo.png`,
      pairSymbol: 'ETH',
      pairDecimals: 18,

      recipients: [
        { platform: 'github', bps: 4000, wallet: FAKE, identity: 'github:583231', handle: 'sharepons' },
        { platform: 'x', bps: 2500, wallet: FAKE, identity: 'x:44196397', handle: 'sharepons' },
        { platform: 'instagram', bps: 1500, wallet: FAKE, identity: 'instagram:@sharepons', handle: 'sharepons' },
        { platform: 'tiktok', bps: 1200, wallet: FAKE, identity: 'tiktok:@sharepons', handle: 'sharepons' },
        { platform: 'wallet', bps: 800, wallet: '0x4d8Bd0aA1F1B4B0e0000000000000000000748d1' as Address, identity: 'wallet:0x4d8bd0aa1f1b4b0e0000000000000000000748d1', handle: '' },
      ],

      shared: 2_140_000_000_000_000_000n,
      claimedOut: 900_000_000_000_000_000n,
      pending: 130_000_000_000_000_000n,
      /** ⚠ USD figures are scaled by 1e6 throughout, not 1e18. */
      sharedUsd: 7_620_000_000n,
      phase: PHASE.onCurve,
      graduated: false,
      marketCapUsd: 148_400_000_000n,
    },
  ]
}

/**
 * The same fabricated launch, in the shape the token page reads.
 *
 * ⚠ Derived from `previewLaunches()` rather than typed out twice — two hand-written copies of the
 * same token drift, and the first symptom is a card and its own page disagreeing about the split.
 */
export function previewToken(): TokenView {
  const l = previewLaunches()[0]!
  return {
    address: l.token,
    name: l.name,
    symbol: l.symbol,
    decimals: 18,
    totalSupply: 1_000_000_000n * 10n ** 18n,
    logo: l.logo,
    description: 'A preview token. Every number on this page is invented so the layout can be reviewed before anything is deployed.',

    splitter: l.splitter,
    creator: l.creator,
    launchedAt: l.launchedAt,
    socialBps: l.socialBps,
    /* ⭐ The beneficiary is hashed from the identity string, the same way the contract does it, so
       even the preview cannot show a label that disagrees with the key beside it. */
    recipients: l.recipients.map((r, i) => ({
      ...r,
      beneficiary: keccak256(toBytes(r.identity)),
      credited: (l.shared * BigInt(r.bps)) / 10_000n,
      /* ⚠ Two of five have taken theirs out; the rest show a real "never signed in" zero. */
      claimed: i < 2 ? (l.shared * BigInt(r.bps)) / 20_000n : 0n,
    })),

    pairToken: l.pairToken,
    pairSymbol: l.pairSymbol,
    pairDecimals: l.pairDecimals,
    curve: l.curve,
    creatorTaxBps: 0,
    phase: PHASE.onCurve,
    graduated: l.graduated,

    /* ⭐ A non-zero unswept figure ON PURPOSE. The preview exists to review the layout before
       anything is deployed, and the case worth reviewing is the one where the escrow reads zero
       while real money waits a hop upstream — a preview showing zeroes there would look identical
       to the bug this panel was built to make visible. */
    unswept: {
      where: 'curve',
      phase: PHASE.onCurve,
      curve: l.curve,
      pool: null,
      creatorShare: 41_000_000_000_000_000n,
      memePending: 0n,
      weMaySweep: true,
    },

    hook: null,
    poolId: null,

    price: 0.000148,
    marketCapUsd: l.marketCapUsd,

    shared: l.shared,
    claimedOut: l.claimedOut,
    pending: l.pending,
  }
}
