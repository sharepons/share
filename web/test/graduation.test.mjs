/**
 * The graduated-launch path, pinned to values read off the LIVE chain.
 *
 * ⛔⛔ WHY THESE ARE GOLDEN VALUES AND NOT COMPUTED ONES. After a Pons launch graduates, its fees
 * stop accruing on the curve and start accruing in the meme hook, under a Uniswap V4 pool id that
 * has no registry to look it up in — the id is REPRODUCED from the pool key. And `pendingFees` on an
 * id that does not exist returns **zero rather than reverting**, so a derivation that is subtly
 * wrong reports "no fees" and is indistinguishable from the truth.
 *
 * ➤ So the derivation is pinned to a pool that really exists, whose id was read back from
 *   `hook.launches()` on 4 Sep 2026 and confirmed registered and naming that exact memecoin.
 *   `npm run verify:graduation` re-reads every number below from the chain.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { poolIdOf } from '../src/lib/pool.ts'
import { PHASE, splitCreatorShare, isOperatorOnly, isMinimumOutputRequired } from '../src/lib/unswept.ts'

/* A REAL graduated Pons V2 launch on Robinhood Chain — a sibling project's token, used here purely
   as a fixture because it is the only graduated pool this stack has verified end to end. */
const CHARITY = '0x030FA758daD53f0D6e23cfD3a8Fe7bC7B54E5Ac9'
const NATIVE = '0x0000000000000000000000000000000000000000'
const MEME_HOOK = '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044'
const POOL_FEE = 0
const TICK_SPACING = 200
/** ⭐ Read back from `hook.launches(poolId)`: registered true, memecoin $CHARITY. */
const GOLDEN_POOL_ID = '0x6956ad626704d890e90601e4a7497e6b6a34220ef4016795f3f8031449fb5303'

test('the pool id derivation reproduces a real live pool', () => {
  assert.equal(poolIdOf(CHARITY, NATIVE, POOL_FEE, TICK_SPACING, MEME_HOOK), GOLDEN_POOL_ID)
})

test('native is always currency0, whichever order the arguments arrive in', () => {
  // ⚠ The key is sorted, so swapping the arguments must not change the id.
  assert.equal(poolIdOf(NATIVE, CHARITY, POOL_FEE, TICK_SPACING, MEME_HOOK), GOLDEN_POOL_ID)
})

test('every part of the pool key changes the id', () => {
  // ⛔ Each of these produced an unregistered pool whose pendingFees read a confident ZERO.
  assert.notEqual(poolIdOf(CHARITY, NATIVE, POOL_FEE + 1, TICK_SPACING, MEME_HOOK), GOLDEN_POOL_ID)
  assert.notEqual(poolIdOf(CHARITY, NATIVE, POOL_FEE, TICK_SPACING + 1, MEME_HOOK), GOLDEN_POOL_ID)
  assert.notEqual(poolIdOf(CHARITY, NATIVE, POOL_FEE, TICK_SPACING, CHARITY), GOLDEN_POOL_ID)
})

test('the three phases are distinct, and graduated is not a boolean', () => {
  assert.equal(PHASE.onCurve, 0)
  assert.equal(PHASE.swept, 1)
  assert.equal(PHASE.inPool, 2)
})

/* ── what a sweep would actually credit ──────────────────────────────────────────────────────── */

test('the creator tax is NOT split with Pons', () => {
  // ⛔ Reading only the plain fee under-reports a taxed launch by more than half. Live numbers from
  // $CHARITY's pool: fee and tax were equal, at 0.0178 ETH each, with protocolFeeShareBps 3000.
  const fee = 17_800_058_552_437_024n
  const tax = 17_800_058_552_437_024n
  const share = splitCreatorShare(fee, tax, 0n, 3000)

  /* ⛔ SUBTRACT PONS'S CUT — do not multiply by the remainder. `fee - fee*3000/10000` and
     `fee*7000/10000` are NOT the same number: integer division floors, so the second silently loses
     a wei whenever the cut does not divide evenly, and that wei belongs to the creator. Only the
     subtraction conserves the total, which is what the hook itself does. */
  const protocolCut = (fee * 3000n) / 10_000n
  assert.equal(share, fee - protocolCut + tax)
  assert.equal(share - tax + protocolCut, fee, 'the split must conserve the fee exactly')
  assert.equal(share - (fee * 7000n) / 10_000n - tax, 1n, 'the lossy formula is short by exactly a wei here')

  // ⚠ And it is strictly more than the fee alone, which is what the naive version would have shown.
  assert.ok(share > fee - protocolCut)
})

test('a pending buyback comes out of the creator bucket, and cannot go negative', () => {
  assert.equal(splitCreatorShare(1000n, 0n, 300n, 0), 700n)
  // ⛔ Clamped: a buyback larger than the bucket would otherwise render as a nonsense figure.
  assert.equal(splitCreatorShare(1000n, 50n, 5000n, 0), 50n)
})

test('protocolFeeShareBps is clamped rather than trusted', () => {
  assert.equal(splitCreatorShare(1000n, 0n, 0n, 10_000), 0n)
  assert.equal(splitCreatorShare(1000n, 0n, 0n, 99_999), 0n)
  assert.equal(splitCreatorShare(1000n, 0n, 0n, -5), 1000n)
})

test('nothing pending is zero, not a fraction of nothing', () => {
  assert.equal(splitCreatorShare(0n, 0n, 0n, 3000), 0n)
})

/* ── classifying the revert ──────────────────────────────────────────────────────────────────── */

/**
 * ⛔⛔ THE SELECTORS ARE THE WHOLE POINT. viem renders an unknown custom error as bare hex with no
 * name, so the previous code — `/revert/i.test(message)` — classified the single most likely failure
 * on a graduated launch as "there is nothing to move". That is the sentence a sibling project showed
 * a recipient who had 0.5 ETH waiting.
 *
 * All three were reproduced against the live hook on 4 Sep 2026: a stranger gets
 * NotFeeSweepOperator, the fee recipient gets InternalSwapRequiresOperator, and Pons's own operator
 * gets MinimumOutputRequired when `minConversionQuoteOut` is zero.
 */
test('InternalSwapRequiresOperator is recognised, however deeply it is nested', () => {
  assert.ok(isOperatorOnly({ data: '0x31cdb504' }))
  assert.ok(isOperatorOnly({ cause: { cause: { data: '0x31cdb504' } } }))
  // ⚠ viem sometimes wraps the payload one level further down again.
  assert.ok(isOperatorOnly({ cause: { data: { data: '0x31cdb504' } } }))
})

test('NotFeeSweepOperator is recognised too', () => {
  assert.ok(isOperatorOnly({ cause: { data: '0x8d42130c' } }))
})

test('an ordinary revert is NOT reported as operator-only', () => {
  // ⛔ The regression that matters: a real "nothing to sweep" must keep its own message.
  assert.equal(isOperatorOnly(new Error('execution reverted')), false)
  assert.equal(isOperatorOnly({ data: '0xdeadbeef' }), false)
  assert.equal(isOperatorOnly(null), false)
  assert.equal(isOperatorOnly(undefined), false)
})

test('a message merely CONTAINING the selector text is not enough', () => {
  // ⚠ It is matched on the revert DATA, never on prose that happens to quote a selector.
  assert.equal(isOperatorOnly(new Error('failed with 0x31cdb504 somewhere')), false)
})

test('the zero-minimum guard is a different failure from the operator gate', () => {
  assert.ok(isMinimumOutputRequired({ data: '0x3672d25f' }))
  assert.equal(isOperatorOnly({ data: '0x3672d25f' }), false)
  assert.equal(isMinimumOutputRequired({ data: '0x31cdb504' }), false)
})

test('a cyclic error object does not hang the classifier', () => {
  // ⚠ viem error chains can be self-referential; this used to be an infinite loop waiting to happen.
  const e = { data: 'not hex' }
  e.cause = e
  assert.equal(isOperatorOnly(e), false)
})

/* ── one definition of the lifecycle, not three ──────────────────────────────────────────────── */

/**
 * ⛔⛔ `PHASE` HAS EXACTLY ONE DEFINITION AND EVERY MODULE RE-EXPORTS IT.
 *
 * It lives in `pool.ts` because the feed (`launchpad.ts`) and the fee reader (`unswept.ts`) both
 * branch on it, and `unswept.ts` already imports `launchpad.ts` for the factory address — so
 * declaring it in either one makes those two import each other. That cycle works right up until a
 * bundler hoists the wrong half and one of them reads `undefined` at module scope, which is a blank
 * page with no error. A second copy of these three numbers is the other way it breaks: they drift,
 * and a launch is priced as though it were trading when it is not.
 */
test('PHASE is one object, re-exported, never redeclared', async () => {
  const fromPool = (await import('../src/lib/pool.ts')).PHASE
  const fromUnswept = (await import('../src/lib/unswept.ts')).PHASE
  assert.equal(fromPool, fromUnswept, 'unswept.ts must re-export pool.ts’s PHASE, not declare its own')
})

test('pool.ts imports nothing that imports it back', async () => {
  // ⚠ The cycle guard, stated as a test rather than as a comment nobody re-reads.
  const src = await import('node:fs').then((fs) => fs.readFileSync('src/lib/pool.ts', 'utf8'))
  const imports = [...src.matchAll(/from '\.\/([a-z]+)\.ts'/g)].map((m) => m[1])
  assert.deepEqual(imports.sort(), ['chain'], 'pool.ts may only depend on chain.ts')
})
