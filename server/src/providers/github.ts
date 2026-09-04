/**
 * Signing in with GitHub. OAuth 2.0 authorization code flow.
 *
 *   authorize  https://github.com/login/oauth/authorize
 *   token      https://github.com/login/oauth/access_token
 *   identity   GET https://api.github.com/user
 *   lookup     GET https://api.github.com/users/{login}
 *
 * ## ⚠ Three differences from X that are easy to get wrong
 *
 * - GitHub's token endpoint returns **form encoded** by default. It only returns JSON if asked with
 *   `Accept: application/json`, and a parser that assumes JSON gets a string that silently yields
 *   `undefined` for every field.
 * - Classic OAuth apps do **not** support PKCE. A `code_challenge` is ignored rather than refused,
 *   so sending one buys nothing and pretending it protects anything would be worse. `state` is doing
 *   the work, and it is checked against both the server's record and the browser's cookie.
 * - The API **requires a User-Agent** and answers 403 without one, which reads like a permissions
 *   problem rather than a missing header.
 *
 * ⭐ Lookup needs no credential at all — `/users/{login}` is public. So a GitHub recipient can be
 * named on a launch even on a deployment with no GitHub OAuth app configured; only CLAIMING needs
 * one. The launch form is told this separately from whether sign-in works.
 */
import { randomBytes } from 'node:crypto'

import type { Identity, IdentityProvider } from '../identity.ts'

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const ME_URL = 'https://api.github.com/user'
const USERS_URL = 'https://api.github.com/users'

/** ⚠ Required by GitHub's API, which answers 403 without one. */
const UA = 'share-launchpad'

/** ⚠ `read:user` is the narrowest scope that returns an id and a login. SHARE never reads a
 *  repository, never writes anything, and never acts on anybody's behalf. */
const SCOPES = 'read:user'

export function githubProvider(clientId: string, clientSecret: string): IdentityProvider {
  return {
    name: 'github',
    label: 'GitHub',
    canLookup: true,

    begin(redirectUri) {
      const state = randomBytes(24).toString('hex')
      const url = new URL(AUTHORIZE_URL)
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('scope', SCOPES)
      url.searchParams.set('state', state)
      // ⚠ No verifier: classic OAuth apps ignore PKCE. `state` is what proves this callback is ours.
      return { url: url.toString(), state, verifier: '' }
    },

    async complete(code, _verifier, redirectUri) {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          // ⚠⚠ Without this GitHub answers form-encoded and every field parses as undefined.
          accept: 'application/json',
          'user-agent': UA,
        },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      })
      if (!res.ok) throw new Error(`GitHub refused the code exchange: ${res.status}`)
      const token = (await res.json()) as { access_token?: string; error_description?: string }
      if (!token.access_token) throw new Error(token.error_description ?? 'GitHub returned no access token')

      const me = await fetch(ME_URL, {
        headers: {
          authorization: `Bearer ${token.access_token}`,
          accept: 'application/vnd.github+json',
          'user-agent': UA,
        },
      })
      if (!me.ok) throw new Error(`GitHub refused the identity lookup: ${me.status}`)
      const body = (await me.json()) as RawUser
      if (!body.id || !body.login) throw new Error('GitHub returned no account')
      return toIdentity(body)
    },

    async lookup(handle) {
      const clean = handle.replace(/^@/, '').replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\/.*$/, '')
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(clean)) return null
      const res = await fetch(`${USERS_URL}/${encodeURIComponent(clean)}`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': UA },
      })
      if (res.status === 404) return null
      /* ⚠ Unauthenticated GitHub allows 60 requests an hour per IP. Named, because "try again" for
         the next forty minutes is not advice. */
      if (res.status === 403 || res.status === 429) throw new Error('GITHUB_RATE_LIMITED')
      if (!res.ok) throw new Error(`GitHub refused the handle lookup: ${res.status}`)
      const body = (await res.json()) as RawUser
      return body.id && body.login ? toIdentity(body) : null
    },
  }
}

type RawUser = { id?: number; login?: string; name?: string | null; avatar_url?: string }

function toIdentity(d: RawUser): Identity {
  return {
    platform: 'github',
    // ⛔ `id`, never `login`. Usernames can be released and re-registered by somebody else.
    id: String(d.id),
    handle: String(d.login),
    name: d.name ?? String(d.login),
    avatar: d.avatar_url ?? null,
  }
}
