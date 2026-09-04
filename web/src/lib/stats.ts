import type { Launch, Recipient } from './launchpad.ts'

/**
 * The figures on the home page, computed from the register the browser already has.
 *
 * ⛔⛔ A TOTAL ACROSS ASSETS IS A CONVERSION, AND WHAT CANNOT BE CONVERTED IS COUNTED, NOT DROPPED.
 * Fees are denominated in whatever a launch was paired against, so "shared so far" adds ETH to USDG
 * to GME unless each is priced first. A launch whose pair asset has no readable pool contributes
 * nothing to the total — and `unpriced` says how many did, so the page can show a figure that is
 * honestly incomplete rather than one that is quietly wrong.
 */
export type SiteStats = {
  launches: number
  /** USD, scaled by 1e6. ⛔ Null when nothing could be priced at all. */
  sharedUsd: bigint | null
  /** How many launches could not be priced and are therefore missing from the total. */
  unpriced: number
  /** Distinct social accounts named across every launch. ⚠ Named, not paid. */
  people: number
  /** Of those, how many have been credited something. */
  paid: number
}

export function siteStats(launches: Launch[]): SiteStats {
  let sharedUsd: bigint | null = null
  let unpriced = 0

  /* ⛔ `earned`, not `shared` — see the note on Launch.earned. "Shared so far" read zero across a
     site whose one launch was holding 0.93 ETH for its recipients, because the money had been
     swept but not yet harvested. Both halves are theirs; only the division is pending. */
  for (const l of launches) {
    if (l.earned === 0n) continue
    if (l.earnedUsd === null) {
      unpriced++
      continue
    }
    sharedUsd = (sharedUsd ?? 0n) + l.earnedUsd
  }

  const named = new Set<string>()
  const credited = new Set<string>()
  for (const l of launches) {
    for (const r of l.recipients) {
      if (r.platform === 'wallet') continue
      named.add(r.identity)
      /* ⚠ Approximated at the LAUNCH level, because a per-recipient credit is a read per row and
         this figure is a headline, not a receipt. A launch that has shared anything has credited
         every one of its recipients, since the splitter divides in one call. */
      if (l.earned > 0n) credited.add(r.identity)
    }
  }

  return { launches: launches.length, sharedUsd, unpriced, people: named.size, paid: credited.size }
}

export type PersonRow = {
  identity: string
  platform: Recipient['platform']
  handle: string
  launches: Launch[]
  /** USD, scaled by 1e6, across every launch that could be priced. ⛔ Null when none could. */
  sharedUsd: bigint | null
  unpriced: number
  /** The largest share this person holds anywhere, in bps. Used to sort ties. */
  topBps: number
}

/**
 * Everybody a launch has ever named, with what has actually reached them.
 *
 * ⭐ Keyed on `identity` — the canonical string the chain built — and never on the handle. Two rows
 * for one person is exactly the bug the key exists to prevent, and a handle can be renamed between
 * two launches while the account stays the same.
 */
export function people(launches: Launch[]): PersonRow[] {
  const rows = new Map<string, PersonRow>()

  for (const l of launches) {
    for (const r of l.recipients) {
      if (r.platform === 'wallet') continue
      const row = rows.get(r.identity) ?? {
        identity: r.identity,
        platform: r.platform,
        handle: r.handle,
        launches: [],
        sharedUsd: null,
        unpriced: 0,
        topBps: 0,
      }
      row.launches.push(l)
      row.topBps = Math.max(row.topBps, r.bps)
      /* ⚠ The handle shown is the one from the MOST RECENT launch that named them. An older launch
         carries whatever they were called then, and showing a stale name beside a live balance is
         how somebody decides the row is not theirs. */
      row.handle = r.handle

      if (l.earned > 0n) {
        if (l.earnedUsd === null) row.unpriced++
        else {
          /* ⚠ Their share of what the launch earned, not the whole of it. */
          row.sharedUsd = (row.sharedUsd ?? 0n) + (l.earnedUsd * BigInt(r.bps)) / 10_000n
        }
      }
      rows.set(r.identity, row)
    }
  }

  return [...rows.values()].sort((a, b) => {
    const av = a.sharedUsd ?? -1n
    const bv = b.sharedUsd ?? -1n
    if (av !== bv) return bv > av ? 1 : -1
    if (a.launches.length !== b.launches.length) return b.launches.length - a.launches.length
    return b.topBps - a.topBps
  })
}
