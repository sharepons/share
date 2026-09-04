import { type ReactNode } from 'react'
import { DATA_DELETION, PRIVACY, TERMS } from '../lib/router.ts'
import { Link } from './Link.tsx'

/**
 * The privacy policy and the terms.
 *
 * ⛔⛔ EVERY FACTUAL CLAIM HERE WAS READ OUT OF THE SERVER, NOT DRAFTED FROM A TEMPLATE. The scopes,
 * the retention windows, the exact fields kept in a session and the fact that no access token is
 * ever stored all come from `server/src/` — see the citations in each section. A privacy policy that
 * describes a system nobody built is worse than none: it is a promise the code does not keep.
 *
 * ➤ SO THESE PAGES ARE PART OF THE SERVER'S API SURFACE. Change what is collected, retained, or
 *   requested as a scope, and change this in the same commit.
 *
 * ⚠ NOT LEGAL ADVICE AND NOT REVIEWED BY A LAWYER. It is an accurate description of what the
 * software does, which is the part an engineer can be responsible for.
 *
 * ⚠ Instagram App Review requires a privacy policy at a URL it can fetch, which is why these are
 * real routes and not anchors on another page. @see lib/router.ts
 */

const UPDATED = '4 September 2026'

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section legal">
      <div className="wrap">
        <header className="legal__head">
          <h2>{title}</h2>
          <p className="legal__updated">Last updated {UPDATED}</p>
        </header>
        <div className="legal__body">{children}</div>
        <nav className="legal__switch">
          <Link to={PRIVACY}>Privacy</Link>
          <span aria-hidden="true">·</span>
          <Link to={TERMS}>Terms</Link>
          <span aria-hidden="true">·</span>
          {/* ⚠ Reachable from both other pages on purpose: Meta's reviewer is given this URL
              directly, but a person looking for it will look on the privacy policy. */}
          <Link to={DATA_DELETION}>Deleting your data</Link>
        </nav>
      </div>
    </section>
  )
}

export function PrivacyPage() {
  return (
    <Page title="Privacy">
      <p className="legal__lede">
        Most of this site is a reader of a public blockchain. It talks to your wallet and to
        Robinhood Chain from your own browser, and there is no account to create. The parts that do
        involve a server are listed below in full.
      </p>

      <h3>What is stored, and for how long</h3>

      {/* ⚠ Fields and TTLs are `server/src/db.ts`. Do not round them off in prose. */}
      <ul>
        <li>
          <strong>A sign-in session.</strong> When you connect an X, GitHub, Instagram or TikTok
          account in order to claim, we keep the platform, your account id (for Instagram and TikTok,
          the lower-cased handle instead, because those platforms publish no id anybody else could
          resolve), your display name and the URL of your avatar. It is held on our own server and{' '}
          <strong>expires after 7 days.</strong> Signing out ends it immediately.
        </li>
        <li>
          <strong>A sign-in that is still in progress.</strong> While you are away at the provider we
          hold the platform, a random state value, the PKCE verifier and the page to return you to.{' '}
          <strong>Discarded after 15 minutes</strong>, or as soon as you come back.
        </li>
        <li>
          <strong>A TikTok bio verification, if you start one.</strong> The handle, the one-time code
          and the wallet address the code is bound to. Replaced if you try again, and it stops being
          useful the moment it is used.
        </li>
        <li>
          <strong>A token logo, if you upload one.</strong> Stored{' '}
          <strong>permanently and served publicly.</strong> This is not a choice we can reverse: the
          image's URL is written into the token's own contract when it is created, and that field has
          no setter. Deleting the file would break the token, for everyone, forever.
        </li>
      </ul>

      <h3>What we ask the platforms for</h3>

      <p>
        The narrowest scope each provider offers that still returns a username. We never request
        posting rights, your posts, your media, your followers, your email or your direct messages.
      </p>

      {/* ⚠ Straight from the SCOPES constants in server/src/providers/*.ts. */}
      <div className="legal__table">
        <div><span>GitHub</span><code>read:user</code></div>
        <div><span>X</span><code>users.read tweet.read</code></div>
        <div><span>Instagram</span><code>instagram_business_basic</code></div>
        <div><span>TikTok</span><code>user.info.basic, user.info.profile</code></div>
      </div>

      <p>
        {/* ⛔ True as written: the token is used for one identity request and never persisted. */}
        The access token a provider issues is used once, to read the identity above, and is then
        thrown away. It is never written to disk and never reused.
      </p>

      <h3>What we do not do</h3>

      <p>
        There is no analytics, no tracking pixel, no advertising and no third-party script of any
        kind on this site. Nothing about you is sold, shared or sent anywhere. The only cookie is the
        one that keeps you signed in, and while the site is in private preview, one that remembers
        you have the access code.
      </p>

      <h3>What is public and cannot be undone</h3>

      <p>
        A launch writes its split to a public contract. The accounts named in it — a handle or an
        account id, and the percentage — are visible to anybody, permanently, and are not ours to
        edit or remove. That is the point of the thing: it is what makes a share yours rather than a
        promise from us. But it means <strong>naming somebody in a split is publishing that name</strong>,
        and no request to us can take it back.
      </p>

      <p>
        We never take custody of funds and never hold a private key of yours. A claim is a
        transaction you sign in your own wallet.
      </p>

      <h3>Removing your data</h3>

      <p>
        Sign out, and the session is deleted; leave it, and it expires in seven days. There is
        nothing else about you on our server unless you uploaded a logo or started a bio
        verification. Anything already written to the blockchain cannot be deleted by us or by
        anybody else. <Link className="link" to={DATA_DELETION}>The full instructions are here.</Link>
      </p>

      <h3>Getting in touch</h3>

      <p>
        Open an issue on the{' '}
        <a className="link" href="https://github.com/sharepons/share" target="_blank" rel="noreferrer noopener">
          public repository
        </a>
        , or reach us on{' '}
        <a className="link" href="https://x.com/sharepons" target="_blank" rel="noreferrer noopener">
          X
        </a>
        . The whole site and server are open source, so you can check any of the above against the
        code rather than taking our word for it.
      </p>
    </Page>
  )
}

export function TermsPage() {
  return (
    <Page title="Terms">
      <p className="legal__lede">
        SHARE is software for creating a token on Pons and splitting its trading fees between
        accounts. It is not a bank, a broker, an exchange or an investment product, and nothing on
        this site is financial advice.
      </p>

      <h3>What the contracts do, and what we cannot do</h3>

      <p>
        A split is fixed when the token is created. The launchpad cannot change a percentage,
        redirect somebody's share, pause a payout or take control of fees after a launch — not as a
        policy, but because the contracts have no function that would do it and no owner who could
        call one. That protects you from us, and it equally means{' '}
        <strong>we cannot fix a mistake for you.</strong>
      </p>

      <h3>Things that are permanent</h3>

      <ul>
        <li>The split, once launched.</li>
        <li>
          The token's name, symbol and logo. Pons V2 writes them in the constructor and publishes no
          setter, so a typo is permanent and only a relaunch replaces it.
        </li>
        <li>The register of launches, which can be added to and never edited.</li>
      </ul>

      <h3>Being named in a split</h3>

      <p>
        Anybody can name any account as a recipient. It does not require that account's permission,
        and{' '}
        <strong>
          being named is not an endorsement by the person named — most of them have not been asked.
        </strong>{' '}
        A share accrues to them whether or not they ever appear.
      </p>

      <p>
        {/* ⛔⛔ The one weakness that could not be designed out. It is disclosed on the launch form
            and on every token page as well; this is the third place, deliberately. */}
        Shares aimed at X and GitHub are keyed to the account, so a rename does not move them.{' '}
        <strong>Instagram and TikTok shares are keyed to the handle</strong>, because neither
        platform publishes a way to resolve a username to an account. If such an account is renamed
        and somebody else registers the old handle, the new holder can claim that share. We could
        either refuse those platforms or say so plainly; we chose to say so.
      </p>

      <h3>What is not promised</h3>

      <ul>
        <li>
          <strong>That a token is worth anything.</strong> A token nobody trades earns no fees to
          share, and most tokens are not traded.
        </li>
        <li>
          <strong>That a recipient will ever claim.</strong> There is no expiry and no reclaim: a
          share credited to an account nobody signs in as simply waits.
        </li>
        <li>
          <strong>That the service stays up.</strong> Claiming a wallet share needs no server at all
          and works from a block explorer; a social claim needs a signature from a key we hold, and
          if that key is ever compromised the vault's owner can revoke it, which pauses social claims
          until a new one is in place.
        </li>
      </ul>

      <h3>Your responsibility</h3>

      <p>
        You are responsible for what you launch, for the accounts you name, for the tax and legal
        consequences where you live, and for keeping your own wallet safe. Do not use this to
        impersonate anybody or to imply an endorsement that does not exist.
      </p>

      <h3>No warranty</h3>

      <p>
        The software is provided as is, without warranty of any kind, and is used at your own risk.
        It is open source under the MIT licence — you can read every line of it, and you are welcome
        to check these claims against the code before trusting either.
      </p>
    </Page>
  )
}

/**
 * How to delete your data — the URL given to Meta as the **Data deletion request URL**.
 *
 * ⛔⛔ INSTRUCTIONS, NOT A CALLBACK, AND THAT IS A DELIBERATE PRIVACY CHOICE. Meta accepts either.
 * A callback receives an APP-SCOPED Instagram id, and `server/src/providers/instagram.ts` throws
 * that id away on purpose — a session here is keyed by the lower-cased handle, because no third
 * party can resolve an app-scoped id and so a share could never be *named* by one. To honour a
 * callback we would have to start storing a second identifier for every Instagram user, forever,
 * so that a seven-day cookie could be deleted a few days early. That is more data retained, not
 * less. @see server/src/providers/metaSignedRequest.ts, which spells the same reasoning out.
 *
 * ⚠ EVERY WINDOW AND FIELD BELOW IS READ OUT OF `server/src/db.ts`. Change a TTL there and change
 * it here in the same commit — @see the same rule at the top of this file.
 */
export function DataDeletionPage() {
  return (
    <Page title="Deleting your data">
      <p className="legal__lede">
        There is no account here to close. What this site keeps about you is a sign-in session and
        nothing else, it deletes itself, and you can delete it yourself at any moment. This page says
        exactly how, and is honest about the one thing nobody can delete.
      </p>

      <h3>Delete it yourself, right now</h3>

      <ul>
        <li>
          <strong>Sign out.</strong> The session is deleted from our server on the spot — not marked,
          not queued. That is the whole of it.
        </li>
        <li>
          <strong>Or do nothing.</strong> A session expires seven days after it was created and is
          swept, whether or not you ever come back.
        </li>
        <li>
          <strong>Or revoke us at the platform.</strong> Removing SHARE from your Instagram, X,
          GitHub or TikTok account settings stops any future sign-in. We hold no access token to
          revoke — the one issued during sign-in is used once, to read your username, and thrown
          away without ever being written to disk.
        </li>
      </ul>

      <h3>What there is to delete</h3>

      {/* ⚠ `server/src/db.ts` — the Session, Pending and BioClaim records, and nothing else. */}
      <ul>
        <li>
          <strong>A sign-in session:</strong> the platform, your account id or handle, your display
          name and avatar URL, and when it was created. Seven days.
        </li>
        <li>
          <strong>A sign-in handshake in flight,</strong> if you closed the tab mid-way. Fifteen
          minutes, then it is swept as abandoned.
        </li>
        <li>
          <strong>A bio verification,</strong> if you started one — the handle, the one-time code and
          the wallet it is bound to. Replaced by your next attempt, and it proves nothing once used.
        </li>
        <li>
          <strong>A logo file,</strong> if you uploaded one while launching a token.{' '}
          <strong>This one cannot be deleted</strong>, and it is not really yours: the URL is written
          into the token's constructor on a chain that publishes no setter for it, so deleting the
          file would break that token's image for everybody, permanently.
        </li>
      </ul>

      <h3>What cannot be deleted, by us or by anybody</h3>

      <p>
        A launch writes its split to a public blockchain. If an account of yours was named as a
        recipient — with or without your involvement — that name and that percentage are public,
        permanently, and no request to us can remove them. There is no delete function in the
        contracts and no owner who could call one. That is the same property that makes a share
        genuinely yours rather than a promise from us, and it cuts both ways.
      </p>

      <p>
        A share you never claim simply waits. There is no expiry and nothing accrues to us if you
        walk away.
      </p>

      <h3>Asking us</h3>

      <p>
        You should not have to, and there is unlikely to be anything left by the time we read it.
        But if you want a deletion confirmed, open an issue on the{' '}
        <a className="link" href="https://github.com/sharepons/share" target="_blank" rel="noreferrer noopener">
          public repository
        </a>{' '}
        or message us on{' '}
        <a className="link" href="https://x.com/sharepons" target="_blank" rel="noreferrer noopener">
          X
        </a>
        , and say which account. ⚠ Do not send a private key, a seed phrase or a password — nobody
        here will ever ask for one, and we cannot use one.
      </p>
    </Page>
  )
}
