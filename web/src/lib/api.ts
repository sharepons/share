/**
 * The client for SHARE's one server.
 *
 * ⭐⭐ EVERY CALL IN HERE IS OPTIONAL TO THE SITE. The launch feed, every split, every balance and
 * every market cap come off the chain in the visitor's own browser. This server proves WHO somebody
 * is — nothing else — so it being down means nobody can sign in or claim, and means no number
 * anywhere on the site is wrong or missing. Each function below fails into a state the interface can
 * render rather than throwing into a blank page.
 */
import type { Address, Hex } from 'viem'
import type { Platform } from './platforms.ts'

export type ProviderState = {
  platform: Platform
  label: string
  /** Can somebody sign in as this platform, here, today? */
  signin: boolean
  /** Can a launcher resolve a typed handle? ⛔ False forever on Instagram and TikTok. */
  lookup: boolean
  /**
   * ⛔⛔ `handle` MEANS THE SHARE FOLLOWS THE NAME. Neither Instagram nor TikTok publishes a way to
   * turn a username into an account, so there is nothing else to key on. Rendered as a warning on the
   * launch form, never hidden.
   */
  keyedBy: 'id' | 'handle'
  /**
   * ⭐ A second way to prove this handle when sign-in is not available. `'bio'` means a one-time
   * code goes in the profile bio and the server reads it back publicly.
   * ⛔ From the server, like `signin` — never inferred here, or the dialog offers a route this
   * deployment cannot complete.
   */
  verify?: 'bio' | null
}

export type Capabilities = {
  providers: ProviderState[]
  /** ⚠ False means claiming is switched off on this deployment — not that nobody is owed. */
  claiming: boolean
  /** ⛔ True when the server could not be reached at all, so the interface can say which it is. */
  offline: boolean
}

export type Account = {
  platform: Platform
  id: string
  handle: string
  name: string
  avatar: string | null
  beneficiary: Hex
}

const json = async <T,>(res: Response): Promise<T> => {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !body) throw new Error(body?.error ?? `that request failed (${res.status})`)
  return body
}

export async function fetchCapabilities(): Promise<Capabilities> {
  try {
    const body = await json<{ providers: ProviderState[]; claiming: boolean }>(await fetch('/api/providers'))
    return { ...body, offline: false }
  } catch {
    /* ⚠ An empty list, flagged offline. The claim page then says the sign-in service is unreachable
       instead of "no platforms are supported", which is a different and much worse claim. */
    return { providers: [], claiming: false, offline: true }
  }
}

export async function fetchMe(): Promise<Account | null> {
  try {
    const body = await json<{ identity: Account | null }>(await fetch('/api/me'))
    return body.identity
  } catch {
    return null
  }
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/signout', { method: 'POST' }).catch(() => undefined)
}

export const signInHref = (platform: Platform, returnTo: string) =>
  `/api/auth/start/${platform}?return=${encodeURIComponent(returnTo)}`

export type HandleResult =
  | { kind: 'found'; account: Account }
  | { kind: 'none' }
  /** ⚠ Not an error. It is the correct, permanent answer for Instagram and TikTok. */
  | { kind: 'no-lookup'; note: string }
  | { kind: 'error'; message: string }

/**
 * Resolve a typed handle to the account that holds it right now.
 *
 * ⛔⛔ THIS IS WHAT MAKES AN X OR GITHUB SHARE SURVIVE A RENAME. What goes on chain is the numeric
 * id this returns, never the text somebody typed.
 */
export async function resolveHandle(platform: Platform, handle: string): Promise<HandleResult> {
  try {
    const res = await fetch(`/api/handle?platform=${platform}&handle=${encodeURIComponent(handle)}`)
    const body = (await res.json().catch(() => null)) as
      | { account?: Account | null; lookup?: boolean; note?: string; error?: string }
      | null
    if (!res.ok) return { kind: 'error', message: body?.error ?? 'that lookup failed' }
    if (body?.lookup === false) return { kind: 'no-lookup', note: body.note ?? '' }
    return body?.account ? { kind: 'found', account: body.account } : { kind: 'none' }
  } catch {
    return { kind: 'error', message: 'the lookup service is unreachable' }
  }
}

export type Attestation = { beneficiary: Hex; recipient: Address; deadline: string; salt: Hex }

/**
 * Ask the server to state who is signed in and where they want to be paid.
 *
 * ⭐ There is no amount in the answer. The vault works out what is owed from its own ledger, so the
 * server cannot be wrong about a number it never sees. @see server/src/attest.ts.
 */
export async function requestAttestation(recipient: Address): Promise<{
  attestation: Attestation
  signature: Hex
  claims: Address
}> {
  return json(
    await fetch('/api/attestation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipient }),
    }),
  )
}

/* ── proving a handle by putting a code in the bio ─────────────────────────────────────────────── */

/**
 * ⛔⛔ THE CODE IS BOUND TO A WALLET, AND THAT IS THE WHOLE SECURITY OF IT. It goes into a PUBLIC
 * bio where anyone can read it — bound to one address, a passer-by who copies it learns a string
 * that can only ever mint an attestation naming somebody else.
 */
export async function startBioVerify(
  handle: string,
  recipient: string,
): Promise<{ handle: string; code: string } | { error: string }> {
  try {
    const res = await fetch('/api/verify/tiktok/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle, recipient }),
    })
    const body = (await res.json()) as { handle?: string; code?: string; error?: string }
    if (!res.ok || !body.code) return { error: body.error ?? 'could not start that' }
    return { handle: body.handle ?? handle, code: body.code }
  } catch {
    return { error: 'the server is unreachable' }
  }
}

/**
 * ⚠⚠ THREE ANSWERS, NOT TWO. `pending` means we read the profile and the code is not there yet —
 * their job is unfinished. `error` means we could not read it at all, which is OUR problem and must
 * never be phrased as "your code is missing": that sends somebody to re-paste a code already in
 * place, and no amount of retrying helps.
 */
export async function checkBioVerify(
  handle: string,
  recipient: string,
): Promise<{ ok: true } | { ok: false; pending: boolean; error: string }> {
  try {
    const res = await fetch('/api/verify/tiktok/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle, recipient }),
    })
    if (res.ok) return { ok: true }
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    /* ⚠ 409 is the server saying "read fine, code not there yet" — the only status a person should
       be invited to retry immediately. */
    return { ok: false, pending: res.status === 409, error: body.error ?? 'that did not work' }
  } catch {
    return { ok: false, pending: false, error: 'the server is unreachable' }
  }
}
