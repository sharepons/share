/**
 * The cache in front of paid handle lookups.
 *
 * ⛔⛔ THE TEST THAT MATTERS IS THE ONE ABOUT NOT CACHING FOR LONG. A handle→id mapping becomes
 * `keccak256("x:<id>")` in a launch's split, on chain, with no setter — so an entry that outlives a
 * rename names the wrong person permanently, and nobody finds out until the person it was meant for
 * is told they are owed nothing. Minutes, never days.
 */
import { strict as assert } from 'node:assert'
import { test, beforeEach } from 'node:test'

import { cacheLookup, cachedLookup, clearLookupCache, lookupCacheSize } from '../src/lookupCache.ts'
import type { Identity } from '../src/identity.ts'

const jane: Identity = { platform: 'x', id: '1465280448', handle: 'jane', name: 'Jane', avatar: null }

beforeEach(() => clearLookupCache())

test('a hit is returned without asking again', () => {
  assert.equal(cachedLookup('x', 'jane'), undefined, 'must start cold')
  cacheLookup('x', 'jane', jane)
  assert.deepEqual(cachedLookup('x', 'jane')?.identity, jane)
})

test('the handle is matched case- and whitespace-insensitively', () => {
  // ⚠ Somebody retyping the same handle in a different case is asking the same question.
  cacheLookup('x', 'Jane', jane)
  assert.deepEqual(cachedLookup('x', '  jANe ')?.identity, jane)
})

test('platforms do not collide', () => {
  cacheLookup('x', 'jane', jane)
  assert.equal(cachedLookup('github', 'jane'), undefined)
})

/**
 * ⛔⛔ THREE STATES, NOT TWO. `undefined` is "not cached, go and ask". `{identity: null}` is "we
 * asked recently and there is no such account". Collapsing them makes a cached miss look like a
 * cache miss — paying for the lookup this exists to avoid — or, far worse, makes "not cached" read
 * as "no such account" and tells somebody their colleague does not exist.
 */
test('a cached miss is distinguishable from not being cached', () => {
  assert.equal(cachedLookup('x', 'nobody'), undefined)
  cacheLookup('x', 'nobody', null)
  const hit = cachedLookup('x', 'nobody')
  assert.notEqual(hit, undefined, 'a cached miss must be a hit on the cache')
  assert.equal(hit?.identity, null)
})

test('the cache is bounded, so user input cannot grow it without limit', () => {
  for (let i = 0; i < 800; i++) cacheLookup('x', `handle${i}`, { ...jane, id: String(i) })
  assert.ok(lookupCacheSize() <= 500, `size was ${lookupCacheSize()}`)
  // ⚠ And it evicted the OLDEST, so the most recent lookups are the ones still served.
  assert.notEqual(cachedLookup('x', 'handle799'), undefined)
  assert.equal(cachedLookup('x', 'handle0'), undefined)
})

test('re-caching a handle refreshes it rather than duplicating it', () => {
  cacheLookup('x', 'jane', jane)
  const before = lookupCacheSize()
  cacheLookup('x', 'jane', { ...jane, name: 'Jane Renamed' })
  assert.equal(lookupCacheSize(), before)
  assert.equal(cachedLookup('x', 'jane')?.identity?.name, 'Jane Renamed')
})

test('clearing empties it — a restart must not serve stale ids', () => {
  cacheLookup('x', 'jane', jane)
  clearLookupCache()
  assert.equal(cachedLookup('x', 'jane'), undefined)
  assert.equal(lookupCacheSize(), 0)
})
