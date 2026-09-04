import { useEffect, useState, type MouseEvent } from 'react'
import { isAddress, type Address } from 'viem'

/**
 * Real paths, no hash.
 *
 * ⚠⚠ THIS ONLY WORKS BECAUSE THE WEB SERVER FALLS BACK TO index.html. `try_files {path} /index.html`
 * is what makes `/explore` load the app instead of 404ing, and it is not optional: without it every
 * link works inside the app and every REFRESH and every shared link is a 404. The deploy and this
 * file are a pair.
 */
export type Route =
  | { name: 'home' }
  | { name: 'launch' }
  | { name: 'explore' }
  | { name: 'claim' }
  | { name: 'mine' }
  | { name: 'how' }
  | { name: 'privacy' }
  | { name: 'terms' }
  | { name: 'data-deletion' }
  | { name: 'token'; address: Address }

export function parsePath(pathname: string): Route {
  const p = pathname.replace(/\/+$/, '') || '/'
  if (p === '/launch') return { name: 'launch' }
  if (p === '/explore') return { name: 'explore' }
  if (p === '/claim') return { name: 'claim' }
  if (p === '/my-tokens') return { name: 'mine' }
  if (p === '/how-it-works') return { name: 'how' }
  if (p === '/privacy') return { name: 'privacy' }
  if (p === '/terms') return { name: 'terms' }
  if (p === '/data-deletion') return { name: 'data-deletion' }
  if (p.startsWith('/token/')) {
    const a = p.slice('/token/'.length).split('/')[0] ?? ''
    /* ⚠ Validated here, not in the page. A malformed address would otherwise reach viem as a
       contract call and surface as an unreadable RPC error instead of "no such token". */
    if (isAddress(a)) return { name: 'token', address: a as Address }
  }
  return { name: 'home' }
}

export function navigate(to: string) {
  const [path, hash] = to.split('#')
  const target = path || location.pathname
  /* ⚠ `?preview` is CARRIED ACROSS in-app navigation. Without this, clicking a card in preview mode
     pushes a bare path, the flag is lost mid-journey, and the destination reads the real chain — so
     a fabricated card would link to a "token not found" page and look like a bug in the router.
     ⛔ Kept in the URL rather than in memory on purpose: the address bar always says whether what
     you are looking at is real. @see lib/preview.ts */
  const keep = new URLSearchParams(location.search).has('preview') ? '?preview' : ''
  if (target !== location.pathname) {
    history.pushState({}, '', hash ? `${target}${keep}#${hash}` : `${target}${keep}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
    if (hash) {
      /* ⚠⚠ Scrolled AFTER the render, not by the browser. Arriving at an anchor from another page,
         the section does not exist at the moment the browser would scroll to it, so the native jump
         silently does nothing and the visitor lands at the top of a page they navigated into the
         middle of. */
      requestAnimationFrame(() => {
        requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: 'start' }))
      })
    } else {
      window.scrollTo(0, 0)
    }
  } else if (hash) {
    document.getElementById(hash)?.scrollIntoView({ block: 'start' })
    history.replaceState({}, '', `${target}#${hash}`)
  }
}

/** ⚠ Modified clicks are left alone. Cmd-click, middle-click and shift-click are how people open
 *  things in a new tab, and swallowing them is the most common way an SPA router breaks a browser. */
export function onNavClick(to: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parsePath(location.pathname))
  useEffect(() => {
    const on = () => setRoute(parsePath(location.pathname))
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])

  /*
    ⛔⛔ ARRIVING AT A HASH URL DIRECTLY, WHICH THE BROWSER CANNOT DO FOR US.

    `navigate()` already scrolls after an in-app jump, but that does nothing for somebody who PASTES
    or reloads `/how-it-works#cannot`: the browser looks for the element at parse time, React has not
    rendered a single section yet, and it silently gives up — the visitor lands at the top of a page
    they were linked into the middle of. Every shared deep link was broken this way.

    ⚠ Two nested frames, not one: the first runs before paint, when the section still has no layout
    box to scroll to. ⚠ `scroll-margin-top` on the target keeps it clear of the sticky header.
  */
  useEffect(() => {
    const id = location.hash.slice(1)
    if (!id) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }))
    })
  }, [])

  return route
}

export const HOME = '/'
export const LAUNCH = '/launch'
export const EXPLORE = '/explore'
export const CLAIM = '/claim'
export const MINE = '/my-tokens'
export const HOW = '/how-it-works'
/* ⚠ All three are REAL routes, not anchors. Instagram's App Review asks for a privacy policy and a
   data-deletion URL that it can FETCH, and a `#privacy` fragment is served the home page and fails
   that check.
   ⛔ They are also the only routes prerendered to flat HTML for the gate root — add a fourth and it
   must go into `scripts/build-legal-static.mjs` too, or it 200s as the gate page. */
export const PRIVACY = '/privacy'
export const TERMS = '/terms'
/** ⚠ The exact string set as Meta's "Data deletion request URL". Renaming it breaks App Review. */
export const DATA_DELETION = '/data-deletion'
export const tokenHref = (a: string) => `/token/${a}`
