import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { amount, pct, usd } from '../src/lib/format.ts'

/** ⛔ A real balance never renders as `0`. A recipient reads a zero as "there is nothing", and the
 *  difference between nothing and nearly nothing matters to them. */
test('a tiny balance is never rendered as zero', () => {
  assert.equal(amount(1n, 18), '<0.0001')
  assert.equal(amount(0n, 18), '0')
})

test('decimals are the assets own, not assumed to be eighteen', () => {
  // USDG is six. Reading it as eighteen is a figure a trillion times too small.
  assert.equal(amount(1_500_000n, 6), '1.5')
  assert.equal(amount(1_500_000n, 18), '<0.0001')
})

/** ⛔ Null is a dash, never `$0`. A missing figure beside a live token is a claim about it. */
test('an unknown dollar figure is a dash', () => {
  assert.equal(usd(null), '—')
  assert.equal(usd(0n), '$0')
})

test('bps read as percent', () => {
  assert.equal(pct(10_000), '100%')
  assert.equal(pct(3333), '33.33%')
  assert.equal(pct(0), '0%')
})
