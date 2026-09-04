import { useEffect, useState } from 'react'
import { formatUnits, type Address } from 'viem'
import { useWallet } from '../lib/wallet.tsx'
import { canSeeBurn, checkBurnAmount, readBurnState, burnTokens, burnedSupplyDrop } from '../lib/burn.ts'
import { txUrl } from '../lib/chain.ts'

/**
 * Burn tokens you hold.
 *
 * ⛔⛔ THE ONLY IRREVERSIBLE CONTROL ON THIS SITE. Nothing else here destroys anything, so this is
 * deliberately the least convenient thing on the page: the amount is typed, the word BURN is typed,
 * and the button says what will happen rather than "Confirm".
 *
 * ⚠ Shown only to one wallet — a VISIBILITY gate, not a permission. `burn` destroys the caller's
 * own tokens and can never touch anybody else's, and the repo is public, so there is nothing hidden
 * here. @see lib/burn.ts.
 */
export function BurnPanel({ token, symbol }: { token: Address; symbol: string }) {
  const { address, walletClient } = useWallet()
  const [state, setState] = useState<{ balance: bigint; totalSupply: bigint; decimals: number } | null>(null)
  const [amount, setAmount] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ tx: string; dropped: string } | null>(null)

  const visible = canSeeBurn(address)

  useEffect(() => {
    if (!visible || !address) return
    let live = true
    readBurnState(token, address as Address)
      .then((s) => { if (live) setState(s) })
      .catch(() => { if (live) setErr('Could not read your balance.') })
    return () => { live = false }
  }, [visible, address, token, done])

  /* ⛔ Rendered as nothing at all for everybody else — not disabled, not hidden with CSS. */
  if (!visible) return null

  const check = state ? checkBurnAmount(amount, state.balance, state.decimals) : null
  /* ⚠ Typing the word is the second gate. An amount alone is one slip away from a burn. */
  const armed = Boolean(check?.ok) && confirm.trim().toUpperCase() === 'BURN' && !busy && Boolean(walletClient)

  async function run() {
    if (!state || !check?.ok || !walletClient || !address) return
    setBusy(true)
    setErr(null)
    try {
      const supplyBefore = state.totalSupply
      const tx = await burnTokens(walletClient, address as Address, token, check.wei)
      /* ⛔⛔ VERIFIED BY THE SUPPLY FALLING, never by tokens moving. A sibling project sent 29.37M
         to 0xdEaD, called it a burn, and its totalSupply reads 1,000,000,000 to this day. */
      const dropped = await burnedSupplyDrop(token, supplyBefore)
      if (dropped <= 0n) {
        setErr('The transaction went through but total supply did not fall. That is NOT a burn — do not report it as one.')
      } else {
        setDone({ tx, dropped: formatUnits(dropped, state.decimals) })
        setAmount('')
        setConfirm('')
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The burn failed. Nothing was destroyed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel burn">
      <h2 className="burn__title">Burn {symbol}</h2>
      <p className="burn__lede">
        Destroys tokens you hold and lowers the total supply. It cannot be undone, and nobody can
        reverse it for you.
      </p>

      {state && (
        <p className="burn__bal">
          You hold <strong>{formatUnits(state.balance, state.decimals)}</strong> {symbol} of{' '}
          {formatUnits(state.totalSupply, state.decimals)} total.
          {' '}
          <button type="button" className="link" onClick={() => setAmount(formatUnits(state.balance, state.decimals))}>
            Burn all of it
          </button>
        </p>
      )}

      <label className="burn__label" htmlFor="burn-amount">Amount in {symbol}</label>
      {/* ⚠ TOKENS, never wei. Typing a token count into a wei field burns effectively nothing and
          looks like the burn silently failed; the reverse is catastrophic. @see checkBurnAmount. */}
      <input
        id="burn-amount"
        className="mono"
        inputMode="decimal"
        placeholder="0.0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      {amount.trim() !== '' && check && !check.ok && <p className="field__err">{check.error}</p>}

      <label className="burn__label" htmlFor="burn-confirm">Type BURN to confirm</label>
      <input
        id="burn-confirm"
        className="mono"
        placeholder="BURN"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />

      <button type="button" className="btn btn--danger" disabled={!armed} onClick={run}>
        {busy
          ? 'Burning…'
          : check?.ok
            ? `Burn ${check.display} ${symbol} forever`
            : `Burn ${symbol} forever`}
      </button>

      {err && <p className="field__err">{err}</p>}
      {done && (
        <p className="burn__done">
          Burned. Total supply fell by <strong>{done.dropped}</strong> {symbol}.{' '}
          <a className="link" href={txUrl(done.tx)} target="_blank" rel="noreferrer noopener">View transaction</a>
        </p>
      )}
    </div>
  )
}
