#!/usr/bin/env node
/**
 * Put THIS SITE'S OWN TOKEN in the CA strip under the hero.
 *
 *     node scripts/go-live.mjs 0x<the token address>
 *     node scripts/go-live.mjs --show
 *     node scripts/go-live.mjs --clear
 *
 * The strip already exists and already works: `Hero.tsx` renders a copy button when
 * `VITE_TOKEN_CA` is a valid address and the words `CA: TBA` when it is not. So "showing the CA"
 * is one env var, a rebuild and a deploy — and this script exists because every part of that
 * sentence has gone wrong on a sibling project.
 *
 * ## ⛔⛔ WHY THIS IS NOT `sed -i` IN A RUNBOOK
 *
 * 1. **A regex env-write that matches nothing succeeds silently.** `sed` exits 0 whether it
 *    replaced a line or not, so a renamed key leaves the file untouched, the build is clean, the
 *    deploy is clean, and the site still says CA: TBA with nobody knowing why. This asserts the
 *    file CHANGED and re-reads it to confirm the value landed.
 * 2. **A vite site has no `.env` on the box.** The value is compiled INTO the bundle, so setting it
 *    on the server does nothing at all. It must be set here, built here, and shipped.
 * 3. **The wrong address is permanent-ish and public.** A CA in the hero is what people copy into a
 *    swap. So this refuses anything that is not a real token on chain, and (once the register is
 *    non-empty) anything that ShareLaunchpad does not know about.
 * 4. **Re-running it on a live CA is how a sibling project overwrote a launched token's config.**
 *    Replacing an address that is already set needs `--force`, out loud.
 *
 * ⛔ It does NOT deploy. It prints the deploy command. Building and shipping are the operator's
 * call, and a script that silently pushes to production is a script nobody runs twice.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/* ⚠ Overridable ONLY so the tests can point it at a scratch file. Nothing in the deploy path sets
   it, and it must never be set on a real run — the whole point is that one file is the truth. */
const ENV_PATH = process.env.SHARE_GO_LIVE_ENV || resolve(HERE, '../.env.production')
const KEY = 'VITE_TOKEN_CA'

const RPC = process.env.RHC_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'
/** ⛔ RHC sits behind Cloudflare and refuses a request with no User-Agent — node's fetch sends none.
 *  A missing UA here is a silent 403 that reads like the token not existing. @see HANDOFF. */
const UA = 'Mozilla/5.0 (compatible; share-go-live)'

const args = process.argv.slice(2)
const force = args.includes('--force')
const rest = args.filter((a) => a !== '--force')

const die = (m) => { console.error(`\n⛔ ${m}\n`); process.exit(1) }
const ok = (m) => console.log(`   \x1b[32m✓\x1b[0m ${m}`)

/** ⚠ Reads the CURRENT value the same way the build will: the last assignment wins, comments out. */
function readEnv() {
  const raw = readFileSync(ENV_PATH, 'utf8')
  let value = null
  for (const line of raw.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line)
    if (m && m[1] === KEY) value = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return { raw, value }
}

/**
 * @param soft when true a revert RETURNS null instead of exiting.
 *
 * ⛔⛔ `soft` IS NOT A CONVENIENCE. `entryOf` REVERTS for a token this launchpad did not create —
 * deliberately, so a caller cannot render a zeroed struct as a share launch paying nobody. Without
 * a soft path this whole script died on `execution reverted` at the one check that was always
 * meant to be advisory, which is a refusal disguised as a crash.
 * ⚠ A `.catch()` on the caller cannot fix that: `die()` calls process.exit, so it never returns to
 * be caught. The distinction has to live HERE.
 */
async function rpc(method, params, soft = false) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }).catch((e) => { if (soft) return null; die(`could not reach the RPC at ${RPC}: ${e.message}`) })
  if (!r) return null
  if (!r.ok) {
    if (soft) return null
    die(`the RPC answered HTTP ${r.status}. ⛔ A 403 here is Cloudflare refusing the request, not a bad address.`)
  }
  const j = await r.json()
  if (j.error) {
    if (soft) return null
    die(`the RPC refused ${method}: ${j.error.message}`)
  }
  return j.result
}

const call = (to, data, soft = false) => rpc('eth_call', [{ to, data }, 'latest'], soft)

/** ⚠ Decodes one ABI string return. Enough for name()/symbol(); not a general decoder. */
function decodeString(hex) {
  if (!hex || hex === '0x') return null
  const b = hex.slice(2)
  const len = parseInt(b.slice(64, 128), 16)
  if (!Number.isFinite(len) || len === 0) return null
  return Buffer.from(b.slice(128, 128 + len * 2), 'hex').toString('utf8')
}

const LAUNCHPAD = readEnv().raw.match(/^\s*VITE_LAUNCHPAD\s*=\s*(0x[0-9a-fA-F]{40})/m)?.[1] ?? null

async function main() {
  const { raw, value: current } = readEnv()

  if (rest.includes('--show')) {
    console.log(`\n${KEY} = ${current ? current : '(empty — the hero says "CA: TBA")'}\n`)
    return
  }

  if (rest.includes('--clear')) {
    if (!current) die(`${KEY} is already empty. Nothing to clear.`)
    write(raw, '')
    console.log(`\n✅ ${KEY} cleared — the hero will read "CA: TBA" after the next build.\n`)
    return
  }

  const ca = rest[0]
  if (!ca) die('pass the token address:  node scripts/go-live.mjs 0x<CA>   (or --show / --clear)')
  if (!/^0x[0-9a-fA-F]{40}$/.test(ca)) die(`"${ca}" is not an address. It must be 0x followed by 40 hex characters.`)

  if (current && current.toLowerCase() !== ca.toLowerCase() && !force) {
    die(
      `${KEY} is ALREADY SET to ${current}.\n` +
      `   Replacing a live CA is how a sibling project pointed its site at the wrong token.\n` +
      `   If that is genuinely what you want:  node scripts/go-live.mjs ${ca} --force`,
    )
  }

  console.log(`\nSHARE go-live — putting a CA in the hero strip\n  env  ${ENV_PATH}\n  rpc  ${RPC}\n\nchecking the address is a real token`)

  const code = await rpc('eth_getCode', [ca, 'latest'])
  if (!code || code === '0x') die(`there is NO CONTRACT at ${ca} on chain ${RPC}. Nothing would be gained by publishing it.`)
  ok(`there is code at ${ca}`)

  const name = decodeString(await call(ca, '0x06fdde03'))   // name()
  const symbol = decodeString(await call(ca, '0x95d89b41')) // symbol()
  if (!name || !symbol) die(`${ca} has code but does not answer name()/symbol(). That is not an ERC-20.`)
  ok(`it is an ERC-20: ${name} (${symbol})`)

  /* ⭐ THE REGISTER CHECK — advisory, never a refusal.
     `entryOf` REVERTS for a token this launchpad did not create (see the natspec on it), so a
     successful call is the "yes" and a revert is the "no". ⛔ Read as a soft call: a revert here
     must not kill the script, because pointing the strip at a token launched OUTSIDE the pad is a
     legitimate operator choice — it is exactly what happened on 4 Sep 2026. Refusing it would be
     this script overruling the person running it.
     ⛔ The selector is `cast sig "entryOf(address)"`. A guessed one was wrong on the first attempt
     and would have reported every token as unknown, which is a warning nobody would have doubted. */
  if (LAUNCHPAD) {
    const entry = await call(
      LAUNCHPAD,
      '0x58bb388a' + ca.slice(2).toLowerCase().padStart(64, '0'),
      true,
    )
    if (entry && entry !== '0x') {
      ok('ShareLaunchpad created this token — it has a ShareSplitter and the split is on chain')
    } else {
      console.log(
        '   \x1b[33m⚠ ShareLaunchpad did NOT create this token.\x1b[0m It has no ShareSplitter and no\n' +
        '       social fee split, and it will not appear in Explore. Publishing it is a deliberate choice.',
      )
    }
  }

  write(raw, ca)

  const after = readEnv().value
  if (after !== ca) die(`the write did not take: ${KEY} reads "${after}" after writing "${ca}". ⛔ Do not deploy.`)
  ok(`${KEY} written and read back as ${ca}`)

  console.log(`\n✅ The hero will show  CA ${ca.slice(0, 6)}…${ca.slice(-4)}  with a copy button.\n
⛔ IT IS NOT LIVE YET — the value is compiled into the bundle, so it needs a build and a deploy:

    cd web && npm run build && HOST=root@<the box> ./deploy.sh

⭐ Then confirm what is actually SERVED, not what was built:

    curl -s https://sharepons.family/assets/index-*.js | grep -c ${ca}
`)
}

function write(raw, ca) {
  const line = `${KEY}=${ca}`
  const re = new RegExp(`^\\s*${KEY}\\s*=.*$`, 'm')
  let next
  if (re.test(raw)) next = raw.replace(re, line)
  else next = raw.replace(/\n*$/, `\n${line}\n`)
  /* ⛔⛔ THE ASSERT THAT MAKES THIS DIFFERENT FROM sed. An env-write that matched nothing exits 0
     and ships a site that never changed. @see the header. */
  if (next === raw) die(`the edit changed nothing — ${KEY} was neither replaced nor appended. The file may have an unexpected shape.`)
  writeFileSync(ENV_PATH, next)
}

main().catch((e) => die(e?.message ?? String(e)))
