/**
 * Signing in with X. OAuth 2.0 authorization code flow with PKCE.
 *
 *   authorize  https://x.com/i/oauth2/authorize
 *   token      https://api.x.com/2/oauth2/token
 *   identity   GET https://api.x.com/2/users/me
 *   lookup     GET https://api.x.com/2/users/by/username/{handle}
 */
import { createHash, randomBytes } from 'node:crypto'

import type { Identity, IdentityProvider } from '../identity.ts'
import { lookupViaTwitterApiIo } from './twitterapiio.ts'

const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize'
const TOKEN_URL = 'https://api.x.com/2/oauth2/token'
const ME_URL = 'https://api.x.com/2/users/me'
const BY_USERNAME_URL = 'https://api.x.com/2/users/by/username'

/**
 * ⚠ `users.read` identifies the account and X requires `tweet.read` alongside it. `offline.access`
 * is deliberately absent: SHARE never acts on anybody's behalf, so a refresh token would be a
 * credential held for no reason at all.
 */
const SCOPES = 'users.read tweet.read'

const base64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function xProvider(
  clientId: string,
  clientSecret: string,
  appBearer?: string,
  lookupKey?: string,
): IdentityProvider {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  return {
    name: 'x',
    label: 'X',
    /* ⚠ Only true when a bearer is configured. Handle lookup is a SEPARATE credential from the
       OAuth pair, and without it the launch form cannot resolve `@somebody` to an id at all — so
       the form has to know, rather than offering a control that always fails. */
    canLookup: Boolean(appBearer),

    begin(redirectUri) {
      /*
        ⚠⚠ PKCE with S256, never `plain`. X accepts both, and `plain` puts the secret that proves the
        callback came from the same browser into the query string an attacker would be reading.
      */
      const verifier = base64url(randomBytes(48))
      const challenge = base64url(createHash('sha256').update(verifier).digest())
      const state = base64url(randomBytes(24))

      const url = new URL(AUTHORIZE_URL)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('scope', SCOPES)
      url.searchParams.set('state', state)
      url.searchParams.set('code_challenge', challenge)
      url.searchParams.set('code_challenge_method', 'S256')
      return { url: url.toString(), state, verifier }
    },

    async complete(code, verifier, redirectUri) {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        }),
      })
      if (!res.ok) throw new Error(`X refused the code exchange: ${res.status}`)
      const token = (await res.json()) as { access_token?: string }
      if (!token.access_token) throw new Error('X returned no access token')

      const me = await fetch(`${ME_URL}?user.fields=profile_image_url`, {
        headers: { authorization: `Bearer ${token.access_token}` },
      })
      if (!me.ok) throw new Error(`X refused the identity lookup: ${me.status}`)
      const body = (await me.json()) as { data?: RawUser }
      if (!body.data?.id) throw new Error('X returned no account')
      return toIdentity(body.data)
    },

    async lookup(handle) {
      /*
        ⭐⭐ twitterapi.io FIRST WHEN IT IS CONFIGURED, AND THIS IS A BILLING DECISION ONLY.
        X's own `GET /2/users/by/username` is prepaid per call against a balance held per developer
        PROJECT, and a fresh project starts at zero — which is exactly what this deployment hit:
        sign-in worked perfectly while every lookup answered `402 credits depleted`.
        ⚠ The identity that comes back is the same shape and carries the same GLOBAL X id, which is
        the only thing that matters here — that id becomes `keccak256("x:<id>")` in a launch's split,
        on chain, with no setter.

        ⛔ NOT A FALLBACK CHAIN. If twitterapi.io is configured and fails, that failure is reported
        rather than quietly retried against X. A lookup that "works" by silently spending from a
        balance the operator believed was untouched is worse than an error naming the problem.
      */
      if (lookupKey) return lookupViaTwitterApiIo(lookupKey, handle)

      /*
        ⚠ A handle lookup needs an APP token, not the basic credential: X's v2 user endpoints take a
        bearer. Separate configuration rather than derived from the OAuth pair.
      */
      if (!appBearer) throw new Error('X_BEARER_TOKEN is not set, so handles cannot be resolved')
      const clean = handle.replace(/^@/, '').replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '')
      /*
        ⛔⛔ SHAPE CHECKED BEFORE THE CALL, BECAUSE EVERY LOOKUP IS PREPAID. X's own rule is
        `^[A-Za-z0-9_]{1,15}$` and it answers 400 for anything else — so sending it anyway spends a
        credit to be told the string could not possibly be a handle, and surfaces as a server fault
        for what is really a typo. ⚠ `null` is the same answer as "no such account", because to the
        person filling in the form they are the same thing: this handle cannot be paid.
      */
      if (!/^[A-Za-z0-9_]{1,15}$/.test(clean)) return null

      const res = await fetch(`${BY_USERNAME_URL}/${encodeURIComponent(clean)}?user.fields=profile_image_url`, {
        headers: { authorization: `Bearer ${appBearer}` },
      })
      if (res.status === 404) return null
      /*
        🔴🔴 402 IS "CREDITS DEPLETED", AND IT IS NOT TRANSIENT. X's v2 user endpoints are prepaid
        per lookup against a balance held per PROJECT, so a new app in a fresh project starts at zero
        even though an older app on the same login works. Named separately, because the generic
        "something went wrong, try again" is advice that can never come true.
      */
      if (res.status === 402) throw new Error('X_CREDITS_DEPLETED')
      if (!res.ok) throw new Error(`X refused the handle lookup: ${res.status}`)
      const body = (await res.json()) as { data?: RawUser }
      return body.data?.id ? toIdentity(body.data) : null
    },
  }
}

type RawUser = { id: string; username: string; name: string; profile_image_url?: string }

function toIdentity(d: RawUser): Identity {
  return {
    platform: 'x',
    id: d.id,
    handle: d.username,
    name: d.name,
    /* ⚠ `_normal` is a 48px thumbnail. Swapped for the full-size original, because these render at
       up to 96px on a token page and the small one is visibly soft there. */
    avatar: d.profile_image_url?.replace('_normal', '') ?? null,
  }
}
