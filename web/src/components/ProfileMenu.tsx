import { useEffect, useRef, useState } from 'react'
import { rhc } from '../lib/chain.ts'
import { short } from '../lib/format.ts'
import { PLATFORM_META } from '../lib/platforms.ts'
import { CLAIM, MINE, navigate, type Route } from '../lib/router.ts'
import { useSession } from '../lib/session.tsx'
import { useWallet } from '../lib/wallet.tsx'

/**
 * The header menu, for BOTH identities at once.
 *
 * ## ⛔⛔ THERE ARE TWO IDENTITIES AND NEITHER IMPLIES THE OTHER
 *
 *   - a **wallet** is who you are on chain. It launches tokens and it signs.
 *   - an **account** on X or GitHub is who you are to a launch that names you as a payee. A share is
 *     credited to `keccak256("x:12345")`, never to an address, so the account is the only thing that
 *     can prove a share is yours.
 *
 * Somebody can launch a token having never signed in, and somebody can be owed fees on ten launches
 * without holding the wallet that made any of them. So this must work with EITHER identity alone.
 * ⛔ The previous version returned a bare Connect button whenever no wallet was attached, which left
 * anybody signed in with GitHub to collect fees with nowhere to see it and no way to sign out.
 *
 * ⚠⚠ NOTHING IN HERE MOVES MONEY. Every item is a link, a read, or a sign out. A header dropdown is
 * the easiest thing on a page to open by accident, and it opens over whatever somebody was doing;
 * collecting fees is a page you navigate to and a transaction you sign there.
 */
export function ProfileMenu({ onOpenPicker, route }: { onOpenPicker: () => void; route: Route }) {
  const { address, onRightChain, disconnect, switchChain } = useWallet()
  const { account, signOut } = useSession()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  /* ⚠ Closed on navigation. Every item here navigates, and the menu is pinned to a sticky header —
     left open it hangs over the page somebody just asked to see. */
  useEffect(() => {
    setOpen(false)
  }, [route])

  /* Neither identity: one button, and the dialog behind it offers both. */
  if (!address && !account) {
    return (
      <button className="btn btn--sm" onClick={onOpenPicker}>
        Connect
      </button>
    )
  }

  /* ⚠ The wallet wins the trigger when both exist. It is the identity that SIGNS, so it is the one
     somebody needs to check before approving anything, and a handle sitting where an address should
     be is exactly the sort of thing people click straight through. */
  const label = address ? short(address) : account?.handle ?? ''

  const copy = () => {
    if (!address) return
    void navigator.clipboard?.writeText(address).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }

  const go = (to: string) => {
    navigate(to)
    setOpen(false)
  }

  return (
    <div className="menu" ref={box}>
      <button
        className={`btn btn--sm${address ? ' mono' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {/* ⚠ The wrong-network state is on the BUTTON, not hidden inside the menu. Everything that
            writes to the chain fails from here, and it fails as an opaque wallet error. */}
        {address && <span className={`dot${onRightChain ? '' : ' dot--warn'}`} />}
        {!address && account?.avatar && <img className="menu__avatar" src={account.avatar} alt="" />}
        <span className="trunc">{label}</span>
      </button>

      {open && (
        <div className="menu__pop" role="menu">
          {address && (
            <div className="menu__head">
              <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
                <span className="mono small">{short(address, 6)}</span>
                {/* ⚠ Beside the address rather than as a row further down — copying is about the
                    thing you are looking at, so it belongs next to it. */}
                <button className="menu__copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
              </div>
              {/* ⛔ Only shown when it is WRONG. Naming the correct chain under every address was
                  noise; naming the wrong one is the difference between a failing transaction and an
                  unexplained one. */}
              {!onRightChain && <div className="small" style={{ color: 'var(--bad)' }}>Wrong network</div>}
            </div>
          )}

          {account && (
            <div className="menu__head">
              <div className="row" style={{ gap: 8 }}>
                {account.avatar && <img className="menu__avatar" src={account.avatar} alt="" />}
                <span className="small trunc">{account.handle}</span>
              </div>
              <div className="small faint">on {PLATFORM_META[account.platform].label}</div>
            </div>
          )}

          {/* ⚠ Both of these are bound to an identity, which is why they live here and not in the
              main navigation: as top-level tabs they would be blank for almost every visitor. */}
          <button className="menu__item" role="menuitem" onClick={() => go(MINE)}>
            My tokens
          </button>
          <button className="menu__item" role="menuitem" onClick={() => go(CLAIM)}>
            Claim fees
          </button>

          <div className="menu__sep" />

          {/* ⚠ Whichever identity is MISSING is offered, rather than assuming somebody wants both. */}
          {!address && (
            <button className="menu__item" role="menuitem" onClick={() => { onOpenPicker(); setOpen(false) }}>
              Connect a wallet
            </button>
          )}

          {/* ⚠ The chain switch appears only when it is needed. It is the one item that fixes
              something the visitor cannot otherwise act on: on the wrong chain every read is empty
              and every transaction fails. */}
          {address && !onRightChain && (
            <button className="menu__item" role="menuitem" onClick={() => void switchChain().then(() => setOpen(false))}>
              Switch to {rhc.name}
            </button>
          )}

          {account && (
            <button className="menu__item menu__item--danger" role="menuitem" onClick={() => void signOut().then(() => setOpen(false))}>
              Sign out of {PLATFORM_META[account.platform].label}
            </button>
          )}
          {address && (
            <button className="menu__item menu__item--danger" role="menuitem" onClick={() => { disconnect(); setOpen(false) }}>
              Disconnect wallet
            </button>
          )}
        </div>
      )}
    </div>
  )
}
