import type { Launch } from '../lib/launchpad.ts'
import { isLive } from '../lib/launchpad.ts'
import { LAUNCH } from '../lib/router.ts'
import { Link } from './Link.tsx'
import { TokenCard, TokenCardSkeleton } from './TokenCard.tsx'

export function Launches({ launches, loading }: { launches: Launch[]; loading: boolean }) {
  return (
    <section className="section section--tight">
      <div className="wrap">
        <div className="head head--center">
          <h2>Recently launched</h2>
        </div>

        {loading ? (
          <div className="grid grid--3">
            <TokenCardSkeleton />
            <TokenCardSkeleton />
            <TokenCardSkeleton />
          </div>
        ) : launches.length === 0 ? (
          <div className="empty">
            <h3>{isLive() ? 'Nothing launched yet' : 'No tokens have been deployed yet'}</h3>
            {/* ⚠ Only the live branch carries a second line now. Rendered conditionally rather than
                as an empty string — an empty <p> keeps its margin and leaves a gap under the heading
                that reads as text which failed to load. */}
            {isLive() && <p>The first launch on this launchpad has not happened. It could be yours.</p>}
            {isLive() && <Link to={LAUNCH} className="btn btn--primary">Launch the first one</Link>}
          </div>
        ) : (
          <div className="grid grid--3">
            {launches.slice(0, 6).map((l) => (
              <TokenCard key={l.token} launch={l} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
