import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { getAddress } from 'viem'

import { PAIR_ASSETS, NATIVE, pairBy } from '../src/lib/pairs.ts'

/**
 * ⛔⛔ EVERY ADDRESS IS CHECKSUM-VERIFIED HERE. A mistyped pair asset is a launch priced against a
 * contract that does not exist, and Pons's revert names the address rather than the mistake.
 */
test('every pair address is a valid checksummed address', () => {
  for (const p of PAIR_ASSETS) {
    assert.equal(getAddress(p.address), p.address, `${p.symbol} is not checksummed`)
  }
})

test('no address and no symbol appears twice', () => {
  const addresses = new Set()
  const symbols = new Set()
  for (const p of PAIR_ASSETS) {
    assert.ok(!addresses.has(p.address.toLowerCase()), `${p.symbol} duplicates an address`)
    assert.ok(!symbols.has(p.symbol), `${p.symbol} appears twice`)
    addresses.add(p.address.toLowerCase())
    symbols.add(p.symbol)
  }
})

/** ⛔ USDG is SIX decimals. Treated as eighteen, every figure denominated in it is a trillion times
 *  too small, and it renders as a plausible-looking zero rather than as an error. */
test('usdg is six decimals and everything else is eighteen', () => {
  for (const p of PAIR_ASSETS) {
    assert.equal(p.decimals, p.symbol === 'USDG' ? 6 : 18, `${p.symbol} has the wrong decimals`)
  }
})

test('the native pair is the zero address and resolves', () => {
  assert.equal(pairBy(NATIVE)?.symbol, 'ETH')
  assert.equal(pairBy('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'), undefined)
})
