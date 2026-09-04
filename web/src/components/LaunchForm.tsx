import { useEffect, useMemo, useState } from 'react'
import { isAddress, parseUnits, type Address, type Hex } from 'viem'
import { publicClient, rhc, txUrl } from '../lib/chain.ts'
import { checkLogo } from '../lib/logo.ts'
import { LAUNCHPAD, LAUNCHPAD_ABI, LAUNCH_CONFIG_ID, isLive, previewEconomics, readFactoryState } from '../lib/launchpad.ts'
import { NATIVE, PAIR_ASSETS } from '../lib/pairs.ts'
import { PLATFORM_META, platformIndex } from '../lib/platforms.ts'
import { pct } from '../lib/format.ts'
import { tokenHref } from '../lib/router.ts'
import { useSession } from '../lib/session.tsx'
import { useWallet } from '../lib/wallet.tsx'
import { LogoField } from './LogoField.tsx'
import { RecipientRow, accountRefOf, handleOf, newRow, type Row } from './RecipientRows.tsx'
import { SplitBar } from './SplitBar.tsx'
import { Link } from './Link.tsx'

/**
 * The launch form.
 *
 * ## ⛔⛔ EVERYTHING ON THIS PAGE IS PERMANENT
 *
 * Pons V2 ships no setter for a token's name, symbol, logo, description or creator tax, and this
 * launchpad ships none for a split. There is no edit afterwards for anything here — so the form's
 * job is to refuse a launch that is wrong rather than to be quick to submit.
 *
 * ## ⚠⚠ THE ECONOMICS PIN IS FETCHED AT SUBMIT, NOT AT PAGE LOAD
 *
 * `expectedEconomics` is Pons's guard against the launch terms moving between a preview and a
 * signature. Fetched when the page opened, a form left in a tab overnight pins a stale value and the
 * launch reverts for a reason the launcher cannot see.
 */
export function LaunchForm({ minSocialBps, onLaunched }: { minSocialBps: number; onLaunched: () => void }) {
  const { address, walletClient, onRightChain, switchChain } = useWallet()
  const { capabilities } = useSession()

  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState('')
  const [logo, setLogo] = useState('')
  const [website, setWebsite] = useState('')
  const [twitter, setTwitter] = useState('')
  /* ⚠ Still sent in the launch params, as an empty string. Pons's `Socials` struct has a telegram
     field and the launch encodes it either way — only the INPUT was removed, so nothing about the
     transaction shape changed. */
  const [telegram] = useState('')
  const [pairToken, setPairToken] = useState<Address>(NATIVE)
  const [creatorTaxBps, setCreatorTaxBps] = useState(0)
  const [devBuy, setDevBuy] = useState('')
  /*
   * ⭐⭐ SNIPE TAX EXEMPTIONS — wallets that may buy in the launch's own seconds without paying it.
   *
   * ⛔⛔ THE TAX IS 99% AND IT DECAYS OVER THREE WALL-CLOCK SECONDS. Measured on the live curve: a
   * buy in the launch's own second pays 99%, ~7% one second later, ~1.2% at two, and the ordinary 1%
   * from three on. So an un-exempt wallet buying "immediately" loses essentially everything it sent.
   *
   * ⚠ The launcher's own atomic first buy needs NO entry here — the periphery route is already
   * exempt, verified on a fork. This is for OTHER wallets: a team address, a market maker, a second
   * device.
   */
  /* ⚠ One empty row from the start. An "Add an exemption" button with nothing under it hides what
     the control even is; a visible field says it takes an address. ⛔ An empty row is not an error —
     blanks are skipped by the validation and stripped before the transaction. */
  const [exempts, setExempts] = useState<string[]>([''])
  /* ⚠ ONE row to start. A wallet is just another choice in the row's own dropdown, so seeding a
     second row with it presented "an account and a wallet" as the shape of a launch — most launches
     name accounts only, and the extra row began life invalid (no address, no share). */
  const [rows, setRows] = useState<Row[]>([newRow('x')])

  const [factory, setFactory] = useState<{ enabled: boolean; fee: bigint; maxTax: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ token: Address; hash: Hex } | null>(null)

  useEffect(() => {
    /* ⚠ Block-bodied. A concise-body effect hands React the promise as a cleanup function and React
       19 renders a BLANK PAGE with no error — which passes every headless check. */
    void (async () => {
      try {
        setFactory(await readFactoryState())
      } catch {
        /* Left null. The submit button says the chain is unreachable rather than the form
           pretending it knows the launch fee. */
      }
    })()
  }, [])

  const pair = PAIR_ASSETS.find((p) => p.address === pairToken) ?? PAIR_ASSETS[0]!
  const totalBps = rows.reduce((a, r) => a + r.bps, 0)
  const socialBps = rows.filter((r) => r.platform !== 'wallet').reduce((a, r) => a + r.bps, 0)
  const nativePair = pairToken === NATIVE

  const segments = useMemo(
    () =>
      rows
        .filter((r) => r.bps > 0)
        .map((r) => ({ platform: r.platform, handle: handleOf(r) || '…', wallet: r.input, bps: r.bps })),
    [rows],
  )

  const problems = useMemo(() => {
    const out: string[] = []
    if (!name.trim()) out.push('The token needs a name.')
    if (!/^[A-Za-z0-9]{2,11}$/.test(symbol.trim())) out.push('A symbol is 2–11 letters or digits.')
    if (!checkLogo(logo).ok) out.push('The token image is not usable.')
    /* ⚠ Every exemption must be an address. A typo here is not caught on chain — Pons accepts any
       address, so a mistyped one silently exempts nobody and the intended wallet still pays 99%. */
    exempts.forEach((a, i) => {
      const v = a.trim()
      if (v !== '' && !isAddress(v)) out.push(`Snipe exemption ${i + 1} is not a valid address.`)
    })
    if (rows.length === 0) out.push('Name at least one recipient.')
    if (rows.length > 8) out.push('A launch can pay at most eight recipients.')

    const refs = new Set<string>()
    rows.forEach((r, i) => {
      if (r.bps <= 0) out.push(`Recipient ${i + 1} has no share.`)
      const ref = accountRefOf(r)
      if (!ref) {
        out.push(
          r.platform === 'wallet'
            ? `Recipient ${i + 1} is not a valid address.`
            : `Recipient ${i + 1} is not a ${PLATFORM_META[r.platform].label} account yet.`,
        )
        return
      }
      if (r.platform !== 'wallet' && !handleOf(r)) out.push(`Recipient ${i + 1} has no handle to show.`)
      const key = `${r.platform}:${ref.toLowerCase()}`
      /* ⚠ Caught here as well as on chain. Two rows for one person is not a harmless 70 + 30: the
         vault credits per beneficiary and the site renders per row, so neither number would be what
         they get — and the contract's revert costs a wallet round trip to say so. */
      if (refs.has(key)) out.push(`${PLATFORM_META[r.platform].label} ${handleOf(r) || ref} is named twice.`)
      refs.add(key)
    })

    if (totalBps !== 10_000) out.push(`The shares add up to ${pct(totalBps)}, and they have to be exactly 100%.`)
    if (socialBps < minSocialBps) {
      out.push(
        `Accounts hold ${pct(socialBps)} between them, and this launchpad requires at least ${pct(minSocialBps)}.`,
      )
    }
    if (creatorTaxBps > (factory?.maxTax ?? 500)) out.push('That creator tax is above what Pons allows.')
    return out
  }, [name, symbol, logo, rows, totalBps, socialBps, minSocialBps, creatorTaxBps, factory, exempts])

  const ready = problems.length === 0 && isLive() && Boolean(factory?.enabled) && Boolean(address) && onRightChain

  function even() {
    /* ⚠ The remainder goes to the FIRST row, the same rule the splitter uses for sub-unit dust, so
       what the form shows and what the chain does agree. */
    const n = rows.length
    if (n === 0) return
    const base = Math.floor(10_000 / n)
    setRows(rows.map((r, i) => ({ ...r, bps: i === 0 ? 10_000 - base * (n - 1) : base })))
  }

  async function submit() {
    if (!walletClient || !address) return
    setBusy(true)
    setError(null)
    try {
      const state = await readFactoryState()
      if (!state.enabled) throw new Error('Pons has launches switched off right now.')

      /* ⛔ Fetched NOW. A form left open pins a stale value and the launch reverts with an error the
         launcher cannot act on. */
      const economics = await previewEconomics(pairToken)

      const recipients = rows.map((r) => ({
        platform: platformIndex(r.platform),
        accountRef: r.platform === 'wallet' ? '' : accountRefOf(r)!,
        handle: handleOf(r),
        wallet: (r.platform === 'wallet' ? accountRefOf(r)! : '0x0000000000000000000000000000000000000000') as Address,
        bps: r.bps,
      }))

      const params = {
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        logo: logo.trim(),
        description: description.trim(),
        socials: { twitter: twitter.trim(), telegram: telegram.trim(), discord: '', website: website.trim(), farcaster: '' },
        /* ⚠ Ignored by the launchpad and overwritten with the splitter it creates. Passed as zero so
           nothing here looks like a way to redirect the fees. */
        creatorFeeRecipient: '0x0000000000000000000000000000000000000000' as Address,
        creatorTaxBps,
        buybackEnabled: false,
        expectedEconomics: economics,
        salt: randomSalt(),
      }

      const quoteIn = devBuy.trim() ? parseUnits(devBuy.trim(), pair.decimals) : 0n
      /* ⛔⛔ EXACT. `launchFee + quoteIn` for a native pair, `launchFee` alone otherwise. Anything
         else reverts `NativeValueMismatch`, and there is no slack and no tip. */
      const value = nativePair ? state.fee + quoteIn : state.fee

      const common = { address: LAUNCHPAD as Address, abi: LAUNCHPAD_ABI, account: address, value } as const

      /* ⚠ Simulated then written INSIDE each branch rather than once over a union. The two
         entrypoints have different argument tuples, and merging them first produces a request viem
         cannot type — which is a real distinction, not a nuisance: `launchWithBuy` is a different
         function selector reaching a different Pons entrypoint. */
      /*
        ⛔⛔ EXEMPTIONS REQUIRE `launchWithBuy` EVEN WITH NO DEVELOPER BUY. `ShareLaunchpad.launch`
        passes `_noExemptions()` and has no parameter for them, so the plain entrypoint simply cannot
        carry any. `launchWithBuy` with `quoteIn: 0` routes through `_launchOnPons`, which then picks
        Pons's FOUR-argument `launchToken` (`0xa72101af`) — the only overload that declares wallets on
        a launch with no atomic buy. An empty array is not the same calldata as no array.
        ⚠ Trimmed and de-duplicated: a repeated address is not an error on chain, it is just waste.
      */
      const exemptions = [...new Set(exempts.map((a) => a.trim()).filter((a) => a !== ''))] as Address[]

      let hash: Hex
      if (quoteIn > 0n || exemptions.length > 0) {
        const { request } = await publicClient.simulateContract({
          ...common,
          functionName: 'launchWithBuy',
          args: [
            params,
            LAUNCH_CONFIG_ID,
            pairToken,
            recipients,
            /* ⚠ A zero `minTokensOut` on a developer buy is a free sandwich. The floor is nominal
               here because the buy lands in the same transaction as the launch, at the curve's
               opening price, with nothing in between to move it. */
            { quoteIn, minTokensOut: 1n },
            exemptions,
          ],
        })
        hash = await walletClient.writeContract({ ...request, chain: rhc, account: address })
      } else {
        const { request } = await publicClient.simulateContract({
          ...common,
          functionName: 'launch',
          args: [params, LAUNCH_CONFIG_ID, pairToken, recipients],
        })
        hash = await walletClient.writeContract({ ...request, chain: rhc, account: address })
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      /* ⚠ The token address is read back out of the register rather than decoded from a log. This
         chain caps `eth_getLogs` at 2,000 blocks — about three minutes — and a receipt lookup that
         works today would break the moment a wallet is slow to broadcast. */
      const count = (await publicClient.readContract({
        address: LAUNCHPAD as Address, abi: LAUNCHPAD_ABI, functionName: 'count',
      })) as bigint
      const page = (await publicClient.readContract({
        address: LAUNCHPAD as Address, abi: LAUNCHPAD_ABI, functionName: 'page', args: [0n, 1n],
      })) as readonly { token: Address; creator: Address }[]

      const mine = count > 0n && page[0]?.creator.toLowerCase() === address.toLowerCase() ? page[0].token : null
      setDone({ token: (mine ?? '0x') as Address, hash: receipt.transactionHash })
      onLaunched()
    } catch (e) {
      setError(readable(e))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <section className="section">
        <div className="wrap" style={{ maxWidth: 720 }}>
          <p className="eyebrow">Launched</p>
          <h2>{name} is live, and its split is written in.</h2>
          <p className="lede">
            Nothing about who it pays can be changed now — not by you, not by this site, not by
            anybody holding any key.
          </p>
          <div className="row row--wrap" style={{ gap: 10, marginTop: 20 }}>
            {done.token !== '0x' && (
              <Link to={tokenHref(done.token)} className="btn btn--primary">Open the token page</Link>
            )}
            <a className="btn" href={txUrl(done.hash)} target="_blank" rel="noreferrer noopener">
              The transaction
            </a>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="section">
      <div className="wrap" style={{ maxWidth: 860 }}>
        <div className="head head--center">
          <h2>Launch a token</h2>
          <p className="lede">
            Launch a token and share the token fees to an X account, GitHub user, Instagram or
            TikTok handle.
          </p>
        </div>

        {factory && !factory.enabled && (
          <div className="note note--warn" style={{ marginBottom: 20 }}>
            <strong>Pons has launches switched off.</strong> That is a setting on Pons's own factory,
            not on this launchpad, and it can come back on at any time.
          </div>
        )}

        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="formgrid">
            <div className="field">
              <label htmlFor="f-name">Name</label>
              <input id="f-name" type="text" value={name} maxLength={48} onChange={(e) => setName(e.target.value)} placeholder="Share Coin" />
            </div>
            <div className="field">
              <label htmlFor="f-sym">Symbol</label>
              <input
                id="f-sym"
                type="text"
                className="mono"
                value={symbol}
                maxLength={11}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="SHARE"
              />
            </div>
          </div>

          <div className="field" style={{ marginTop: 18 }}>
            <label htmlFor="f-desc">Description ( Optional )</label>
            <textarea id="f-desc" value={description} maxLength={280} onChange={(e) => setDescription(e.target.value)} placeholder="A short description of the token" />
          </div>

          <div style={{ marginTop: 18 }}>
            <LogoField value={logo} onChange={setLogo} />
          </div>

          <div className="formgrid" style={{ marginTop: 18 }}>
            <div className="field">
              <label htmlFor="f-site">Website</label>
              <input id="f-site" type="text" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
            </div>
            <div className="field">
              <label htmlFor="f-x">X / Twitter</label>
              <input id="f-x" type="text" value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="https://x.com/…" />
            </div>
          </div>
        </div>

        {/* ── the split ────────────────────────────────────────────────────────────────────── */}
        <div className="panel" style={{ marginBottom: 18 }}>
          {/* ⚠ Centred heading with the action under it, rather than a heading pushed left by a
              button on the right — the same shape the rest of the page's cards use. */}
          <div style={{ marginBottom: 14, textAlign: 'center' }}>
            <h3>The fee split</h3>
            {/* ⚠ No `max-width`. At 62ch this sentence broke with "wallet." alone on a second line;
                it is one clause and reads as one line. It still wraps on a narrow screen, where a
                single line is not possible. */}
            <p className="small dim" style={{ margin: '6px 0 0' }}>
              Share the token fees to an X account, GitHub user, Instagram, TikTok handle or wallet.
            </p>
          </div>

          <div style={{ marginBottom: 16 }}>
            {/* ⛔ An empty bar when nothing is allocated. A placeholder segment filled the track and
                read as "all assigned" while the line under it said 0%. */}
            {/* ⚠ The readout sits ABOVE the bar and the action BELOW it: the number describes the bar
                it labels, and "Split evenly" is a thing you press after seeing where you are. */}
            <div className="small" style={{ marginBottom: 8, textAlign: 'center' }}>
              <span className={totalBps === 10_000 ? 'faint' : 'field__err'}>{pct(totalBps)} allocated</span>
            </div>
            <SplitBar segments={segments} size="lg" />
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <button type="button" className="btn btn--sm btn--ghost" onClick={even}>
                Split evenly
              </button>
            </div>
          </div>

          <div className="stack" style={{ gap: 10 }}>
            {rows.map((row, i) => (
              <RecipientRow
                key={row.key}
                row={row}
                index={i}
                providers={capabilities.providers}
                canRemove={rows.length > 1}
                onChange={(next) => setRows((rs) => rs.map((r) => (r.key === row.key ? next : r)))}
                onRemove={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
              />
            ))}
          </div>

          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <button
              type="button"
              className="btn btn--sm"
              disabled={rows.length >= 8}
              onClick={() => setRows((rs) => [...rs, newRow('x')])}
            >
              {/* ⛔ The cap is the contract's, not a preference: `ShareLaunchpad.MAX_RECIPIENTS` is 8
                  and a ninth reverts, so the button says so rather than failing on signing. */}
              {rows.length >= 8 ? 'Eight is the limit' : 'Add a recipient'}
            </button>
          </div>
        </div>

        {/* ── economics ────────────────────────────────────────────────────────────────────── */}
        <div className="panel" style={{ marginBottom: 18 }}>
          {/* ⚠ Centred on its own card, matching the page's centred headers. */}
          <h3 style={{ marginBottom: 12, textAlign: 'center' }}>Advanced</h3>
          <div className="formgrid">
            <div className="field">
              <label htmlFor="f-pair">Paired asset</label>
              <select id="f-pair" value={pairToken} onChange={(e) => setPairToken(e.target.value as Address)}>
                {PAIR_ASSETS.map((p) => (
                  <option key={p.address} value={p.address}>{p.symbol}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="f-tax">Creator tax</label>
              <div className="row" style={{ gap: 6 }}>
                <input
                  id="f-tax"
                  type="number"
                  className="mono"
                  min={0}
                  max={(factory?.maxTax ?? 500) / 100}
                  step={0.01}
                  value={creatorTaxBps === 0 ? '' : creatorTaxBps / 100}
                  placeholder="0"
                  onChange={(e) => setCreatorTaxBps(Math.round(Number(e.target.value) * 100) || 0)}
                />
                <span className="faint small">%</span>
              </div>
            </div>

            <div className="field">
              <label htmlFor="f-buy">Developer buy</label>
              <div className="row" style={{ gap: 6 }}>
                <input id="f-buy" type="number" className="mono" min={0} step="any" value={devBuy} placeholder="0" onChange={(e) => setDevBuy(e.target.value)} />
                <span className="faint small">{pair.symbol}</span>
              </div>
            </div>
          </div>

          {/* ── snipe tax exemptions ─────────────────────────────────────────────────────── */}
          <div className="exempt">
            <div className="exempt__head">
              <span className="exempt__title">Snipe tax exemptions</span>
              <span className="field__note">
                Wallets that may buy in the first seconds without paying the snipe tax.
              </span>
            </div>

            {exempts.map((addr, i) => (
              <div className="exempt__row" key={i}>
                <input
                  type="text"
                  className="mono"
                  placeholder="0x…"
                  value={addr}
                  aria-label={`Snipe exemption ${i + 1}`}
                  onChange={(e) => setExempts((xs) => xs.map((x, k) => (k === i ? e.target.value : x)))}
                />
                <button
                  type="button"
                  className="rcp__del"
                  aria-label={`Remove exemption ${i + 1}`}
                  onClick={() => setExempts((xs) => xs.filter((_, k) => k !== i))}
                >
                  ×
                </button>
              </div>
            ))}

            {/* ⚠ No `alignSelf` override — `.exempt` centres its children, and this was the one
                child opting out of it. */}
            <button type="button" className="btn btn--sm" onClick={() => setExempts((xs) => [...xs, ''])}>
              Add another
            </button>
          </div>

          <div className="row row--wrap" style={{ gap: 8, marginTop: 16 }}>
            {!nativePair && devBuy.trim() !== '' && (
              <span className="chip chip--warn">A first buy in {pair.symbol} needs an approval first</span>
            )}
          </div>
        </div>

        {/* ── submit ───────────────────────────────────────────────────────────────────────── */}
        {/* ⛔ NO CHECKLIST OF EVERY UNMET CONDITION. It rendered on a pristine form, so a launcher
            was met by eight warnings before typing anything and the page read as broken.
            ⚠ The validation itself is untouched: `problems` still gates `ready`, so the button stays
            disabled until the launch is actually valid, and the two live counters under the split
            (`% allocated`, `% to accounts`) still turn red on the spot. @see `problems` above. */}
        {error && <div className="note note--bad" style={{ marginBottom: 16 }}>{error}</div>}

        {/* ⚠ One centred wrapper around all three states, so the button does not shift sideways when
            it swaps between "connect", "switch chain" and the launch itself. */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {!address ? (
            <div className="note">Connect a wallet to launch.</div>
          ) : !onRightChain ? (
            <button className="btn btn--primary btn--lg" onClick={() => void switchChain()}>
              Switch to {rhc.name}
            </button>
          ) : (
            <button className="btn btn--primary btn--lg" disabled={!ready || busy} onClick={() => void submit()}>
              {busy ? 'Launching…' : 'Launch token'}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

function randomSalt(): Hex {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return `0x${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}` as Hex
}

/**
 * ⚠⚠ THE CONTRACT'S OWN ERROR NAME IS WORTH MORE THAN THE WALLET'S SENTENCE. Every custom error
 * this launchpad can raise is a specific thing the launcher did, and every one of them arrives from
 * a wallet as "execution reverted". Named here so the form can say which.
 */
function readable(e: unknown): string {
  const text = e instanceof Error ? `${e.message}` : String(e)
  if (/User rejected|denied transaction/i.test(text)) return 'You cancelled that in your wallet.'
  if (/SocialShareTooSmall/.test(text)) return 'Accounts hold less than this launchpad’s floor. Raise their share.'
  if (/BadSplit/.test(text)) return 'The shares do not add up to exactly 100%.'
  if (/DuplicateRecipient/.test(text)) return 'The same account is named twice.'
  if (/TooManyRecipients/.test(text)) return 'A launch can pay at most eight recipients.'
  if (/EmptyHandle/.test(text)) return 'Every account needs a handle to show beside it.'
  if (/NotNumericId/.test(text)) return 'X and GitHub shares are keyed by account id, and one of these is not one.'
  if (/BadHandleCharacter/.test(text)) return 'A handle is letters, digits, dots and underscores — no URL, no at-sign.'
  if (/PairTokenNotApproved/.test(text)) return 'Pons has not approved that pair asset.'
  if (/EconomicsMoved/.test(text)) {
    return 'Pons’s launch terms moved between the preview and your signature. Nothing was sent — try again.'
  }
  if (/LaunchesClosed/.test(text)) return 'Pons has launches switched off right now.'
  if (/NativeValueMismatch/.test(text)) return 'The value sent did not match the launch fee exactly. Nothing was sent.'
  if (/DevBuyUnavailable/.test(text)) return 'Pons has no periphery set, so a first buy cannot be settled atomically today.'
  if (/insufficient funds/i.test(text)) return 'That wallet does not hold enough to cover the launch fee and gas.'
  return text.split('\n')[0] ?? 'That did not go through.'
}
