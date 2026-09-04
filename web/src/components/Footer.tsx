import type { ReactNode } from 'react'
import { GITHUB_URL, SITE_NAME, X_URL } from '../lib/brand.ts'
import { PRIVACY, TERMS } from '../lib/router.ts'
import { GithubIcon, XIcon } from './Icons.tsx'
import { Link } from './Link.tsx'

/**
 * ⛔⛔ A SOCIAL BUTTON WITH NO URL IS NOT RENDERED AS A LINK.
 *
 * The X and GitHub handles are not registered yet, so `X_URL` / `GITHUB_URL` are empty. An `<a>`
 * with an empty or `#` href is a link to nothing: it looks live, it takes a click, and it goes
 * nowhere — and shipping exactly that has already happened on this stack.
 *
 * ➤ So the button is DRAWN either way, and only becomes a link once a URL exists. Set `VITE_X_URL`
 *   and `VITE_GITHUB_URL` in `web/.env.production` and these upgrade themselves with no code change.
 *
 * ⚠ `aria-disabled` plus the muted class, not the `disabled` attribute — an anchor cannot be
 * disabled, and a screen reader should hear that the control is inert rather than skip it.
 */
function Social({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  /* ⛔⛔ ICON ONLY, SO THE LABEL MOVES TO `aria-label` — IT DOES NOT DISAPPEAR. With the visible
     text gone these are unreadable to a screen reader without it, and the `title` is what tells a
     sighted visitor which one they are hovering. */
  if (!href) {
    return (
      <span
        className="social social--off"
        role="img"
        aria-label={`${label} — not linked yet`}
        title={`${label} — not linked yet`}
      >
        {children}
      </span>
    )
  }
  return (
    <a
      className="social"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`${SITE_NAME} on ${label}`}
      title={label}
    >
      {children}
    </a>
  )
}

export function Footer() {
  return (
    <footer className="ftr">
      {/* ⚠ ONE centred row, not two ends of a spread. Four small items pushed to opposite edges of a
          1240px page read as two unrelated groups; together in the middle they read as one signature. */}
      <div className="wrap ftr__in">
        <span className="ftr__copy">© 2026 Share Pons</span>
        {/* ⚠ `Link`, not `<a>` — an anchor here would reload the whole app to move between two
            pages it has already downloaded. @see components/Link.tsx */}
        <Link className="ftr__link" to={PRIVACY}>Privacy</Link>
        <Link className="ftr__link" to={TERMS}>Terms</Link>
        <Social href={X_URL} label="X">
          <XIcon />
        </Social>
        <Social href={GITHUB_URL} label="GitHub">
          <GithubIcon />
        </Social>
      </div>
    </footer>
  )
}
