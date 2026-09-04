/**
 * Hosting a token's image.
 *
 * ## Why this exists at all
 *
 * A Pons V2 `logo` field is 512 bytes, so it holds a LINK and never a picture. Uploading therefore
 * means putting the file somewhere that keeps serving it. A pinning service is the obvious answer
 * and the wrong one for a public launchpad: it needs an account, and a pinning key shipped in a
 * front end is a published key.
 *
 * ## ⛔⛔ SVG IS REFUSED, AND THAT IS A SECURITY DECISION
 *
 * An SVG is a document, not a picture: it can carry `<script>`. Serving one from the same origin as
 * the site would let anybody who uploads a logo run script against a visitor who has a WALLET
 * connected, on the page whose whole job is getting them to sign a transaction. The extension is not
 * trusted either — a `.png` that is really an SVG walks straight through a content-type allowlist.
 * Magic bytes decide.
 *
 * ## ⛔⛔ WHERE THE FILE GOES CAN NEVER LAPSE
 *
 * The URL is written into `logo` in the token's CONSTRUCTOR and Pons V2 ships no setter, so every
 * token launched while this points somewhere carries that host forever. Keep `LOGO_DIR` OUTSIDE the
 * site's deploy root: a front end deployed with `rsync --delete` would take every token's logo with
 * it. A sibling project has 22 of 24 logos permanently broken from exactly this.
 *
 * ⚠ The filename is a hash of the bytes, so the same image always lands at the same URL and an
 * address already written on chain can never be repointed at a different picture.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MAX_BYTES = 4 * 1024 * 1024

/** What a browser reliably renders as a token logo, minus SVG. ⚠ Keyed by magic bytes. */
const SIGNATURES: { ext: string; match: (b: Buffer) => boolean }[] = [
  { ext: 'png', match: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', match: (b) => b.subarray(0, 6).toString('ascii').startsWith('GIF8') },
  {
    ext: 'webp',
    match: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    ext: 'avif',
    match: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp' && b.subarray(8, 12).toString('ascii').startsWith('avif'),
  },
]

/**
 * The exact shape `storeLogo` writes: 32 lowercase hex characters and one known extension.
 *
 * ⛔⛔ THE ONLY THING THAT MAY BE SERVED FROM THE LOGO DIRECTORY. A filename that arrives in a URL is
 * attacker-controlled, so it is matched against this pattern and never joined to a path first —
 * `..%2f..%2fetc%2fpasswd` is not 32 hex characters, so it never reaches the filesystem at all.
 * ⚠ Whitelist, not a blacklist. Stripping `..` is how path traversal keeps getting shipped.
 */
export const LOGO_NAME = /^[0-9a-f]{32}\.(png|jpg|gif|webp|avif)$/

/** ⚠ Served from the sniffed extension, never from anything the request said. */
export const LOGO_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
}

export function sniff(bytes: Buffer): string | null {
  return SIGNATURES.find((s) => s.match(bytes))?.ext ?? null
}

export function storeLogo(dir: string, publicBase: string, bytes: Buffer): { url: string; bytes: number } {
  if (bytes.length === 0) throw new Error('that file is empty')
  if (bytes.length > MAX_BYTES) throw new Error(`that is larger than the ${MAX_BYTES / 1024 / 1024} MB limit`)

  const ext = sniff(bytes)
  if (!ext) throw new Error('that is not a PNG, JPEG, GIF, WebP or AVIF. SVG is not accepted.')

  mkdirSync(dir, { recursive: true })
  const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${ext}`
  writeFileSync(join(dir, name), bytes)

  const url = `${publicBase.replace(/\/+$/, '')}/${name}`
  /* ⛔⛔ 512 BYTES IS THE HARD LIMIT ON CHAIN, and the revert names no field — an oversized logo
     fails the whole launch with a message that points nowhere. Checked here so the upload fails
     instead of the launch. */
  if (Buffer.byteLength(url, 'utf8') > 512) {
    throw new Error('the URL for that file is longer than Pons allows in a token; shorten LOGO_PUBLIC_BASE')
  }
  return { url, bytes: bytes.length }
}

/* ── a crude per-caller budget ─────────────────────────────────────────────────────────────────
   A public upload endpoint is a disk somebody else can fill. Content addressing means a determined
   uploader still needs a different image each time, but only just. This turns "fill the disk" into
   "fill the disk slowly and visibly". */
const WINDOW_MS = 60 * 60 * 1000
const LIMIT = 40
const seen = new Map<string, number[]>()

export function rateLimited(who: string): boolean {
  const now = Date.now()
  const hits = (seen.get(who) ?? []).filter((t) => now - t < WINDOW_MS)
  hits.push(now)
  seen.set(who, hits)
  if (seen.size > 5000) for (const [k, v] of seen) if (v.every((t) => now - t > WINDOW_MS)) seen.delete(k)
  return hits.length > LIMIT
}
