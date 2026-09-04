import { SITE_NAME, X_URL } from '../lib/brand.ts'
import { EXPLORE, HOME, HOW, LAUNCH, type Route } from '../lib/router.ts'
import { XIcon } from './Icons.tsx'
import { Link } from './Link.tsx'
import { Mark } from './Mark.tsx'
import { useWallet } from '../lib/wallet.tsx'
import { ProfileMenu } from './ProfileMenu.tsx'

/**
 * ⭐ Underlined tabs sitting ON the header's bottom rule, rather than a segmented pill track. The
 * header edge does the work a second container would otherwise have to, and the active tab extends
 * the rule instead of floating above it.
 */
/*
 * ⭐ CLAIMING IS NOT IN HERE, ON PURPOSE. What a launch owes you is bound to an ACCOUNT, so the page
 * means nothing to a visitor who has not identified themselves — a top-level tab that is blank for
 * almost everybody reads as a broken page. It lives in the profile menu instead, beside the identity
 * it depends on. @see components/ProfileMenu.tsx
 */
const ITEMS = [
  { href: LAUNCH, label: 'Launch', on: (r: Route) => r.name === 'launch' },
  { href: EXPLORE, label: 'Explore', on: (r: Route) => r.name === 'explore' || r.name === 'token' },
  { href: HOW, label: 'How it works', on: (r: Route) => r.name === 'how' },
] as const

export function Header({ route }: { route: Route }) {
  const { openPicker } = useWallet()
  return (
    <header className="hdr">
      <div className="hdr__in">
        {/* ⛔ THE MARK ALONE — no wordmark beside it. The logo IS the letter S, so setting "SHARE"
            next to it repeats the same glyph twice at two sizes in two styles, which is what made
            the header read as clunky. The <title>, the og tags and the footer carry the name. */}
        <Link className="hdr__brand" to={HOME} aria-label={SITE_NAME}>
          <Mark />
        </Link>

        <nav className="hdr__nav scroller" aria-label="Sections">
          {ITEMS.map((it) => {
            const on = it.on(route)
            return (
              <Link key={it.href} to={it.href} className={`tab${on ? ' is-on' : ''}`} aria-current={on ? 'page' : undefined}>
                {it.label}
              </Link>
            )
          })}
        </nav>

        <div className="hdr__right">
          {/* ⛔ Rendered only when a handle exists. An unregistered handle in the header is a link
              to nothing, and on this stack that has shipped before. @see lib/brand.ts */}
          {X_URL && (
            <a className="hdr__icon" href={X_URL} target="_blank" rel="noreferrer noopener" aria-label={`${SITE_NAME} on X`}>
              <XIcon />
            </a>
          )}
          <ProfileMenu onOpenPicker={openPicker} route={route} />
        </div>
      </div>
    </header>
  )
}
