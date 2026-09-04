/**
 * The store. A JSON file, written atomically.
 *
 * ⚠ Small on purpose, and it stays small: what lives here is who is signed in right now and which
 * OAuth handshakes are in flight. Nothing about money is kept here — the ledger is on chain, and
 * that is the whole reason this server can be wiped, moved or lost without anybody losing a share.
 *
 * ⚠⚠ Written to a temp file and renamed, never edited in place. A half-written JSON file is an
 * unparseable one, and losing it signs everybody out.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Identity } from './identity.ts'

export type Session = { identity: Identity; createdAt: number }
/** One OAuth handshake in flight. ⚠ `verifier` is the PKCE secret and never leaves this box. */
export type Pending = { platform: string; state: string; verifier: string; returnTo: string; createdAt: number }

/**
 * A handle verification waiting on somebody to paste a code into their bio.
 *
 * ⛔⛔ `recipient` IS PART OF THE RECORD AND THAT IS THE WHOLE SECURITY OF IT. The code is written
 * into a PUBLIC bio, so anyone can read it. Bound to one wallet, a passer-by who copies it learns a
 * string that mints an attestation naming somebody else's address — useless to them.
 */
export type BioClaim = {
  platform: string
  /** ⚠ Lower-cased. The key is `tiktok:@jane` and case must not make two of them. */
  handle: string
  code: string
  /** The only address an attestation from this verification may name. */
  recipient: string
  createdAt: number
}

type Shape = {
  sessions: Record<string, Session>
  pending: Record<string, Pending>
  /** Keyed by `${platform}:${handle}`, so a second attempt replaces the first rather than piling up. */
  bio: Record<string, BioClaim>
}

/** ⚠ A signed-in browser stays signed in for a week. Nothing here is a payment authorisation: the
 *  claim itself is a transaction the recipient signs in their own wallet. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** ⚠ A handshake that has not come back in fifteen minutes is abandoned, not slow. */
const PENDING_TTL_MS = 15 * 60 * 1000

export class Store {
  private readonly file: string
  private data: Shape = { sessions: {}, pending: {}, bio: {} }

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'share.json')
    try {
      this.data = { sessions: {}, pending: {}, bio: {}, ...JSON.parse(readFileSync(this.file, 'utf8')) }
    } catch {
      /* A missing or unreadable file is an empty store, not a crash. The only cost is that everybody
         signs in again, and refusing to boot over it would cost the whole site instead. */
    }
    this.prune()
  }

  private flush() {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data))
    renameSync(tmp, this.file)
  }

  /** ⚠ Swept rather than left to grow. An abandoned handshake is never completed, so without this
   *  the file is an unbounded list of strings anybody can add to for free. */
  prune() {
    const now = Date.now()
    let changed = false
    for (const [k, v] of Object.entries(this.data.sessions)) {
      if (now - v.createdAt > SESSION_TTL_MS) {
        delete this.data.sessions[k]
        changed = true
      }
    }
    for (const [k, v] of Object.entries(this.data.pending)) {
      if (now - v.createdAt > PENDING_TTL_MS) {
        delete this.data.pending[k]
        changed = true
      }
    }
    if (changed) this.flush()
  }

  putPending(id: string, p: Pending) {
    this.data.pending[id] = p
    this.flush()
  }

  /** ⚠ Read AND removed in one step. A handshake is good exactly once; leaving it readable turns a
   *  leaked callback URL into a replayable sign-in. */
  /** ⚠ 30 minutes. Long enough to edit a bio on a phone, short enough that a stale code in somebody
      else's bio is not a standing invitation. */
  private static readonly BIO_TTL_MS = 30 * 60 * 1000

  putBioClaim(c: BioClaim) {
    this.data.bio[`${c.platform}:${c.handle}`] = c
    this.flush()
  }

  /** ⚠ Read WITHOUT removing: somebody will press Verify before they have saved the bio, and taking
      the record on a failed check would make them start over for being early. */
  bioClaim(platform: string, handle: string): BioClaim | undefined {
    const key = `${platform}:${handle}`
    const c = this.data.bio[key]
    if (!c) return undefined
    if (Date.now() - c.createdAt > Store.BIO_TTL_MS) {
      delete this.data.bio[key]
      this.flush()
      return undefined
    }
    return c
  }

  /** ⛔ Called only on SUCCESS. A verified code is spent — reusing one would let a later visitor
      claim on the back of a bio edit the owner has since undone. */
  takeBioClaim(platform: string, handle: string) {
    delete this.data.bio[`${platform}:${handle}`]
    this.flush()
  }

  takePending(id: string): Pending | undefined {
    const p = this.data.pending[id]
    if (p) {
      delete this.data.pending[id]
      this.flush()
    }
    return p
  }

  putSession(token: string, identity: Identity) {
    this.data.sessions[token] = { identity, createdAt: Date.now() }
    this.flush()
  }

  session(token: string | undefined): Session | undefined {
    if (!token) return undefined
    const s = this.data.sessions[token]
    if (!s) return undefined
    if (Date.now() - s.createdAt > SESSION_TTL_MS) {
      delete this.data.sessions[token]
      this.flush()
      return undefined
    }
    return s
  }

  dropSession(token: string | undefined) {
    if (token && this.data.sessions[token]) {
      delete this.data.sessions[token]
      this.flush()
    }
  }

  counts() {
    return { sessions: Object.keys(this.data.sessions).length, pending: Object.keys(this.data.pending).length }
  }
}
