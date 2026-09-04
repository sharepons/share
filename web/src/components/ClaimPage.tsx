import { useCallback, useEffect, useState } from 'react'
import { isAddress, type Address } from 'viem'
import { signInHref } from '../lib/api.ts'
import { beneficiary } from '../lib/beneficiary.ts'
import { publicClient, rhc, txUrl } from '../lib/chain.ts'
import { claimAsWallet, claimWithAttestation, claimsPaused, owedAcross, totalsByAsset, type OwedRow } from '../lib/claims.ts'
import { amount, short } from '../lib/format.ts'
import { CLAIMS, claimsLive, type Launch } from '../lib/launchpad.ts'
import { PLATFORM_META, SOCIALS } from '../lib/platforms.ts'
import { tokenHref } from '../lib/router.ts'
import { useSession } from '../lib/session.tsx'
import { useWallet } from '../lib/wallet.tsx'
import { Avatar } from './Avatar.tsx'
import { PlatformIcon } from './Icons.tsx'
import { Link } from './Link.tsx'

/**
 * Taking what a launch already credited to you.
 *
 * ## ⛔⛔ THE MONEY IS ALREADY YOURS BEFORE THIS PAGE EXISTS
 *
 * Nothing here decides an amount. The splitter divided every fee on chain when it was swept, and the
 * vault has been holding your share under your account's key since. This page proves which account
 * you are and hands you a transaction.
 *
 * ➤ Which means the two failure modes people fear are not possible: this site cannot take it, and
 * this site going away does not lose it. A wallet share is claimable from a block explorer with no
 * help from anybody, and a social share needs only whoever holds the signing key — which the vault's
 * owner can rotate.
 */
export function ClaimPage({ launches, loading }: { launches: Launch[]; loading: boolean }) {
  const { account, capabilities, loading: sessionLoading, signOut } = useSession()
  const { address, walletClient, onRightChain, switchChain, openPicker } = useWallet()

  const [socialRows, setSocialRows] = useState<OwedRow[]>([])
  const [walletRows, setWalletRows] = useState<OwedRow[]>([])
  const [payTo, setPayTo] = useState('')
  const [busy, setBusy] = useState<'social' | 'wallet' | null>(null)
  const [hash, setHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)

  /* ⚠ Prefilled from the connected wallet, and still editable. A payout address chosen for somebody
     is a payout address nobody checked; a blank box on a page whose whole job is paying you is
     friction for no gain. */
  useEffect(() => { if (address && !payTo) setPayTo(address) }, [address, payTo])

  const refresh = useCallback(() => {
    void (async () => {
      setPaused(await claimsPaused())
      setSocialRows(account ? await owedAcross(launches, beneficiary(account.platform, account.id)) : [])
      setWalletRows(address ? await owedAcross(launches, beneficiary('wallet', address)) : [])
    })()
  }, [account, address, launches])

  useEffect(() => { refresh() }, [refresh])

  async function claim(kind: 'social' | 'wallet') {
    if (!walletClient || !address) return
    setBusy(kind)
    setError(null)
    try {
      const rows = kind === 'social' ? socialRows : walletRows
      const tx =
        kind === 'social'
          ? await claimWithAttestation(walletClient, address, rows, payTo.trim() as Address)
          : await claimAsWallet(walletClient, address, rows)
      await publicClient.waitForTransactionReceipt({ hash: tx })
      setHash(tx)
      refresh()
    } catch (e) {
      setError(readable(e))
    } finally {
      setBusy(null)
    }
  }

  const signInProviders = capabilities.providers.filter((p) => p.signin)

  return (
    <section className="section">
      <div className="wrap" style={{ maxWidth: 900 }}>
        {/* ⚠ Centred and without the dashed eyebrow, matching every other page header. That eyebrow
            leads with a left-edge rule, which drags a centred line off the page axis. */}
        <div className="head head--center">
          <h2>Claim your fees</h2>
          {/* ⚠ `maxWidth: none` overrides `p.lede`'s 62ch, which broke this one clause across two
              lines with "to you." stranded on the second. It still wraps on a narrow screen, where
              one line is not possible. */}
          <p className="lede" style={{ maxWidth: 'none' }}>
            Connect your X, GitHub, Instagram or TikTok account to claim any fees assigned to you.
          </p>
        </div>

        {!claimsLive() && (
          <div className="note note--warn" style={{ marginBottom: 20 }}>
            <strong>The vault is not deployed yet.</strong> Nothing can be claimed and nothing is owed.
          </div>
        )}
        {paused && (
          <div className="note note--warn" style={{ marginBottom: 20 }}>
            <strong>Claims are paused on the vault.</strong> Balances are untouched — funding is never
            pausable, only taking out — and this lifts with one transaction from its owner.
          </div>
        )}

        {/* ── the social half ──────────────────────────────────────────────────────────────── */}
        <div className="panel" style={{ marginBottom: 18 }}>
          {sessionLoading ? (
            <div className="skeleton" style={{ height: 60 }} />
          ) : !account ? (
            <>
              {/* ⚠ The HEADING is centred; the paragraph under it is not. Centred body copy gives
                  every line a different starting point and the eye loses its return. */}
              <h3 style={{ marginBottom: 6, textAlign: 'center' }}>Sign in</h3>
              <p className="small dim">
                We check who you are with the platform itself and sign a statement saying so. That
                statement carries no amount and cannot move anything on its own.
              </p>

              {capabilities.offline ? (
                <div className="note note--bad">
                  The sign-in service is unreachable from here. Every balance on this site is still
                  readable — it comes off the chain — but nothing can be claimed until it is back.
                </div>
              ) : signInProviders.length === 0 ? (
                <div className="note note--warn">
                  {/* ⛔ Two different facts, said differently. No provider CONFIGURED is not the same
                      as the server being down, and both look like a missing button. */}
                  No platform is wired up for sign-in on this deployment yet.
                </div>
              ) : (
                <div className="grid grid--4" style={{ marginTop: 14 }}>
                  {signInProviders.map((p) => (
                    <a key={p.platform} className="pick" href={signInHref(p.platform, '/claim')}>
                      <span className="pmark"><PlatformIcon platform={p.platform} /></span>
                      <span className="stack">
                        <span>{p.label}</span>
                        <span className="pick__sub">
                          {p.keyedBy === 'id' ? 'keyed by account' : 'keyed by handle'}
                        </span>
                      </span>
                    </a>
                  ))}
                </div>
              )}

              {SOCIALS.some((s) => !signInProviders.find((p) => p.platform === s)) && (
                <p className="small faint" style={{ marginTop: 14, marginBottom: 0 }}>
                  {/* ⚠ Named explicitly, because a launch can already have credited them. Their money
                      is not lost or waiting on a deadline — only the door is not open yet. */}
                  Not yet available here:{' '}
                  {SOCIALS.filter((s) => !signInProviders.find((p) => p.platform === s))
                    .map((s) => PLATFORM_META[s].label)
                    .join(', ')}
                  . Anything already credited to those accounts is untouched and stays claimable.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="spread" style={{ marginBottom: 16 }}>
                <div className="row" style={{ gap: 12 }}>
                  <Avatar platform={account.platform} handle={account.handle} src={account.avatar} size="lg" />
                  <div className="stack">
                    <strong>{account.name}</strong>
                    <span className="small faint mono">
                      {account.platform}:{account.id}
                    </span>
                  </div>
                </div>
                <button className="btn btn--sm btn--ghost" onClick={() => void signOut()}>Sign out</button>
              </div>

              <OwedList rows={socialRows} loading={loading} who="this account" />

              {socialRows.length > 0 && (
                <>
                  <div className="field" style={{ marginTop: 18 }}>
                    <label htmlFor="payto">Pay it to</label>
                    <input id="payto" type="text" className="mono" value={payTo} placeholder="0x…" onChange={(e) => setPayTo(e.target.value)} />
                    <span className="field__note">
                      Any address on {rhc.name}. It is bound into the signature, so nobody can redirect
                      it after you press the button.
                    </span>
                  </div>
                  <div className="row row--wrap" style={{ gap: 10, marginTop: 14 }}>
                    {!address ? (
                      /* ⛔⛔ A WALLET IS REQUIRED EVEN THOUGH THE SHARE IS KEYED TO THE ACCOUNT.
                         The vault credits `keccak256("x:12345")`, so signing in is what proves the
                         money is yours — but somebody still has to SEND the claim transaction and
                         pay its gas, and this site never sends anything on anybody's behalf.
                         ⚠ A button, not a chip. It said "connect a wallet" and gave nothing to press,
                         so the only route was back up to the header. */
                      <button className="btn btn--primary" onClick={openPicker}>
                        Connect a wallet to claim
                      </button>
                    ) : !onRightChain ? (
                      <button className="btn btn--primary" onClick={() => void switchChain()}>Switch to {rhc.name}</button>
                    ) : (
                      <button
                        className="btn btn--primary"
                        disabled={busy !== null || !isAddress(payTo.trim()) || !capabilities.claiming || paused}
                        onClick={() => void claim('social')}
                      >
                        {busy === 'social' ? 'Claiming…' : `Claim from ${socialRows.length} launch${socialRows.length === 1 ? '' : 'es'}`}
                      </button>
                    )}
                    {!capabilities.claiming && (
                      <span className="chip chip--warn">claiming is switched off on this deployment</span>
                    )}
                  </div>
                  <p className="small faint" style={{ marginTop: 10, marginBottom: 0 }}>
                    ⚠ You pay the gas, and the transaction is yours. This site never sends money.
                  </p>
                </>
              )}
            </>
          )}
        </div>

        {/* ── the wallet half ──────────────────────────────────────────────────────────────── */}
        <div className="panel">
          <h3 style={{ marginBottom: 6, textAlign: 'center' }}>Claim with your wallet</h3>
          <p className="small dim">
            {/* ⭐⭐ The path that needs nobody. A wallet's key is `keccak256("wallet:0x…")`, which the
                vault recomputes from the sender — no sign-in, no signature, no server. */}
            If a launch named your address directly, no sign-in is involved at all: the vault works
            out who you are from the transaction itself. This works from a block explorer too, with
            this site closed.
          </p>

          {!address ? (
            <div className="stack" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div className="note" style={{ width: '100%' }}>
                Connect a wallet to see whether anything is waiting for it.
              </div>
              <button className="btn btn--sm" onClick={openPicker}>Connect a wallet</button>
            </div>
          ) : (
            <>
              <OwedList rows={walletRows} loading={loading} who={short(address)} />
              {walletRows.length > 0 &&
                (onRightChain ? (
                  <button className="btn btn--primary" style={{ marginTop: 14 }} disabled={busy !== null || paused} onClick={() => void claim('wallet')}>
                    {busy === 'wallet' ? 'Claiming…' : 'Claim to this wallet'}
                  </button>
                ) : (
                  <button className="btn btn--primary" style={{ marginTop: 14 }} onClick={() => void switchChain()}>
                    Switch to {rhc.name}
                  </button>
                ))}
            </>
          )}
        </div>

        {error && <div className="note note--bad" style={{ marginTop: 18 }}>{error}</div>}
        {hash && (
          <div className="note note--good" style={{ marginTop: 18 }}>
            Paid out — <a className="link" href={txUrl(hash)} target="_blank" rel="noreferrer noopener">the transaction</a>.
          </div>
        )}

        <p className="small faint" style={{ marginTop: 26 }}>
          The vault is {claimsLive() ? <span className="mono">{short(CLAIMS, 6)}</span> : 'not deployed yet'}. Every
          balance on this page is a public read anybody can repeat.
        </p>
      </div>
    </section>
  )
}

function OwedList({ rows, loading, who }: { rows: OwedRow[]; loading: boolean; who: string }) {
  if (loading) return <div className="skeleton" style={{ height: 54, marginTop: 12 }} />

  if (rows.length === 0) {
    return (
      <div className="note" style={{ marginTop: 12 }}>
        {/* ⚠ "Nothing waiting" is not a fault and is not painted like one. It is also not the same
            sentence as "you are owed nothing" — a launch may exist that has not been swept yet. */}
        Nothing is waiting for {who} right now. A launch that has never been swept shows nothing here
        even when it has been earning.
      </div>
    )
  }

  const totals = totalsByAsset(rows)

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row row--wrap" style={{ gap: 8, marginBottom: 12 }}>
        {/* ⛔ One chip per asset, never one number. Two launches paired against different assets are
            two figures and adding them would be arithmetic on incomparable units. */}
        {totals.map((t) => (
          <span className="chip chip--on" key={t.asset}>
            {amount(t.total, t.decimals)} {t.symbol}
          </span>
        ))}
      </div>
      <div className="scroller">
        <table className="tbl">
          <thead>
            <tr>
              <th>Launch</th>
              <th className="num">Waiting for you</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.launch.token}>
                <td>
                  <Link className="link" to={tokenHref(r.launch.token)}>
                    {r.launch.name} <span className="faint mono">{r.launch.symbol}</span>
                  </Link>
                </td>
                <td className="num">
                  {amount(r.owed, r.launch.pairDecimals)} {r.launch.pairSymbol}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function readable(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  if (/User rejected|denied transaction/i.test(text)) return 'You cancelled that in your wallet.'
  if (/NothingOwed/.test(text)) return 'Nothing was owed by the time the transaction ran. Nothing was spent but gas.'
  if (/AttestationExpired/.test(text)) return 'That took long enough for the signature to expire. Press claim again.'
  if (/AttestationAlreadyUsed/.test(text)) return 'That signature was already used. Press claim again for a fresh one.'
  if (/BadSignature/.test(text)) {
    return 'The vault refused the signature. Its signing key may have been rotated — try again, and tell us if it keeps happening.'
  }
  if (/IsPaused/.test(text)) return 'Claims are paused on the vault right now. Your balance is untouched.'
  if (/insufficient funds/i.test(text)) return 'That wallet does not hold enough to pay the gas.'
  return text.split('\n')[0] ?? 'That did not go through.'
}
