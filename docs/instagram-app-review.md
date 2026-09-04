# Instagram App Review — the submission pack

**What this is:** everything Meta asks for in order to approve `instagram_business_basic`, written
out with the answers SHARE can actually give. It is public-safe on purpose — the one credential a
reviewer needs (the private-preview access code) is **not in this file**; it is in `HANDOFF.md`,
which is gitignored.

> ⛔ **Read the two blockers at the bottom before submitting.** One of them is not a code problem and
> cannot be fixed by anything in this repo.

---

## What the permission is for, in one paragraph

> SHARE lets somebody create a token whose trading fees are split between named accounts. A share
> can be aimed at an Instagram account, and that account's fees accumulate on a public blockchain
> whether or not the account holder ever hears about it. `instagram_business_basic` is used for
> exactly one thing: when that person comes to collect, they sign in with Instagram so we can read
> **their username**, and the server signs a statement that this browser is that account. The
> username is the only field used. No media, no insights, no followers, no messages. The access
> token is used once, during that sign-in, and discarded without being written to disk.

⭐ That paragraph is the "how does your app use this permission" answer. It is true — see
`server/src/providers/instagram.ts`, which requests `fields=id,username` and nothing else.

---

## App settings — field by field

| Field | Value |
|---|---|
| App icon | 1024×1024. ⛔ **Not yet produced** — see blockers. Source art is the glass `S` mark |
| App category | Business / Utility |
| Privacy Policy URL | `https://sharepons.family/privacy` |
| Terms of Service URL | `https://sharepons.family/terms` |
| **Data deletion request URL** | `https://sharepons.family/data-deletion` |
| **Deauthorize callback URL** | `https://sharepons.family/api/instagram/deauthorize` |
| Business email | the operator's |
| OAuth redirect URI | `https://sharepons.family/api/auth/callback/instagram` |

⭐ All three legal URLs are **prerendered to flat HTML** and served from the gate root, so they are
fetchable **while the rest of the site is still private**. That is the whole reason they exist as
files rather than as app routes — @see `web/scripts/build-legal-static.mjs`.

### ⛔⛔ Data deletion is an INSTRUCTIONS URL, not a callback, and that was a choice

Meta accepts either. We give instructions, because a deletion callback delivers an **app-scoped
Instagram user id** and `providers/instagram.ts` deliberately throws that id away — a session here
is keyed by the lower-cased handle, since no third party can resolve an app-scoped id and so a share
could never be *named* by one.

To service a callback we would have to start storing a second identifier for every Instagram user,
permanently, so that a **seven-day cookie** could be deleted a few days early. That is more data
retained, not less. ⛔ Do not "improve" this by adding the id to the session.

### ⭐ The deauthorize callback IS real, because that one is correct without an id

It verifies Meta's `signed_request` HMAC against the app secret and returns 200. It does not pretend
to delete a session it cannot identify — and it does not need to: the access token was already used
once and thrown away, so there is nothing left to revoke, and the session expires on its own.
@see `server/src/providers/metaSignedRequest.ts`, and `test/meta-signed-request.test.ts` for the
refusal cases.

⚠⚠ **It needed a hole in the gate to work at all.** Behind the private-preview gate, Caddy answers
every path with a static page, and `file_server` **refuses POST** — so Meta's callback received
`405 Method Not Allowed`, not a "site is private" answer. Confirmed with curl. `Caddyfile.share` now
routes that one path straight to the API, above the gate matcher. ⛔ It must stay above it.

---

## Reviewer test instructions

Paste this into the submission, with the access URL from `HANDOFF.md` substituted in step 1.

1. Open `https://sharepons.family/?key=<ACCESS CODE>`. The site is in private preview; this link
   sets a cookie and removes itself from the address bar. Every later step is a normal click.
2. Click **Claim** in the top navigation.
3. Under *Claim as a social account*, click **Continue with Instagram**.
4. Sign in with an Instagram **Business or Creator** account. ⛔ A personal account cannot complete
   this flow — Meta's own product requires it.
5. You are returned to the claim page. **The account's username is now displayed in the header**,
   next to the avatar initials. That username is the entirety of what the permission returned, and
   the only thing the app does with it.
6. The page lists any fee shares aimed at that username. It shows what is owed and lets the account
   holder withdraw it in a transaction they sign themselves.

⚠ Steps 1 and 6 are where a reviewer is most likely to get stuck. See the blockers.

## Screencast script

Record at 1280×720 or larger, in English, with the cursor visible.

| # | Show | Say (caption) |
|---|---|---|
| 1 | The claim page, signed out | "Fees on this site are split between named accounts. To collect, you prove which account you are." |
| 2 | Click Continue with Instagram | "We ask for `instagram_business_basic` and nothing else." |
| 3 | Instagram's consent screen, **full screen, unedited** | — |
| 4 | Back on the claim page, **zoom the header showing the username** | "This is the only field we read: the username. It is what a fee share is addressed to." |
| 5 | The list of shares for that username | "The username is matched against shares recorded on a public blockchain." |
| 6 | Click through a withdrawal | "The account holder signs the payout themselves. We never hold funds." |
| 7 | Sign out, then the header showing signed-out | "Signing out deletes the session immediately." |

⛔ Do **not** cut away from Meta's consent screen — reviewers check that the scopes shown match the
scopes requested.

---

## ⛔⛔ THE TWO BLOCKERS

### 1. The site is private, and Meta requires it to be testable

Meta's own submission checklist says to *"confirm your app can be loaded and tested externally"* and
to provide *"login credentials for reviewers to access your app"*. The private-preview gate means
the reviewer must be given `?key=<code>` — **the access code travels in a URL**, into Meta's review
tooling, and out of our control.

Three ways out, in order of preference:

1. **Open the site first.** Delete the `@ungated` matcher and its `handle` block, reload Caddy, then
   submit. Removes the problem entirely and is one edit. ⛔ `systemctl reload caddy`, never
   `caddy stop` — it takes all 32 vhosts down.
2. **Rotate the code immediately after review.** One line in `Caddyfile.share` and a reload; everyone
   currently inside is signed out, which is fine at this stage.
3. Submit with the code and accept that it is spent. Do not choose this without doing (2) after.

### 2. ⛔ There are zero launches, so a reviewer signs in and sees an empty page

`ShareLaunchpad.count()` is **0**. A reviewer completing step 6 above reaches *"Nothing is waiting
for this account right now"* — which is honest, and is a poor demonstration of a permission whose
whole justification is matching a username to something.

➤ **The strongest fix is to launch the first token with an Instagram handle in its split** before
submitting, so the reviewer's account — or a visible one — has a real balance to look at. That makes
the screencast show the permission doing its job instead of returning a name into a void.

⚠ This makes App Review **downstream of the first launch**, not independent of it. The first launch
is permanent and needs operator decisions (name, symbol, logo, pair asset, split) — @see
`HANDOFF.md`. Nothing in App Review should be submitted before that is settled.

### Also outstanding

- **App icon, 1024×1024** — not produced yet. Source is the glass `S` mark in the repo's logo assets.
- **Business verification** may be requested separately by Meta. It is not part of this submission
  and is an operator/identity process, not a code one.
- **Instagram sign-in is Development-mode only today**, so it works for accounts holding the
  Instagram Tester role and nobody else. That is what App Review changes.
