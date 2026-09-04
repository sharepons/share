/**
 * A short-lived cache in front of paid handle lookups.
 *
 * ## Why it exists
 *
 * Every X lookup is billed — `$0.00015` minimum per request, even when nothing comes back — and a
 * launch form invites the same handle to be typed several times: a launcher edits a row, changes
 * their mind, adds a second recipient and comes back. Those are the same question within a minute
 * of each other, and there is no reason to pay for each one.
 *
 * ## ⛔⛔ AND WHY IT IS DELIBERATELY SHORT-LIVED, NOT LONG
 *
 * The obvious version caches a handle→id mapping for days, because an account id "never changes".
 * The id does not — but **the mapping does**. If `@jane` renames and somebody else registers
 * `jane`, then `jane` now points at a different account.
 *
 * That mapping does not merely label a payee here. It BECOMES one:
 *
 *     beneficiary = keccak256("x:" + id)
 *
 * written into a launch's split on chain, with no setter. A stale cache entry would name the wrong
 * person permanently, and nobody would discover it until the person it was meant for tried to claim
 * and was told they were owed nothing.
 *
 * ➤ So the TTL is measured in MINUTES — long enough to absorb one person filling in one form, far
 *   too short to outlive a rename. ⛔ Do not raise it to hours or days to "save money". The saving
 *   is a rounding error; the failure is unrecoverable.
 *
 * ⚠ Nothing here is persisted. A restart clears it, which is the safe direction.
 */
import type { Identity } from './identity.ts'

/** ⭐ Absorbs one person filling in one form. Nothing longer. @see the header. */
const HIT_TTL_MS = 10 * 60 * 1000

/**
 * ⚠ Much shorter than a hit. "No such account" is usually a half-typed handle, and somebody who
 * fixes their typo and retypes the original must not be told for ten minutes that it does not
 * exist — and a handle that gets registered a minute from now should resolve.
 */
const MISS_TTL_MS = 30 * 1000

/** ⛔ Bounded. An unbounded map keyed by user input is a way to run a server out of memory. */
const MAX_ENTRIES = 500

type Entry = { identity: Identity | null; at: number }

const entries = new Map<string, Entry>()

const keyOf = (platform: string, handle: string) => `${platform}:${handle.trim().toLowerCase()}`

const fresh = (e: Entry) => Date.now() - e.at < (e.identity ? HIT_TTL_MS : MISS_TTL_MS)

/**
 * ⚠⚠ THREE STATES, AND THE THIRD ONE IS THE POINT. `undefined` means "not cached, go and ask";
 * `{identity: null}` means "we asked recently and there is no such account". Collapsing them would
 * make a cached miss indistinguishable from a cache miss, and the caller would pay for the lookup
 * it was trying to avoid — or, worse, treat "not cached" as "no such account".
 */
export function cachedLookup(platform: string, handle: string): { identity: Identity | null } | undefined {
  const k = keyOf(platform, handle)
  const e = entries.get(k)
  if (!e) return undefined
  if (!fresh(e)) {
    entries.delete(k)
    return undefined
  }
  return { identity: e.identity }
}

export function cacheLookup(platform: string, handle: string, identity: Identity | null): void {
  /* ⚠ Oldest-first eviction, and cheap: Map preserves insertion order, so the first key is the
     oldest. Re-inserting an existing key would keep its old position, so it is deleted first. */
  const k = keyOf(platform, handle)
  entries.delete(k)
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value
    if (oldest !== undefined) entries.delete(oldest)
  }
  entries.set(k, { identity, at: Date.now() })
}

/** ⚠ For tests, and for anything that needs to prove a lookup really happened. */
export function clearLookupCache(): void {
  entries.clear()
}

export function lookupCacheSize(): number {
  return entries.size
}
