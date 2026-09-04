import { formatUsd } from '../lib/marketCap.ts'
import { amount } from '../lib/format.ts'
import { PHASE } from '../lib/pool.ts'
import { resolveImage } from '../lib/logo.ts'
import type { Launch } from '../lib/launchpad.ts'
import { tokenHref } from '../lib/router.ts'
import { Link } from './Link.tsx'
import { SplitBar, SplitLegend } from './SplitBar.tsx'

/**
 * One launch in a feed.
 *
 * ## The order is the order somebody actually reads a token in
 *
 * Picture, ticker, name, market cap. A token is recognised by its art before its name and by its
 * name before its numbers, so the card is built in that order and the market cap is the one figure
 * set large.
 *
 * ⭐ THE SPLIT BAR SITS UNDER THE IMAGE, flush to both edges, as the rule between the picture and
 * the numbers. That bar is the product — no other launchpad's card has one — and putting it where a
 * divider would go means it costs no vertical space while still being the thing that makes a wall
 * of these recognisably SHARE's.
 *
 * ⚠⚠ "SHARED" IS MONEY THAT HAS MOVED, never what the launch has earned. Fees sit on the curve —
 * or in the meme hook after graduation — until somebody sweeps, and a figure that counted those
 * would be a promise dressed as a receipt.
 */
export function TokenCard({ launch }: { launch: Launch }) {
  const img = resolveImage(launch.logo)
  const segments = launch.recipients.map((r) => ({
    platform: r.platform,
    handle: r.handle,
    wallet: r.wallet,
    bps: r.bps,
  }))

  return (
    <Link to={tokenHref(launch.token)} className="card">
      <div className="card__media">
        {img ? (
          <img src={img} alt="" loading="lazy" />
        ) : (
          /* ⛔ Not a loading state. `logo` is set in the token's constructor and Pons V2 ships no
             setter, so a launch made without one never gets one. */
          <span aria-hidden="true">{launch.symbol.slice(0, 3).toUpperCase()}</span>
        )}
        {/* ⛔ TWO DIFFERENT STATES, AND ONE OF THEM IS NOT A TRADEABLE TOKEN. Phase 1 is swept off
            the curve with no pool seeded yet: it does not trade and cannot earn, so badging it
            "Graduated" invites a click through to a dead page. The label names what is true. */}
        {launch.phase === PHASE.swept && <span className="card__badge">Pool pending</span>}
        {launch.phase === PHASE.inPool && <span className="card__badge">Graduated</span>}
      </div>

      <SplitBar segments={segments} size="sm" />

      <div className="card__body">
        <div className="card__sym trunc">${launch.symbol}</div>
        <div className="card__name trunc" title={launch.name}>{launch.name}</div>

        <div className="card__cap">
          {/* ⛔ An em dash, never "$0". `marketCapUsd` is null when it CANNOT be known — between
              graduating and the pool existing, or when the pair asset has no readable pool — and a
              zero there reports a live token as worthless. */}
          <b>{formatUsd(launch.marketCapUsd) ?? '—'}</b>
          <span>Market cap</span>
        </div>

        <div className="card__shared">
          {amount(launch.shared, launch.pairDecimals)} {launch.pairSymbol} shared
        </div>

        <div className="card__who">
          <hr className="card__rule" />
          {/* ⚠ Capped at three rows plus a count. A launch with eight recipients would otherwise
              make one card four times the height of its neighbours and break the grid. */}
          <SplitLegend segments={segments.slice(0, 3)} compact />
          {segments.length > 3 && (
            <div className="small faint" style={{ marginTop: 4 }}>and {segments.length - 3} more</div>
          )}
        </div>
      </div>
    </Link>
  )
}

export function TokenCardSkeleton() {
  return (
    <div className="card" aria-hidden="true">
      {/* ⚠ Same aspect ratio as the real media, or the grid jumps when the data lands. */}
      <div className="card__media" />
      <div className="splitbar splitbar--thin" />
      <div className="card__body">
        <span className="skeleton" style={{ height: 10, width: '35%' }} />
        <span className="skeleton" style={{ height: 14, width: '70%', marginTop: 6 }} />
        <span className="skeleton" style={{ height: 20, width: '55%', marginTop: 10 }} />
        <span className="skeleton" style={{ height: 34, marginTop: 14 }} />
      </div>
    </div>
  )
}
