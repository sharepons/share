/**
 * Renders /privacy and /terms to STANDALONE HTML for the gate root.
 *
 * ## ⛔⛔ WHY THIS EXISTS AT ALL
 *
 * While the site is gated, Caddy serves the gate page for every path — including `/privacy`. That
 * breaks Instagram App Review, which fetches the policy at a URL and gets a password wall.
 *
 * ⛔ AND THE OBVIOUS FIX IS WORSE THAN THE PROBLEM. Exempting `/privacy` from the gate would serve
 * the SPA's `index.html`, which pulls `/assets/index-*.js` — the entire application. Anybody could
 * then navigate client-side to any page, and the app reads the chain straight from the browser, so
 * only `/api/*` would still be shut. One exempted route opens the whole site.
 *
 * ➤ So these two pages are rendered to flat HTML carrying NO bundle, and served from the gate root
 *   where they are reachable without the cookie and lead nowhere else.
 *
 * ## ⭐⭐ THEY ARE GENERATED FROM `Legal.tsx`, NOT COPIED FROM IT
 *
 * A hand-written second copy of a privacy policy is a promise that goes stale the first time the
 * server changes and nobody remembers there were two of them. This bundles the real component and
 * renders it, so the static pages cannot say anything the app does not.
 * ⚠ Which means: run this AFTER `npm run build`, because it inlines the built stylesheet.
 *
 * ⚠ esbuild, not the app's Vite build: Node cannot import `.tsx`, and this needs the component as
 * a module rather than as part of a browser bundle. React is external — it is imported normally by
 * this script's own runtime.
 */
import { build } from 'esbuild'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const GATE = join(WEB, '..', 'gate')
const TMP = join(WEB, 'node_modules', '.legal-ssr')

/* ⚠ The BUILT stylesheet, not src/styles.css — the static pages must look like what production
   actually serves, and the build is what resolves the font @import and the custom properties. */
function builtCss() {
  const dir = join(WEB, 'dist', 'assets')
  let files
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.css'))
  } catch {
    throw new Error('web/dist not found — run `npm run build` before this script')
  }
  if (files.length !== 1) {
    /* ⛔ Not a warning. Two stylesheets means the build changed shape and picking one at random
       would silently ship a page styled by half of it. */
    throw new Error(`expected exactly one built stylesheet, found ${files.length}: ${files.join(', ')}`)
  }
  return readFileSync(join(dir, files[0]), 'utf8')
}

/* ⚠ Every page is served from the GATE root, which holds only these files plus the gate itself.
   Links out of here go to `/`, which is the gate — correct: somebody reading the policy without a
   code should land back at the door, not at a broken route. */
function shell({ title, css, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · Share Pons</title>
<meta name="description" content="${title} for Share Pons — a launchpad that splits a token's trading fees between wallets and social accounts." />
<!-- ⭐ INDEXABLE, unlike the gate page. These two are meant to be found and fetched, by App Review
     and by anybody checking what the site does with their data. -->
<meta name="theme-color" content="#f5f5f3" />
<link rel="icon" type="image/png" href="/favicon.png" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<style>
${css}

/* ── the standalone shell ──────────────────────────────────────────────────────────────────────
   ⚠ This page has no app: no header component, no wallet, no router. The strip below is a plain
   anchor to the site root, which while the site is gated is the gate itself.
   ⛔⛔ NO BACKTICKS ANYWHERE IN THIS BLOCK — this text lives inside a JS template literal, so one
   backtick closes the string early and everything after it is parsed as code. The first version of
   this comment quoted a path that way; the string ended, the slash after it became a DIVISION, and
   shell() silently returned NaN. It does not throw. The only symptom was fs refusing to write a
   number, pointing at a line that was perfectly correct. */
body { background: var(--void); }
.slim {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 0;
  border-bottom: 1px solid var(--line);
  margin-bottom: clamp(20px, 3vw, 34px);
}
.slim img { width: 34px; height: 34px; object-fit: contain; }
.slim a { color: var(--ink); text-decoration: none; font-family: var(--font-display); font-weight: 600; }
.slim a:hover { text-decoration: underline; text-underline-offset: 3px; }
.slim__wrap { width: min(760px, 100% - var(--gut) * 2); margin-inline: auto; }
/* ⚠ The app's .section adds its own top padding; the strip already provides it here. */
.legal.section { padding-top: 0; }
</style>
</head>
<body>
<div class="slim__wrap">
  <div class="slim">
    <img src="/logo.png" alt="" />
    <a href="/">Share Pons</a>
  </div>
</div>
${body}
</body>
</html>
`
}

async function main() {
  mkdirSync(TMP, { recursive: true })
  const out = join(TMP, 'legal.mjs')

  await build({
    entryPoints: [join(WEB, 'src', 'components', 'Legal.tsx')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    /* ⚠ React stays external so this script and the rendered tree share ONE React instance.
       Bundling a second copy makes renderToStaticMarkup throw on hooks it does not recognise. */
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server'],
    outfile: out,
    logLevel: 'warning',
  })

  const mod = await import(`file://${out}?t=${Date.now()}`)
  const css = builtCss()

  /* ⛔⛔ EVERY PUBLIC LEGAL ROUTE MUST BE IN THIS LIST. A route that exists in the app but not here
     is served the GATE page with a 200 while the site is in private preview — the exact failure
     these files exist to prevent, and it looks like a working page to anything that only checks a
     status code. @see web/src/lib/router.ts, where the three are declared together. */
  const pages = [
    { file: 'privacy.html', title: 'Privacy', Component: mod.PrivacyPage },
    { file: 'terms.html', title: 'Terms', Component: mod.TermsPage },
    /* ⚠ Meta's "Data deletion request URL" points at this exact path. Renaming the file renames
       a URL that is registered in somebody else's dashboard. */
    { file: 'data-deletion.html', title: 'Deleting your data', Component: mod.DataDeletionPage },
  ]

  for (const { file, title, Component } of pages) {
    const body = renderToStaticMarkup(createElement(Component))
    /* ⛔ A sanity floor, not decoration. A component that renders to nothing would still write a
       perfectly valid, perfectly empty policy page and the failure would be invisible. */
    if (body.length < 1500) throw new Error(`${file} rendered only ${body.length} bytes — refusing to write it`)
    const html = shell({ title, css, body })
    /* ⛔ Guards the backtick trap above: a template literal closed early evaluates to a number and
       every later check passes. Assert the shape before anything touches the filesystem. */
    if (typeof html !== 'string') throw new Error(`shell() returned ${typeof html}, not a string — a stray backtick in the template?`)
    writeFileSync(join(GATE, file), html)
    console.log(`  gate/${file}  ${(html.length / 1024).toFixed(1)} kB`)
  }

  rmSync(TMP, { recursive: true, force: true })
  console.log('✅ legal pages rendered from Legal.tsx')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
