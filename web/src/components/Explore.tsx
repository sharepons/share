import { useMemo, useState } from 'react'
import type { Launch } from '../lib/launchpad.ts'
import { isPreview } from '../lib/preview.ts'
import { isLive } from '../lib/launchpad.ts'
import { SOCIALS, type Platform } from '../lib/platforms.ts'
import { LAUNCH } from '../lib/router.ts'
import { Link } from './Link.tsx'
import { PlatformIcon } from './Icons.tsx'
import { TokenCard, TokenCardSkeleton } from './TokenCard.tsx'

type Sort = 'new' | 'old' | 'cap'

const SORTS: { id: Sort; label: string }[] = [
  { id: 'new', label: 'Newest' },
  { id: 'old', label: 'Oldest' },
  { id: 'cap', label: 'Market cap' },
]

export function Explore({ launches, loading }: { launches: Launch[]; loading: boolean }) {
  const [sort, setSort] = useState<Sort>('new')
  const [platform, setPlatform] = useState<Platform | 'all'>('all')

  const rows = useMemo(() => {
    const filtered =
      platform === 'all' ? launches : launches.filter((l) => l.recipients.some((r) => r.platform === platform))

    const copy = [...filtered]
    /* ⚠ `launchedAt` is a bigint, so the SUBTRACTION happens before Number() — coercing each side
       first loses precision on a uint64 timestamp. 'old' is the same shape, reversed. */
    if (sort === 'new') copy.sort((a, b) => Number(b.launchedAt - a.launchedAt))
    if (sort === 'old') copy.sort((a, b) => Number(a.launchedAt - b.launchedAt))
    /* ⛔ Sorted on the USD figure, never on the raw balance. Two launches paired against different
       assets have incomparable raw numbers, and sorting on them puts a launch that earned 40 GME
       above one that earned 3 ETH. ⚠ A launch that cannot be priced sorts LAST rather than as zero. */
    if (sort === 'cap') copy.sort((a, b) => cmp(a.marketCapUsd, b.marketCapUsd))
    return copy
  }, [launches, sort, platform])

  /* The second line of the empty state, or nothing.
     ⚠ Only two of the three empty states have something worth adding. The not-deployed one says all
     it needs to in its heading, so this is null there rather than an empty string — see the render. */
  const emptyNote = !isLive()
    ? null
    : launches.length > 0
      ? 'Clear the filter to see the rest.'
      : 'The first launch has not happened.'

  return (
    <section className="section">
      <div className="wrap">
        <div className="head head--center">
          <h2>Explore</h2>
          <p className="lede">Every token launched on our platform.</p>
        </div>

        {/* ⛔ Travels with the screenshot. Anything below is invented — see lib/preview.ts. */}
        {isPreview() && (
          <div className="note note--warn" style={{ marginBottom: 18 }}>
            <strong>Preview.</strong> This token is fabricated for design review and does not exist
            on chain. Drop <code>?preview</code> from the URL to read the real register.
          </div>
        )}

        {/* ⚠ Filters in one row above the results, and the result count is stated. A filter that
            silently empties a grid reads as a broken page. */}
        <div className="spread row--wrap" style={{ marginBottom: 18, gap: 12 }}>
          <div className="row row--wrap" style={{ gap: 6 }}>
            <button className={`btn btn--sm${platform === 'all' ? ' btn--primary' : ' btn--ghost'}`} onClick={() => setPlatform('all')}>
              All
            </button>
            {SOCIALS.map((p) => (
              <button
                key={p}
                className={`btn btn--sm${platform === p ? ' btn--primary' : ' btn--ghost'}`}
                onClick={() => setPlatform(p)}
              >
                <span className="pmark"><PlatformIcon platform={p} /></span>
                {p === 'x' ? 'X' : p === 'github' ? 'GitHub' : p === 'instagram' ? 'Instagram' : 'TikTok'}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 6 }}>
            {SORTS.map((s) => (
              <button
                key={s.id}
                className={`btn btn--sm${sort === s.id ? '' : ' btn--ghost'}`}
                onClick={() => setSort(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="grid grid--3">
            <TokenCardSkeleton />
            <TokenCardSkeleton />
            <TokenCardSkeleton />
            <TokenCardSkeleton />
            <TokenCardSkeleton />
            <TokenCardSkeleton />
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <h3>
              {!isLive()
                ? 'No tokens have been deployed yet'
                : launches.length === 0
                  ? 'Nothing launched yet'
                  : 'No launch names one of those'}
            </h3>
            {/* ⚠ Rendered only when there is something to say. The not-deployed state now carries no
                second line, and an empty <p> would still take its margin — a gap under the heading
                that reads as text that failed to load. */}
            {emptyNote && <p>{emptyNote}</p>}
            {isLive() && launches.length === 0 && <Link to={LAUNCH} className="btn btn--primary">Launch the first one</Link>}
          </div>
        ) : (
          <>
            <div className="grid grid--3">
              {rows.map((l) => (
                <TokenCard key={l.token} launch={l} />
              ))}
            </div>
            <p className="small faint" style={{ marginTop: 18 }}>
              {rows.length} of {launches.length} launches
            </p>
          </>
        )}
      </div>
    </section>
  )
}

/** ⚠ Null sorts last, not as zero: "cannot be priced" is not "worth nothing". */
function cmp(a: bigint | null, b: bigint | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b > a ? 1 : b < a ? -1 : 0
}
