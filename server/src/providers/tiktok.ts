/**
 * Signing in with TikTok — Login Kit, OAuth 2.0 with PKCE.
 *
 *   authorize  https://www.tiktok.com/v2/auth/authorize/
 *   token      POST https://open.tiktokapis.com/v2/oauth/token/
 *   identity   GET  https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username,avatar_url
 *
 * ## ⚠⚠ IT IS `client_key`, NOT `client_id`
 *
 * TikTok is the only provider here that spells it differently, on BOTH the authorize URL and the
 * token exchange. Sent as `client_id` the authorize page loads and then refuses with an error about
 * the app rather than about the parameter, which sends whoever is reading it to check the app
 * settings that were fine all along.
 *
 * ## ⛔⛔ `open_id` IS SCOPED TO THIS APP, SO IT CANNOT BE THE KEY
 *
 * The same person signing into a different app gets a different `open_id`, and TikTok publishes no
 * endpoint that maps a username to one. (`union_id` is broader — it spans one developer's apps —
 * and is still not a public identifier anybody can look up.) So a TikTok share is keyed by the
 * HANDLE, `tiktok:@jane`, exactly as Instagram is, with the same disclosed consequence: the share
 * follows the NAME. @see the header of `instagram.ts` and `ShareKeys.sol`.
 */
import { createHash, randomBytes } from 'node:crypto'

import type { Identity, IdentityProvider } from '../identity.ts'

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/'
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const USER_URL = 'https://open.tiktokapis.com/v2/user/info/'

/** ⚠ `user.info.profile` is what carries `username`. `user.info.basic` alone returns a display name
 *  and an opaque id, and a display name is not a handle anybody can be paid by. */
const SCOPES = 'user.info.basic,user.info.profile'

const base64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function tiktokProvider(clientKey: string, clientSecret: string): IdentityProvider {
  return {
    name: 'tiktok',
    label: 'TikTok',
    // ⛔ No public username lookup exists. @see the header.
    canLookup: false,

    begin(redirectUri) {
      const verifier = base64url(randomBytes(48))
      /* ⚠ TikTok wants the challenge as lower-case HEX, not base64url. Sent base64url it answers
         with a PKCE error that names neither the encoding nor the field. */
      const challenge = createHash('sha256').update(verifier).digest('hex')
      const state = randomBytes(24).toString('hex')

      const url = new URL(AUTHORIZE_URL)
      url.searchParams.set('client_key', clientKey)
      url.searchParams.set('scope', SCOPES)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', state)
      url.searchParams.set('code_challenge', challenge)
      url.searchParams.set('code_challenge_method', 'S256')
      return { url: url.toString(), state, verifier }
    },

    async complete(code, verifier, redirectUri) {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'cache-control': 'no-cache' },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          code: decodeURIComponent(code),
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code_verifier: verifier,
        }),
      })
      if (!res.ok) throw new Error(`TikTok refused the code exchange: ${res.status}`)
      const token = (await res.json()) as { access_token?: string; error_description?: string }
      if (!token.access_token) throw new Error(token.error_description ?? 'TikTok returned no access token')

      const me = await fetch(`${USER_URL}?fields=open_id,display_name,username,avatar_url`, {
        headers: { authorization: `Bearer ${token.access_token}` },
      })
      if (!me.ok) throw new Error(`TikTok refused the identity lookup: ${me.status}`)
      const body = (await me.json()) as {
        data?: { user?: { open_id?: string; display_name?: string; username?: string; avatar_url?: string } }
      }
      const user = body.data?.user
      if (!user?.username) throw new Error('TikTok returned no username')

      return {
        platform: 'tiktok',
        // ⛔⛔ The lower-cased handle. `open_id` is app-scoped and deliberately discarded.
        id: user.username.toLowerCase(),
        handle: user.username,
        name: user.display_name ?? user.username,
        avatar: user.avatar_url ?? null,
      }
    },

    async lookup() {
      return null
    },
  }
}
