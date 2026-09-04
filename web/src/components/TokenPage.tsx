import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import { addrUrl, publicClient, rhc, tokenUrl, txUrl } from '../lib/chain.ts'
import { createGraduatedPool, sweepAndHarvest } from '../lib/claims.ts'
import { BurnPanel } from './BurnPanel.tsx'
import { amount, ago, pct, short } from '../lib/format.ts'
import { resolveImage } from '../lib/logo.ts'
import { formatUsd } from '../lib/marketCap.ts'
import { PLATFORM_META, displayName } from '../lib/platforms.ts'
import { readToken, type TokenView } from '../lib/token.ts'
import { PHASE, isOperatorOnly } from '../lib/unswept.ts'
import { isPreview, previewToken } from '../lib/preview.ts'
import { CLAIM, EXPLORE } from '../lib/router.ts'
import { useWallet } from '../lib/wallet.tsx'
import { Avatar } from './Avatar.tsx'
import { ExternalIcon } from './Icons.tsx'
import { Link } from './Link.tsx'
import { SplitBar } from './SplitBar.tsx'

export function TokenPage({ address }: { address: Address }) {
  const [view, setView] = useState<TokenView | null>(null)
  const [loading, setLoading] = useState(true)
  /**
   * ⛔⛔ "COULD NOT READ" IS NOT "DOES NOT EXIST", AND CONFLATING THEM SHIPPED.
   * `readToken` returning null used to mean both, so a timeout or a rate limit rendered
   * "This launchpad did not create that token" — a permanent verdict about somebody's token,
   * produced by a network blip, on a page that had worked minutes earlier. Reported as the site
   * being broken. This state exists so the two can never share a screen again.
   */
  const [unreachable, setUnreachable] = useState(false)

  const load = useCallback(() => {
    /* ⚠ Block-bodied. A concise-body effect hands React a promise as a cleanup function, and React
       19 renders a blank page with no error. */
    /* ⛔ Short-circuits the chain read, exactly as the feed does. @see lib/preview.ts */
    if (isPreview()) {
      setView(previewToken())
      setLoading(false)
      return
    }
    void (async () => {
      setLoading(true)
      setUnreachable(false)
      try {
        setView(await readToken(address))
      } catch {
        /* ⛔ `readToken` now RETHROWS anything that is not a contract revert. Reaching here means
           the chain could not be read — never that the token is unknown. @see lib/token.ts. */
        setView(null)
        setUnreachable(true)
      } finally {
        setLoading(false)
      }
    })()
  }, [address])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <section className="section">
        <div className="wrap">
          <div className="skeleton" style={{ height: 200, borderRadius: 16 }} />
        </div>
      </section>
    )
  }

  /* ⛔⛔ CHECKED BEFORE THE "not a launch" SCREEN, because the difference matters more than the
     layout does. This says nothing about the token — only that we could not ask. */
  if (unreachable) {
    return (
      <section className="section">
        <div className="wrap">
          <div className="empty">
            <h3>Could not reach the chain</h3>
            <p className="mono small">{address}</p>
            <p>
              This says nothing about the token — the read failed before it could be answered. It is
              usually a moment of network trouble.
            </p>
            <button type="button" className="btn" onClick={load}>Try again</button>
          </div>
        </div>
      </section>
    )
  }

  if (!view) {
    return (
      <section className="section">
        <div className="wrap">
          <div className="empty">
            <h3>Not a launch from here</h3>
            {/* ⛔ The register is the gate. Rendering an unknown token with zeroes would show a
                launch paying nobody as though that were a fact about it. */}
            <p className="mono small">{address}</p>
            <p>
              This launchpad did not create that token, so it has no split recorded here and nothing on
              this page would be true about it.
            </p>
            <Link className="btn" to={EXPLORE}>Back to the launches</Link>
          </div>
        </div>
      </section>
    )
  }

  const img = resolveImage(view.logo)
  const segments = view.recipients.map((r) => ({ platform: r.platform, handle: r.handle, wallet: r.wallet, bps: r.bps }))

  return (
    <section className="section">
      <div className="wrap">
        {/* ⛔ Travels with the screenshot, same as the dashboard's. @see lib/preview.ts */}
        {isPreview() && (
          <div className="note note--warn" style={{ marginBottom: 20 }}>
            <strong>Preview.</strong> This token is fabricated for design review and does not exist
            on chain. Every figure below is invented.
          </div>
        )}
        <div className="tp__top">
          <div>
            <div className="tp__id">
              <span className="tp__logo">{img ? <img src={img} alt="" /> : <span className="faint">{view.symbol.slice(0, 2)}</span>}</span>
              <div className="stack">
                <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.7rem)' }}>{view.name}</h1>
                <div className="tp__sym">
                  {view.symbol} · launched {ago(view.launchedAt)} · paid in {view.pairSymbol}
                </div>
              </div>
            </div>

            {view.description && <p className="lede">{view.description}</p>}

            <div className="panel" style={{ marginTop: 22 }}>
              <div className="spread" style={{ marginBottom: 14 }}>
                <h3>Who this token earns for</h3>
                <span className="chip">{pct(view.socialBps)} to accounts</span>
              </div>
              <SplitBar segments={segments} size="lg" />
              <div style={{ height: 18 }} />
              <RecipientTable view={view} />
            </div>

            <SweepPanel view={view} onDone={load} />
          </div>

          <aside className="stack" style={{ gap: 16 }}>
            <div className="panel">
              <h4 style={{ marginBottom: 12 }}>Numbers</h4>
              <dl className="kv">
                <dt>Market cap</dt>
                <dd>{formatUsd(view.marketCapUsd) ?? '—'}</dd>
                <dt>Price</dt>
                <dd>{view.price === null ? '—' : `${view.price.toPrecision(4)} ${view.pairSymbol}`}</dd>
                <dt>Supply</dt>
                <dd>{amount(view.totalSupply, view.decimals, 0)}</dd>
                {/* ⛔ THREE STATES, NOT TWO. "Graduated" covering both 1 and 2 hides the one state
                    where the token does not trade at all and somebody needs to seed the pool. */}
                <dt>Phase</dt>
                <dd>
                  {view.phase === PHASE.onCurve
                    ? 'On the curve'
                    : view.phase === PHASE.swept
                      ? 'Graduated, pool not created'
                      : 'Trading in the pool'}
                </dd>
                <dt>Creator tax</dt>
                <dd>{pct(view.creatorTaxBps)}</dd>
              </dl>
            </div>

            <div className="panel">
              <h4 style={{ marginBottom: 12 }}>Fees</h4>
              <dl className="kv">
                {/* ⚠⚠ THREE DIFFERENT FACTS, NEVER ADDED TOGETHER. "Shared" has reached the vault and
                    is somebody's. "Taken out" has left it. "Waiting" is swept but not divided. A
                    single figure covering all three would be a promise dressed as a receipt. */}
                <dt>Shared</dt>
                <dd>{amount(view.shared, view.pairDecimals)} {view.pairSymbol}</dd>
                <dt>Taken out</dt>
                <dd>{amount(view.claimedOut, view.pairDecimals)} {view.pairSymbol}</dd>
                <dt>Waiting</dt>
                <dd>{amount(view.pending, view.pairDecimals)} {view.pairSymbol}</dd>
                {/* ⛔⛔ THE HOP THE OTHER THREE CANNOT SEE. Everything above is the escrow, which is
                    the LAST of three hops; fees sit on the curve — or, after graduation, in the meme
                    hook — until somebody sweeps, and the escrow reads a truthful ZERO the whole
                    time. A sibling project's biggest earner showed "nothing to collect" for days on
                    exactly this. Read from the source, so a zero here is a real zero. */}
                <dt>Not swept yet</dt>
                <dd>{amount(view.unswept.creatorShare, view.pairDecimals)} {view.pairSymbol}</dd>
              </dl>
              {/* ⛔⛔ THE MEMECOIN LEG IS NEVER ADDED TO THE ONE ABOVE. Different unit, and no
                  exchange rate exists until the swap actually happens inside the sweep. On the
                  sibling launch this leg was 1.46M tokens against 0.0178 ETH — a page showing only
                  the quote side was understating by more than half. */}
              {view.unswept.memePending > 0n && (
                <p className="small dim" style={{ margin: '10px 0 0' }}>
                  Plus {amount(view.unswept.memePending, view.decimals, 0)} {view.symbol} of fees paid
                  in the token itself. Pons converts that when it sweeps, so it cannot be added to the
                  figure above until it happens.
                </p>
              )}
              <p className="small faint" style={{ margin: '12px 0 0' }}>
                {view.unswept.where === 'none'
                  ? 'Nothing is waiting upstream. “Not swept yet” is read from the curve and the pool directly, so this zero is a real one.'
                  : 'Fees accrue ' +
                    (view.unswept.where === 'pool' ? 'in the pool' : 'on the curve') +
                    ' and only reach the figures above when somebody sweeps.'}
              </p>
            </div>

            <div className="panel">
              <h4 style={{ marginBottom: 12 }}>Addresses</h4>
              <dl className="kv">
                <dt>Token</dt>
                <dd><a className="link" href={tokenUrl(view.address)} target="_blank" rel="noreferrer noopener">{short(view.address, 6)}</a></dd>
                <dt>Splitter</dt>
                <dd><a className="link" href={addrUrl(view.splitter)} target="_blank" rel="noreferrer noopener">{short(view.splitter, 6)}</a></dd>
                <dt>Curve</dt>
                <dd><a className="link" href={addrUrl(view.curve)} target="_blank" rel="noreferrer noopener">{short(view.curve, 6)}</a></dd>
                <dt>Launcher</dt>
                <dd><a className="link" href={addrUrl(view.creator)} target="_blank" rel="noreferrer noopener">{short(view.creator, 6)}</a></dd>
              </dl>
            </div>
          </aside>
        </div>
      </div>
    </section>
  )
}

function RecipientTable({ view }: { view: TokenView }) {
  return (
    <div className="scroller">
      <table className="tbl">
        <thead>
          <tr>
            <th>Recipient</th>
            <th>Share</th>
            <th className="num">Credited</th>
            <th className="num">Taken</th>
          </tr>
        </thead>
        <tbody>
          {view.recipients.map((r, i) => {
            const meta = PLATFORM_META[r.platform]
            const label = displayName(r.platform, r.handle, r.wallet)
            return (
              <tr key={r.identity}>
                <td>
                  <div className="row" style={{ gap: 10 }}>
                    <i className={`swatch s${Math.min(i, 7) + 1}`} aria-hidden="true" />
                    <Avatar platform={r.platform} handle={r.handle || r.wallet} size="sm" />
                    {/* ⚠ `flex: 1` as well as `minWidth: 0`. Without it the column is sized to the
                        content's max-content width and every handle is ellipsised at ~90px while
                        350px of the cell sits empty beside it. */}
                    <div className="stack" style={{ minWidth: 0, flex: 1 }}>
                      <a
                        className="link trunc"
                        href={meta.profileUrl(r.platform === 'wallet' ? r.wallet : r.handle)}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {label} <ExternalIcon />
                      </a>
                      {/* ⭐⭐ THE IDENTITY STRING, IN FULL. `keccak256` of exactly this text is what
                          the vault pays. It is here so a recipient can verify the row is theirs
                          without trusting a word of the rest of this page. */}
                      <span className="faint mono small trunc" title={r.identity}>{r.identity}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="mono">{pct(r.bps)}</span>
                  {meta.keyedBy === 'handle' && (
                    <span className="chip chip--warn" style={{ marginLeft: 8 }} title="Instagram and TikTok publish no way to look up an account by name, so this share follows the handle.">
                      by name
                    </span>
                  )}
                </td>
                <td className="num">{amount(r.credited, view.pairDecimals)}</td>
                <td className="num">{amount(r.claimed, view.pairDecimals)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="small faint" style={{ marginTop: 12 }}>
        Amounts in {view.pairSymbol}. Anybody owed something here can take it from the{' '}
        <Link className="link" to={CLAIM}>claim page</Link> — including people who have never been to
        this site.
      </p>
    </div>
  )
}

/**
 * Moving a launch's fees from wherever Pons is holding them into the vault.
 *
 * ⭐ Permissionless, and deliberately in the interface rather than left to a cranker. Anybody can
 * pay the gas — including the recipient, who has the most reason to.
 */
function SweepPanel({ view, onDone }: { view: TokenView; onDone: () => void }) {
  const { address, walletClient, onRightChain } = useWallet()
  const [busy, setBusy] = useState(false)
  const [hash, setHash] = useState<string | null>(null)
  /** ⚠ Set when the harvest SUCCEEDED but a new sweep could not run. Not an error. */
  const [sweepNote, setSweepNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { unswept } = view
  /* ⛔ Phase 1 is not "blocked", it is a different job: the pool does not exist and the fix is to
     create it, which anybody may do. Phase 2 with no registered pool means the derivation did not
     check out and we will not act on it. */
  const needsPool = view.phase === PHASE.swept
  const noPool = view.phase === PHASE.inPool && !unswept.pool

  async function run() {
    if (!walletClient || !address) return
    setBusy(true)
    setError(null)
    try {
      const tx = await sweepAndHarvest(walletClient, address, {
        splitter: view.splitter,
        curve: view.curve,
        pairToken: view.pairToken,
        /* ⛔ The PHASE, not a boolean. `sweepCurve` reverts from phase 2 on and `sweepPool` has
           nothing to sweep before it, so the two must never be chosen by the same bool. */
        phase: view.phase,
        hook: unswept.pool?.hook ?? null,
        poolId: unswept.pool?.poolId ?? null,
      })
      await publicClient.waitForTransactionReceipt({ hash: tx.hash })
      setHash(tx.hash)
      /* ⚠ A skipped sweep is NOT a failure — the harvest ran and paid out. On a graduated launch it
         is the normal case, because only Pons's own sweeper may move a pool's fees. Saying so is
         what stops the next person reading a successful payout as a half-broken one. */
      setSweepNote(tx.swept === 'skipped' ? tx.sweepError : null)
      onDone()
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e)
      /* ⛔⛔ CLASSIFIED ON THE REVERT SELECTOR, NOT ON THE WORD "revert" IN A STRING. This branch
         used to answer every failed sweep with "there is nothing to move" — which on a graduated,
         actively traded pool is precisely wrong: `InternalSwapRequiresOperator()` means there IS
         money and Pons's own sweep is about to move it. Telling a recipient with real earnings that
         they have nothing is the exact failure this whole module exists to prevent.
         ⚠ viem renders an unknown custom error as bare hex with NO name, so a text match cannot
         see the difference. */
      setError(
        /User rejected/i.test(text)
          ? 'You cancelled that in your wallet.'
          : isOperatorOnly(e)
            ? 'Pons pays this one out itself. Some of the fees are held in the token rather than in ' +
              view.pairSymbol + ', and converting them is something only Pons’s sweeper can do — so ' +
              'it sweeps this pool on its own schedule, usually within the hour. Nothing is stuck and ' +
              'it needs nothing from you.'
            : /revert/i.test(text)
              ? 'There is nothing to move right now. Pons reverts a sweep that would collect nothing.'
              : text.split('\n')[0] ?? 'That did not go through.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function seedPool() {
    if (!walletClient || !address) return
    setBusy(true)
    setError(null)
    try {
      const tx = await createGraduatedPool(walletClient, address, view.address)
      await publicClient.waitForTransactionReceipt({ hash: tx })
      setHash(tx)
      onDone()
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e)
      setError(/User rejected/i.test(text) ? 'You cancelled that in your wallet.' : text.split('\n')[0] ?? 'That did not go through.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="spread row--wrap" style={{ gap: 12 }}>
        <div style={{ maxWidth: '52ch' }}>
          <h4>{needsPool ? 'Get this launch trading again' : 'Move the fees along'}</h4>
          <p className="small dim" style={{ margin: 0 }}>
            {needsPool
              ? 'This launch has graduated off its curve, but nobody has created its pool yet — so it ' +
                'is not trading and cannot earn. Anybody can create it; it needs nothing but gas.'
              : 'Sweeps this launch’s fees out of ' +
                (view.phase === PHASE.inPool ? 'the pool' : 'its curve') +
                ' and divides them between the recipients. Anybody can run it and it pays whoever it ' +
                'was always going to pay — you are only paying the gas.'}
          </p>
        </div>
        {address && onRightChain ? (
          needsPool ? (
            <button className="btn" disabled={busy} onClick={() => void seedPool()}>
              {busy ? 'Working…' : 'Create the pool'}
            </button>
          ) : (
            /* ⚠ Disabled only when there is genuinely nothing upstream, or when the pool id did not
               check out. ⛔ NOT disabled when the sweep is operator-only: pressing it then is
               harmless and the message it returns is the one worth reading. */
            <button className="btn" disabled={busy || noPool || unswept.where === 'none'} onClick={() => void run()}>
              {busy ? 'Working…' : 'Sweep and divide'}
            </button>
          )
        ) : (
          <span className="chip">Connect a wallet on {rhc.name}</span>
        )}
      </div>
      {/* ⛔⛔ SAID BEFORE THE BUTTON IS PRESSED, NOT ONLY AFTER IT FAILS. On an actively traded
          graduated pool this is the normal state, and a recipient should not have to spend gas on a
          reverting transaction to find out that the money is on its way.
          ⭐ "Paid automatically" is the point: the mechanism reads as money trapped behind somebody's
          goodwill unless the copy says plainly that it is routine. */}
      {unswept.where === 'pool' && !unswept.weMaySweep && (
        <div className="note" style={{ marginTop: 12 }}>
          <strong>Pons pays this one out itself.</strong> Some of the fees are held in {view.symbol}
          {' '}rather than {view.pairSymbol}, and converting them is something only Pons’s sweeper can
          do. It sweeps this pool on its own schedule — usually within the hour — and the money lands
          here the same way. Nothing is stuck and it needs nothing from you.
        </div>
      )}
      {noPool && (
        <div className="note note--warn" style={{ marginTop: 12 }}>
          This launch is trading in a pool, but we could not confirm which one — so nothing here will
          act on a guess. {view.symbol} is safe; only this button is unavailable.
        </div>
      )}
      {error && <div className="note note--bad" style={{ marginTop: 12 }}>{error}</div>}
      {hash && (
        /* ⛔⛔ "Done — the transaction." WAS NOT ENOUGH, AND THE COST WAS REAL. This step moves fees
           INTO the vault; it does not pay anybody. Somebody who ran it and then watched their
           balance stay at zero concluded the whole product was broken, when their money was sitting
           credited and one click away on a DIFFERENT page. A success message that does not name the
           next step is a dead end. ⚠ Say where the money is and link to it. */
        <div className="note note--good" style={{ marginTop: 12 }}>
          <strong>Divided.</strong> The fees are credited to the recipients now —{' '}
          <Link className="link" to={CLAIM}>claim what you are owed</Link>. This step only moved the
          money into the vault; taking it out is a second transaction.{' '}
          <a className="link" href={txUrl(hash)} target="_blank" rel="noreferrer noopener">The transaction</a>.
          {sweepNote && (
            <>
              {' '}⚠ Fees still sitting in the pool were not pulled in — only Pons&rsquo;s own sweeper
              can move those, and it usually runs within the hour. Nothing is stuck.
            </>
          )}
        </div>
      )}

      {/* ⛔ Renders as NOTHING for every wallet but one, and is last on the page on purpose: the
          only irreversible control here should never sit above the ones that just move money.
          @see lib/burn.ts — a visibility gate, not a permission. */}
      <BurnPanel token={view.address} symbol={view.symbol} />
    </div>
  )
}
