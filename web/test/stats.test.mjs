import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { people, siteStats } from '../src/lib/stats.ts'

const launch = (over = {}) => ({
  token: '0x1111111111111111111111111111111111111111',
  curve: '0x0000000000000000000000000000000000000000',
  splitter: '0x0000000000000000000000000000000000000000',
  creator: '0x0000000000000000000000000000000000000000',
  pairToken: '0x0000000000000000000000000000000000000000',
  launchedAt: 0n,
  socialBps: 10000,
  recipientCount: 1,
  name: 'A',
  symbol: 'A',
  logo: '',
  recipients: [{ platform: 'x', bps: 10000, wallet: '0x0000000000000000000000000000000000000000', identity: 'x:1', handle: 'one' }],
  pairSymbol: 'ETH',
  pairDecimals: 18,
  shared: 0n,
  claimedOut: 0n,
  pending: 0n,
  sharedUsd: null,
  graduated: false,
  marketCapUsd: null,
  ...over,
  /* ⚠ AFTER the spread, and derived, so a test that sets only `shared` still describes a launch
     with nothing pending — which is what those tests have always meant. A test that wants the
     swept-but-unharvested case sets `pending` and gets it folded in here. @see Launch.earned. */
  earned: (over.shared ?? 0n) + (over.pending ?? 0n),
  earnedUsd:
    over.earnedUsd !== undefined
      ? over.earnedUsd
      : over.sharedUsd === null || over.sharedUsd === undefined
        ? (over.sharedUsd ?? null)
        : over.sharedUsd,
})

/**
 * ⛔⛔ THE CHECK THIS FILE EXISTS FOR. A launch whose pair asset has no readable pool cannot be
 * converted to dollars, and folding it in as zero is a total that is quietly wrong. It is counted
 * instead, so the page can say what is missing from the figure.
 */
test('an unpriceable launch is counted, never folded in as zero', () => {
  const s = siteStats([
    launch({ shared: 5n, sharedUsd: 4_000_000n }),
    launch({ token: '0x2222222222222222222222222222222222222222', shared: 5n, sharedUsd: null }),
  ])
  assert.equal(s.sharedUsd, 4_000_000n)
  assert.equal(s.unpriced, 1)
})

test('a launch that has shared nothing is neither counted nor unpriced', () => {
  const s = siteStats([launch({ shared: 0n, sharedUsd: null })])
  assert.equal(s.sharedUsd, null)
  assert.equal(s.unpriced, 0)
})

/** ⛔ Keyed on the identity string, never the handle. A handle can change between two launches while
 *  the account stays the same, and two rows for one person is the bug the key exists to prevent. */
test('one account across two launches is one row, under its newest handle', () => {
  const rows = people([
    launch({ recipients: [{ platform: 'x', bps: 10000, wallet: '0x0', identity: 'x:1', handle: 'old' }] }),
    launch({
      token: '0x2222222222222222222222222222222222222222',
      recipients: [{ platform: 'x', bps: 10000, wallet: '0x0', identity: 'x:1', handle: 'new' }],
    }),
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].handle, 'new')
  assert.equal(rows[0].launches.length, 2)
})

test('a wallet recipient is not a person on the people page', () => {
  const rows = people([
    launch({ recipients: [{ platform: 'wallet', bps: 10000, wallet: '0xabc', identity: 'wallet:0xabc', handle: '' }] }),
  ])
  assert.equal(rows.length, 0)
})

/** ⚠ Their share of what the launch shared, not the whole of it. */
test('a persons credit is their share, not the launch total', () => {
  const rows = people([
    launch({
      shared: 100n,
      sharedUsd: 10_000_000n,
      recipients: [
        { platform: 'x', bps: 7000, wallet: '0x0', identity: 'x:1', handle: 'a' },
        { platform: 'github', bps: 3000, wallet: '0x0', identity: 'github:2', handle: 'b' },
      ],
    }),
  ])
  assert.equal(rows[0].sharedUsd, 7_000_000n)
  assert.equal(rows[1].sharedUsd, 3_000_000n)
})


/**
 * ⛔⛔ THE BUG THIS PINS: "0 ETH shared" ON A TOKEN HOLDING 0.93 ETH FOR ITS RECIPIENTS.
 *
 * Fees reach people in two hops — a sweep puts them in Pons's escrow under the splitter's name, and
 * `harvest()` divides them into the vault. The site counted only the second hop, so between the two
 * a launch earning real money reported zero on its card and in the site total. Harvest is
 * permissionless and nobody is obliged to run it, so that gap is not brief.
 */
test('⛔ fees that are SWEPT but not yet harvested still count as shared', () => {
  const s = siteStats([
    launch({ shared: 0n, pending: 930_000_000_000_000_000n, sharedUsd: 0n, earnedUsd: 3_300_000_000n }),
  ])
  assert.equal(s.sharedUsd, 3_300_000_000n, 'money in the escrow is the recipients money and must be counted')
  assert.equal(s.unpriced, 0)
})

test('a launch with nothing anywhere still counts as nothing', () => {
  const s = siteStats([launch({ shared: 0n, pending: 0n, sharedUsd: 0n, earnedUsd: 0n })])
  assert.equal(s.sharedUsd, null, 'no money at all must not fabricate a zero-dollar total')
  assert.equal(s.unpriced, 0)
})

test('⚠ a person is credited once their launch has earned, even before harvest', () => {
  const rows = people([
    launch({ shared: 0n, pending: 100n, sharedUsd: 0n, earnedUsd: 2_000_000n }),
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].sharedUsd, 2_000_000n, 'the sole recipient holds 100% of what was earned')
})
