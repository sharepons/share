import { PLATFORM_META, type Platform } from '../lib/platforms.ts'
import { PlatformIcon } from './Icons.tsx'

/**
 * Somebody's face, or the closest thing available.
 *
 * ⚠ There is often no picture, and that is normal rather than an error state: a launch can name an
 * account that has never been here, and Instagram will not hand over a profile picture for a
 * sign-in-scoped token at all. Initials are the designed answer, not a fallback.
 *
 * ⭐ The platform tint is a 2px ring and nothing else. As a fill behind text, four of the five
 * platform colours fail contrast on this ground.
 */
export function Avatar({
  platform,
  handle,
  src,
  size = 'md',
}: {
  platform: Platform
  handle: string
  src?: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const cls = size === 'lg' ? ' av--lg' : size === 'sm' ? ' av--sm' : ''
  const initials = (handle.replace(/^@/, '').slice(0, 2) || '?').toUpperCase()
  return (
    <span className={`av${cls}`} style={{ borderColor: PLATFORM_META[platform].tint + '55' }}>
      {src ? <img src={src} alt="" loading="lazy" /> : initials}
      {size !== 'sm' && (
        <span className="av__badge" aria-hidden="true">
          <PlatformIcon platform={platform} />
        </span>
      )}
    </span>
  )
}
