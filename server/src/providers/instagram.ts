/**
 * Signing in with Instagram — "Instagram API with Instagram Login".
 *
 *   authorize  https://www.instagram.com/oauth/authorize
 *   token      POST https://api.instagram.com/oauth/access_token   (multipart/form-encoded)
 *   identity   GET  https://graph.instagram.com/v21.0/me?fields=id,username
 *
 * ⚠ The old Basic Display API was shut down in December 2024. Anything on the internet describing
 * `api.instagram.com/oauth/authorize` with `scope=user_profile` is describing a dead product.
 *
 * ## ⛔⛔ THE ID INSTAGRAM RETURNS IS SCOPED TO THIS APP, SO IT CANNOT BE THE KEY
 *
 * The `id` on `/me` is app-scoped: the same person signing into a different app gets a different
 * number, and there is no public endpoint that maps a username to it. Two consequences, and both are
 * load-bearing:
 *
 *   1. A launch cannot name an Instagram account by id, because nobody can look one up. So an
 *      Instagram share is keyed by the HANDLE — `instagram:@jane` — and the contract folds the case.
 *   2. Rotating this app's credentials to a different Meta app would change every id this provider
 *      has ever seen. Since nothing is keyed on them, that costs nothing here. It would have been
 *      catastrophic under an id-keyed design.
 *
 * ⚠⚠ WHAT IT COSTS: an Instagram share follows the NAME. If `@jane` renames and somebody else
 * registers `jane`, the new holder can sign in and claim it. This is disclosed on the launch form
 * and on the token page rather than buried here. @see ShareKeys.sol for the same note on chain.
 */
import { randomBytes } from 'node:crypto'

import type { Identity, IdentityProvider } from '../identity.ts'

const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize'
const TOKEN_URL = 'https://api.instagram.com/oauth/access_token'
const ME_URL = 'https://graph.instagram.com/v21.0/me'

/** ⚠ The narrowest scope that returns a username. Media scopes are not asked for and not wanted. */
const SCOPES = 'instagram_business_basic'

export function instagramProvider(clientId: string, clientSecret: string): IdentityProvider {
  return {
    name: 'instagram',
    label: 'Instagram',
    /* ⛔ FALSE, AND NOT BECAUSE IT IS UNIMPLEMENTED. Meta publishes no username-to-account endpoint
       for this product at all. The launch form reads this and says the share is keyed by name. */
    canLookup: false,

    begin(redirectUri) {
      const state = randomBytes(24).toString('hex')
      const url = new URL(AUTHORIZE_URL)
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', SCOPES)
      url.searchParams.set('state', state)
      return { url: url.toString(), state, verifier: '' }
    },

    async complete(code, _verifier, redirectUri) {
      /* ⚠⚠ Instagram appends `#_` to the code it hands back through the browser. Sent as-is the
         exchange fails with a generic "Invalid authorization code", which points at the app
         configuration rather than at a stray two characters. */
      const clean = code.replace(/#_$/, '')

      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code: clean,
        }),
      })
      if (!res.ok) throw new Error(`Instagram refused the code exchange: ${res.status}`)
      const token = (await res.json()) as { access_token?: string; error_message?: string }
      if (!token.access_token) throw new Error(token.error_message ?? 'Instagram returned no access token')

      const me = await fetch(`${ME_URL}?fields=id,username&access_token=${encodeURIComponent(token.access_token)}`)
      if (!me.ok) throw new Error(`Instagram refused the identity lookup: ${me.status}`)
      const body = (await me.json()) as { id?: string; username?: string }
      if (!body.username) throw new Error('Instagram returned no username')

      return {
        platform: 'instagram',
        /* ⛔⛔ THE LOWER-CASED HANDLE IS THE ID HERE. `body.id` is app-scoped and deliberately
           discarded: keying on it would make every share unclaimable the day this app changes. */
        id: body.username.toLowerCase(),
        handle: body.username,
        name: body.username,
        /* ⚠ No avatar. `profile_picture_url` needs a Business account and a wider permission than
           signing in justifies; the interface draws initials instead. */
        avatar: null,
      }
    },

    /** ⛔ Always null. There is no endpoint. Returning a made-up identity here would be a launch
     *  aimed at nobody. */
    async lookup() {
      return null
    },
  }
}
