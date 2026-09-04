/**
 * The hero's worked example has to be a split the chain would actually accept.
 *
 * ⛔⛔ `ShareLaunchpad._validate` reverts `BadSplit` unless the basis points sum to EXACTLY 10000,
 * and the hero renders through the same `SplitBar`/`SplitLegend` the real launches use. A demo that
 * does not add up is a picture of a launch that could not exist, drawn from percentages the contract
 * would reject — the one place on the site where being wrong is a claim about the product.
 *
 * ⚠ Read as TEXT rather than imported. `Hero.tsx` is JSX, and this suite is plain `node --test` with
 * no build step, so importing it is not an option. Parsing the literal is the trade that keeps the
 * invariant checked at all.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/components/Hero.tsx', import.meta.url), 'utf8')

test('the hero demo split sums to exactly 10000 bps', () => {
  const block = src.match(/const DEMO = \[([\s\S]*?)\n\]/)
  assert.ok(block, 'could not find the DEMO array in Hero.tsx — has it been renamed?')

  const bps = [...block[1].matchAll(/bps:\s*(\d+)/g)].map((m) => Number(m[1]))
  assert.ok(bps.length >= 2, 'expected at least two recipients in the demo')

  const total = bps.reduce((t, n) => t + n, 0)
  assert.equal(total, 10_000, `the demo split sums to ${total}, not 10000 — the chain would revert BadSplit`)
})

test('every demo recipient has a non-zero share', () => {
  const block = src.match(/const DEMO = \[([\s\S]*?)\n\]/)
  const bps = [...block[1].matchAll(/bps:\s*(\d+)/g)].map((m) => Number(m[1]))
  // ⚠ `_validate` reverts BadSplit(0) on a zero share, so a 0% row is not a harmless placeholder.
  for (const n of bps) assert.ok(n > 0, 'a demo recipient has a zero share')
})

test('the demo does not exceed the contract cap of 8 recipients', () => {
  const block = src.match(/const DEMO = \[([\s\S]*?)\n\]/)
  const rows = [...block[1].matchAll(/platform:\s*'/g)].length
  assert.ok(rows <= 8, `the demo has ${rows} recipients; ShareLaunchpad.MAX_RECIPIENTS is 8`)
})
