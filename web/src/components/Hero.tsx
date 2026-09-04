import { useState } from 'react'
import { HAS_LOGO, TOKEN_CA, hasTokenCa } from '../lib/brand.ts'
import { formatUsd } from '../lib/marketCap.ts'
import { siteStats } from '../lib/stats.ts'
import type { Launch } from '../lib/launchpad.ts'
import { EXPLORE, LAUNCH } from '../lib/router.ts'
import { short } from '../lib/format.ts'
import { CopyIcon } from './Icons.tsx'
import { Link } from './Link.tsx'
import { SplitBar, SplitLegend } from './SplitBar.tsx'

/** ⭐ A worked example, not an illustration. It is the same component the real splits use, so what
 *  somebody sees here is exactly what a launch looks like. */
const DEMO = [
  { platform: 'github' as const, handle: 'sharepons', bps: 4000 },
  { platform: 'x' as const, handle: 'sharepons', bps: 2500 },
  { platform: 'instagram' as const, handle: 'sharepons', bps: 1500 },
  { platform: 'tiktok' as const, handle: 'sharepons', bps: 1200 },
  { platform: 'wallet' as const, handle: '', wallet: '0x4d8Bd0aA1F1B4B0e0000000000000000000748d1', bps: 800 },
]

/* ⛔⛔ THESE MUST SUM TO EXACTLY 10000, and it is not a styling detail. `ShareLaunchpad._validate`
   reverts `BadSplit` on anything else, so a demo that does not add up is a picture of a launch that
   could not exist — and this is the same component the real splits render through, so the bar would
   be drawn from percentages the chain would reject. Adding a row means taking the basis points off
   the others, never appending them. */
/* ⚠ Dev-only, and deliberately not a `throw`. This module is bundled but never EXECUTED by the
   build or the test run, so a thrown error here would not fail either — it would reach production
   and white-screen the home page. `test/demo-split.test.mjs` is the real gate; this is the fast
   signal while editing. */
if (import.meta.env?.DEV && DEMO.reduce((t, d) => t + d.bps, 0) !== 10_000) {
  console.error('[SHARE] the hero demo split does not sum to 10000 bps — the chain would reject it')
}

export function Hero({ launches, loading }: { launches: Launch[]; loading: boolean }) {
  const s = siteStats(launches)
  const [copied, setCopied] = useState(false)

  return (
    <section className="hero">
      <div className="wrap">
        <div className="hero__lead">
          {HAS_LOGO && (
            <div className="hero__mark">
              {/* ⚠ Decorative: the headline underneath already names the product, so an alt here
                  would make a screen reader announce it twice. */}
              <img src="/logo.png" alt="" />
            </div>
          )}
          <div>
            <p className="tag">Robinhood Chain · Pons V2</p>
            <h1>
              <span className="hl">Share the fees</span>
            </h1>
            <p className="hero__lede">
              Launch a token and share the token fees to an X account, GitHub user, Instagram or
              TikTok handle.
            </p>
            <div className="hero__cta">
              <Link to={LAUNCH} className="btn btn--primary btn--lg">Launch</Link>
              <Link to={EXPLORE} className="btn btn--lg">Explore</Link>
            </div>

            {/* ⛔ States the address, or says there is none. It never narrates the build. */}
            <div style={{ marginTop: 22, display: 'flex', justifyContent: 'center' }}>
              {hasTokenCa() ? (
                <button
                  className="ca"
                  onClick={() => {
                    void navigator.clipboard?.writeText(TOKEN_CA)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1400)
                  }}
                >
                  <CopyIcon />
                  {copied ? 'Copied' : `CA ${short(TOKEN_CA, 6)}`}
                </button>
              ) : (
                <span className="ca" style={{ cursor: 'default' }}>CA: TBA</span>
              )}
            </div>
          </div>

        </div>

        <div className="hero__demo">
          <div className="demo">
            <div className="demo__label">Split the fees</div>
            <SplitBar segments={DEMO} size="lg" />
            <div style={{ height: 16 }} />
            <SplitLegend segments={DEMO} compact />
          </div>
        </div>

        <div style={{ marginTop: 'clamp(32px, 5vw, 56px)' }}>
          <div className="stats">
            <div className="stat">
              <div className="stat__k">Launches</div>
              <div className="stat__v">{loading ? '—' : s.launches}</div>
            </div>
            <div className="stat">
              <div className="stat__k">Shared so far</div>
              <div className="stat__v">{loading ? '—' : (formatUsd(s.sharedUsd) ?? '—')}</div>
              {/* ⚠⚠ KEPT, and only when it has something to say. The bland "credited to recipients"
                  line is gone, but this branch is not decoration: a launch paired against an asset
                  with no readable pool cannot be converted to dollars, so the figure above is an
                  UNDERCOUNT. Dropping it would turn a disclosed gap into a silent one. */}
              {!loading && s.unpriced > 0 && (
                <div className="stat__n">
                  {s.unpriced} launch{s.unpriced === 1 ? '' : 'es'} not priced here
                </div>
              )}
            </div>
          </div>
          {/* ⚠ Centred under the tiles, not flush right. It was right-aligned against a full-width
              stats band; now that the band is capped at 760px and centred, a hard-right link sits
              200px past its edge and reads as belonging to nothing. */}
          <div className="row" style={{ marginTop: 16, justifyContent: 'center' }}>
            <Link to={EXPLORE} className="link small">See every launch →</Link>
          </div>
        </div>
      </div>
    </section>
  )
}
