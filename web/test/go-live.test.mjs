/**
 * The go-live script's env write.
 *
 * ⛔⛔ WHY THIS FILE EXISTS: the failure it guards against is SILENT. An env-write that matches
 * nothing exits 0, the build is clean, the deploy is clean, and the site still says "CA: TBA" with
 * no error anywhere to explain it. That has happened on a sibling project. Every test below is
 * about the script REFUSING or ASSERTING rather than about it succeeding.
 *
 * ⚠ Only the paths that run BEFORE any RPC call are covered here, which is deliberate — they are
 * the ones that can destroy a correct config. The on-chain checks are exercised by hand against
 * real addresses; a mocked RPC would only prove the mock works.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = new URL('../scripts/go-live.mjs', import.meta.url).pathname
const CA = '0x67e8072B6495Fdbf6bf21C3640c0cb4E558aACDC'

function envFile(contents) {
  const f = join(mkdtempSync(join(tmpdir(), 'share-golive-')), '.env.production')
  writeFileSync(f, contents)
  return f
}

function run(file, args) {
  try {
    const out = execFileSync('node', [SCRIPT, ...args], {
      env: { ...process.env, SHARE_GO_LIVE_ENV: file },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

test('--show reports an empty CA as TBA rather than printing nothing', () => {
  const f = envFile('VITE_TOKEN_CA=\n')
  const r = run(f, ['--show'])
  assert.equal(r.code, 0)
  assert.match(r.out, /CA: TBA/)
})

test('--show reports the value that is set', () => {
  const f = envFile(`VITE_TOKEN_CA=${CA}\n`)
  assert.match(run(f, ['--show']).out, new RegExp(CA))
})

test('a malformed address is refused before anything is written', () => {
  const f = envFile('VITE_TOKEN_CA=\n')
  const r = run(f, ['0xnope'])
  assert.notEqual(r.code, 0)
  assert.match(r.out, /is not an address/)
  assert.equal(readFileSync(f, 'utf8'), 'VITE_TOKEN_CA=\n')
})

test('⛔ replacing an ALREADY SET CA is refused without --force', () => {
  const f = envFile('VITE_TOKEN_CA=0x1111111111111111111111111111111111111111\n')
  const r = run(f, [CA])
  assert.notEqual(r.code, 0)
  assert.match(r.out, /ALREADY SET/)
  assert.match(r.out, /--force/)
  /* ⛔ The file must be untouched — a refusal that half-wrote would be worse than no check. */
  assert.match(readFileSync(f, 'utf8'), /0x1111111111111111111111111111111111111111/)
})

test('setting the SAME CA again is not treated as an overwrite', () => {
  /* ⚠ Re-running go-live after a failed deploy must not need --force, or the operator learns to
     pass --force by reflex and the guard stops meaning anything. It fails later, at the RPC, only
     because this test has no network — reaching that point is the assertion. */
  const f = envFile(`VITE_TOKEN_CA=${CA}\n`)
  const r = run(f, [CA])
  assert.doesNotMatch(r.out, /ALREADY SET/)
})

test('--clear empties the value and leaves the key in place', () => {
  const f = envFile(`VITE_TOKEN_CA=${CA}\n`)
  assert.equal(run(f, ['--clear']).code, 0)
  assert.equal(readFileSync(f, 'utf8'), 'VITE_TOKEN_CA=\n')
})

test('--clear on an already-empty value refuses rather than pretending it did something', () => {
  const f = envFile('VITE_TOKEN_CA=\n')
  const r = run(f, ['--clear'])
  assert.notEqual(r.code, 0)
  assert.match(r.out, /already empty/)
})

test('⛔⛔ a file with no VITE_TOKEN_CA key at all gets the key APPENDED, never silently skipped', () => {
  /* This is the exact shape of the silent-noop bug: a sed-style replace matches nothing, exits 0,
     and ships a site that never changed. The script must either write or fail loudly. */
  const f = envFile('VITE_SITE_URL=https://example.test\n')
  const r = run(f, ['--clear'])
  assert.notEqual(r.code, 0, 'clearing a key that does not exist must not report success')
})

test('the last assignment wins, the way a build reads it', () => {
  /* ⚠ A duplicated key is a real shape — an append after a hand-edit produces it. If --show read
     the FIRST one it would report a value the build never uses. */
  const f = envFile(`VITE_TOKEN_CA=0x1111111111111111111111111111111111111111\nVITE_TOKEN_CA=${CA}\n`)
  assert.match(run(f, ['--show']).out, new RegExp(CA))
})
