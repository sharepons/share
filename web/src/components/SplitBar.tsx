import { PLATFORM_META, displayName, type Platform } from '../lib/platforms.ts'
import { pct } from '../lib/format.ts'
import { PlatformIcon } from './Icons.tsx'

/**
 * The mark, and the only place on this site where colour multiplies.
 *
 * ⛔⛔ THE HUES ARE A FIXED ORDER AND ARE NEVER CYCLED. Slot n always takes hue n, so a recipient's
 * colour is a property of their POSITION IN THE SPLIT and not of how many recipients there happen to
 * be. A ninth cannot exist: the contract caps a launch at eight.
 *
 * ⚠ Colour is never the only thing carrying identity. Every segment has a 2px gap beside it and a
 * named row beneath it in the legend, which is what the palette check assumes when it passes an
 * adjacent pair at ΔE 8.4 under protanopia.
 */
export type Segment = {
  platform: Platform
  handle: string
  wallet?: string
  bps: number
}

export const SLOT = (i: number) => `s${Math.min(i, 7) + 1}`

export function SplitBar({ segments, size = 'md' }: { segments: Segment[]; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? ' splitbar--tall' : size === 'sm' ? ' splitbar--thin' : ''
  const total = segments.reduce((a, s) => a + s.bps, 0) || 1
  return (
    <div
      className={`splitbar${cls}`}
      role="img"
      /* ⛔ An EMPTY track when nothing is allocated, never a full-width first segment. On the launch
         form that placeholder read as "100% assigned to recipient one" while the total said 0%. */
      aria-label={segments.length === 0 ? 'nothing allocated yet' : segments.map((s) => `${label(s)} ${pct(s.bps)}`).join(', ')}
    >
      {segments.map((s, i) => (
        <div
          key={`${s.platform}:${s.handle}:${i}`}
          className={`splitbar__seg ${SLOT(i)}`}
          /* ⚠ Percent of the SUM, not of 10000. A half-filled launch form has to draw something
             sensible while the shares still add up to less than a whole. */
          style={{ width: `${(s.bps / total) * 100}%` }}
        />
      ))}
    </div>
  )
}

const label = (s: Segment) => displayName(s.platform, s.handle, s.wallet)

export function SplitLegend({ segments, compact = false }: { segments: Segment[]; compact?: boolean }) {
  return (
    <div className="legend">
      {segments.map((s, i) => (
        <div className="legend__row" key={`${s.platform}:${s.handle}:${i}`}>
          <i className={`swatch ${SLOT(i)}`} aria-hidden="true" />
          <span className="legend__who">
            <span className="pmark dim" aria-hidden="true"><PlatformIcon platform={s.platform} /></span>
            <span className="legend__name" title={label(s)}>{label(s)}</span>
            {!compact && s.platform !== 'wallet' && PLATFORM_META[s.platform].keyedBy === 'handle' && (
              /* ⚠ Said on every screen this appears on, not once in the docs. A share keyed by a
                 handle follows the NAME, and that is the recipient's risk to know about. */
              <span className="chip chip--warn" title="Instagram and TikTok publish no way to look up an account by name, so this share follows the handle rather than the account.">
                by name
              </span>
            )}
          </span>
          <span className="legend__bps">{pct(s.bps)}</span>
        </div>
      ))}
    </div>
  )
}
