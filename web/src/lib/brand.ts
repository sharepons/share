/**
 * What this site knows about itself.
 *
 * ✅ THE DOMAIN AND THE MARK ARRIVED 4 Sep 2026 — `sharepons.family`, and an inflated glass S in
 * pale sage. Both are set in `.env.production`; `public/logo.png` and `public/og.png` exist.
 *
 * ⛔ THE DEGRADING STAYS. Every getter below still falls back rather than inventing a value, and
 * that is not now-dead code: these same builders run with an empty env in tests and in any future
 * rebrand, and the failure they prevent is permanent. A guessed domain reaches an og:url, a token's
 * `socials.website`, and a launch's metadata, which has NO SETTER on Pons V2.
 *
 * ⚠⚠ og:image MUST be absolute. A relative one renders a blank card on X and every og validator
 * still passes, because they check that the tag exists. That has shipped here before.
 * ⚠ The X and GitHub handles are still unregistered, so those stay empty — see below.
 */
declare const process: { env?: Record<string, string | undefined> } | undefined

export const ENV =
  (import.meta as { env?: Record<string, string | undefined> }).env ??
  (typeof process !== 'undefined' ? process?.env : undefined)

export const SITE_NAME = 'SHARE'
export const TAGLINE = 'Share the fees'

/** ⚠ Read it through `absolute()`, never directly into a tag — it is empty in tests and in dev. */
export const SITE_URL = (ENV?.VITE_SITE_URL ?? '').replace(/\/+$/, '')
export const hasSiteUrl = () => /^https?:\/\/[^/]+$/.test(SITE_URL)

/** An absolute URL when the domain is known, and the path unchanged when it is not. */
export const absolute = (path: string) => (hasSiteUrl() ? `${SITE_URL}${path}` : path)

/** ⚠ Empty strings, not placeholder handles. An unregistered handle in a `twitter:site` tag is a
 *  link to nothing, and on a token's `socials` it is written on chain with no setter. */
export const X_URL = ENV?.VITE_X_URL ?? ''
export const GITHUB_URL = ENV?.VITE_GITHUB_URL ?? ''

/**
 * This site's own token, shown as a copyable strip under the hero.
 *
 * ⛔ `CA: TBA` until the token exists, and never a sentence about the build. The site does not
 * narrate its own construction status to visitors: it states the address, and where there is none it
 * says so in the shortest form that is still true.
 */
export const TOKEN_CA = (ENV?.VITE_TOKEN_CA ?? '').trim()
export const hasTokenCa = () => /^0x[0-9a-fA-F]{40}$/.test(TOKEN_CA)

/** ⚠ The image needs a DEEP ground and the drawn fallback needs a pale one. @see components/Mark.tsx */
export const HAS_LOGO = (ENV?.VITE_HAS_LOGO ?? '') === '1'
