import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { signInHref } from '../lib/api.ts'
import { PLATFORM_META, SOCIALS } from '../lib/platforms.ts'
import { useSession } from '../lib/session.tsx'
import { useWallet } from '../lib/wallet.tsx'
import { BioVerify, BioVerifyRow } from './BioVerify.tsx'
import { PlatformIcon } from './Icons.tsx'

/**
 * ⛔⛔ BOTH ACCOUNT PROVIDERS ARE ALWAYS LISTED, and the server decides which ones WORK.
 *
 * Showing only the configured ones made the dialog look like SHARE supports one service, which is a
 * claim about the product rather than about this deployment. Listing the other as a dead row that
 * says why is honest in a way that neither hiding it nor offering a broken button is:
 * `/api/auth/start/x` answers `no such provider` when X is not configured, and a row nobody can
 * click cannot reach that.
 *
 * ⛔⛔ ALL FOUR SOCIAL PLATFORMS, NOT JUST X AND GITHUB. This listed only two, on the reasoning that
 * Instagram and TikTok "have no sign-in to offer" — which confused two different things. What those
 * two lack is a HANDLE LOOKUP: no public endpoint turns `@jane` into an account, so a share aimed at
 * them is keyed by the lower-cased handle. Signing IN works exactly like the others — both providers
 * are fully implemented, return a username, and are how somebody proves an Instagram or TikTok share
 * is theirs. Omitting them left those recipients with no way to claim from the header at all.
 *
 * ⚠ Driven by `SOCIALS` so a platform added to the identity scheme appears here without being
 * remembered twice.
 */
const ACCOUNTS = SOCIALS

/**
 * The connect dialog: a wallet, an account, or both.
 *
 * ⚠⚠ TWO SECTIONS RATHER THAN TWO BUTTONS IN THE HEADER, because they are not alternatives and a
 * visitor should not have to work out which one they need. A wallet is who you are on chain and is
 * what launches a token; an X or GitHub account is who you are to a launch that pays you, because a
 * share is credited to `keccak256("x:12345")` and never to an address. Plenty of people want exactly
 * one of them, and somebody collecting fees may never launch anything at all.
 *
 * ⛔⛔ EIP-6963 FOR WALLETS, NEVER `window.ethereum`. With several extensions installed they fight
 * over that one property and whoever loaded last wins, so the site would silently pick a wallet FOR
 * the person — usually not the one holding their money. @see lib/eip6963.ts
 *
 * ## ⛔⛔ PORTALLED TO `document.body`, AND THAT IS A BUG FIX, NOT A PREFERENCE
 *
 * This is rendered from inside `<header class="hdr">`, and that header carries
 * `backdrop-filter: blur(14px)`. **`backdrop-filter` — like `transform`, `filter` and `perspective`
 * — makes an element a containing block for `position: fixed` descendants.** So `.scrim`, which is
 * `position: fixed; inset: 0`, resolved against the HEADER instead of the viewport: measured, it was
 * 1330x78 in a 1330x584 window. The dialog was centred inside a 78px strip, clipped by it, and the
 * page behind was dimmed only across the header.
 *
 * ➤ A portal takes it out of that subtree entirely, so no ancestor's styling can reach it. ⚠ Do not
 *   "simplify" this back to a plain return — the header's blur is not going anywhere, and the next
 *   `transform` added to any wrapper would reintroduce the same bug.
 */
export function WalletModal({ onClose }: { onClose: () => void }) {
  const { providers, connect, connecting, error } = useWallet()
  const { account, capabilities, refresh } = useSession()

  /* ⚠ Collapsed until asked for. The bio flow is a small form, and unfolded by default it would sit
     between the sign-in rows and push them off a phone screen for the people who do not need it. */
  const [bioOpen, setBioOpen] = useState(false)

  /* ⛔ The session arrives as an HttpOnly cookie this page cannot read, so a successful verification
     has to be learned by ASKING the server — the same way the OAuth return does it. */
  const onVerified = () => {
    setBioOpen(false)
    void refresh()
  }

  /* ⛔⛔ ESCAPE CLOSES IT, AND THAT IS LOAD-BEARING NOW THERE IS NO CLOSE BUTTON. Clicking the scrim
     is the only other way out, which is a mouse gesture on an unlabelled target — without this a
     keyboard visitor is shut inside the dialog with no exit at all. */
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const modal = (
    <div className="scrim" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Connect">
        {/* ⚠ Centred, with nothing beside it. A close button as a flex sibling would push this title
            off centre by exactly its own width. Escape and the scrim close the dialog. */}
        <div className="modal__head modal__head--center">
          <h3>Connect</h3>
        </div>

        <div className="modal__body">
          <div className="connect__group">
            <div className="connect__label">Wallet</div>

            {providers.length === 0 ? (
              <div className="note">
                No wallet announced itself to this page. Install one, or open the site in your
                wallet's own browser.
              </div>
            ) : (
              providers.map((p) => (
                <button
                  key={p.info.rdns}
                  className="pick"
                  disabled={connecting}
                  onClick={() => void connect(p).then(onClose).catch(() => undefined)}
                >
                  {p.info.icon ? <img src={p.info.icon} alt="" /> : <span className="av av--sm">{p.info.name.slice(0, 1)}</span>}
                  <span className="stack">
                    <span>{p.info.name}</span>
                    {/* ⚠ Labelled, because a wallet too old to announce itself is the only one
                        reached through the legacy object and the person should know which one they
                        picked. */}
                    {p.info.rdns === 'legacy.injected' && <span className="pick__sub">Detected the old way</span>}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="connect__group">
            <div className="connect__label">Account</div>

            {account ? (
              <div className="note note--good">
                Signed in as {account.handle} on {PLATFORM_META[account.platform].label}.
              </div>
            ) : (
              ACCOUNTS.map((name) => {
                const state = capabilities.providers.find((p) => p.platform === name)
                const label = state?.label ?? PLATFORM_META[name].label
                /* ⛔ `signin`, straight from the server. Nothing may offer a sign-in button off the
                   back of "the server answered" — that produces a control which fails with
                   `no such provider` every single time. */
                return state?.signin ? (
                  /* ⚠ A real link, not a button calling fetch. OAuth is a full page journey to the
                     provider and back, and the session arrives as an HttpOnly cookie this page is
                     not allowed to read — so it cannot be done in the background. */
                  <a key={name} className="pick" href={signInHref(name, window.location.pathname)}>
                    <span className="pick__icon"><PlatformIcon platform={name} /></span>
                    <span className="stack"><span>Continue with {label}</span></span>
                  </a>
                ) : state?.verify === 'bio' ? (
                  /* ⭐ Sign-in is not available for this platform on this deployment, but a handle
                     can still be PROVEN — a one-time code in the profile bio, read back publicly.
                     ⛔ Offered only because the SERVER said so, exactly like `signin`. */
                  <div key={name} className="stack" style={{ gap: 0 }}>
                    <BioVerifyRow open={bioOpen} onOpen={() => setBioOpen((v) => !v)} />
                    {bioOpen && <BioVerify onDone={onVerified} />}
                  </div>
                ) : (
                  <button key={name} className="pick" disabled>
                    <span className="pick__icon"><PlatformIcon platform={name} /></span>
                    <span className="stack">
                      <span>{label}</span>
                      <span className="pick__sub">
                        {capabilities.offline ? 'the server is unreachable' : 'not configured on this server yet'}
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {error && <div className="note note--bad" style={{ margin: '0 18px 18px' }}>{error}</div>}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
