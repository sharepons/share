import { useEffect, useRef } from 'react'
import { isAddress } from 'viem'
import { resolveHandle, type Account, type ProviderState } from '../lib/api.ts'
import { tryBeneficiary } from '../lib/beneficiary.ts'
import { PLATFORM_META, type Platform } from '../lib/platforms.ts'
import { PlatformSelect } from './PlatformSelect.tsx'
import { short } from '../lib/format.ts'
import { Avatar } from './Avatar.tsx'
import { PlatformIcon } from './Icons.tsx'

/**
 * One row of the split, and the small amount of machinery that turns a typed handle into something
 * the chain can be told.
 *
 * ## ⛔⛔ WHAT GOES ON CHAIN IS NOT WHAT WAS TYPED
 *
 * For X and GitHub the launch carries the ACCOUNT ID, resolved here, because a launch built from the
 * text `@alice` follows whoever holds that name later — so the day she renames, a stranger inherits
 * her fees. The handle is recorded beside it as a label and decides nothing.
 *
 * For Instagram and TikTok there is no such id available: neither platform will say who a username
 * belongs to until that person has authorised this app, which has not happened yet. Those rows go on
 * chain keyed by the handle, and the row says so, in the interface, every time.
 */
export type Row = {
  key: string
  platform: Platform
  /** Exactly what was typed. ⚠ Never sent to the contract for an id-keyed platform. */
  input: string
  bps: number
  resolved: Account | null
  state: 'idle' | 'checking' | 'found' | 'none' | 'no-lookup' | 'error'
  message?: string
}

export const newRow = (platform: Platform = 'x'): Row => ({
  key: Math.random().toString(36).slice(2),
  platform,
  input: '',
  bps: 0,
  resolved: null,
  state: 'idle',
})

/**
 * The account reference the contract is given, or null when the row cannot be launched yet.
 *
 * ⭐ A raw numeric id is accepted directly for X and GitHub. It is what the chain stores anyway, and
 * it is the only way to name an account on a deployment where handle lookup is switched off — which
 * on X is a prepaid balance that can run out mid-afternoon.
 */
export function accountRefOf(row: Row): string | null {
  const typed = row.input.trim()
  if (row.platform === 'wallet') return isAddress(typed) ? typed : null
  if (row.platform === 'x' || row.platform === 'github') {
    if (row.resolved) return row.resolved.id
    return /^[1-9][0-9]*$/.test(typed) ? typed : null
  }
  const clean = typed.replace(/^@/, '')
  return /^[A-Za-z0-9._]{1,30}$/.test(clean) ? clean : null
}

export const handleOf = (row: Row): string =>
  row.platform === 'wallet' ? '' : (row.resolved?.handle ?? row.input.trim().replace(/^@/, ''))

export function RecipientRow({
  row,
  index,
  providers,
  onChange,
  onRemove,
  canRemove,
}: {
  row: Row
  index: number
  providers: ProviderState[]
  onChange: (next: Row) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const meta = PLATFORM_META[row.platform]
  const provider = providers.find((p) => p.platform === row.platform)
  const canLookup = provider?.lookup ?? false

  /* ⚠⚠ DEBOUNCED, AND THE STALE ANSWER IS DISCARDED. Every X lookup is billed per call against a
     prepaid balance, so a request per keystroke is money. The sequence number is what stops a slow
     answer for "oct" overwriting the finished answer for "octocat". */
  const seq = useRef(0)
  useEffect(() => {
    if (row.platform === 'wallet' || !canLookup) return
    const typed = row.input.trim()
    if (!typed) {
      if (row.state !== 'idle') onChange({ ...row, state: 'idle', resolved: null, message: undefined })
      return
    }
    /* ⭐ A pasted numeric id needs no lookup: it is already the thing that goes on chain. */
    if ((row.platform === 'x' || row.platform === 'github') && /^[1-9][0-9]*$/.test(typed)) {
      if (row.state !== 'found') onChange({ ...row, state: 'idle', resolved: null, message: undefined })
      return
    }

    const mine = ++seq.current
    const timer = setTimeout(() => {
      onChange({ ...row, state: 'checking' })
      void resolveHandle(row.platform, typed).then((res) => {
        if (mine !== seq.current) return
        if (res.kind === 'found') onChange({ ...row, state: 'found', resolved: res.account, message: undefined })
        else if (res.kind === 'none') onChange({ ...row, state: 'none', resolved: null, message: undefined })
        else if (res.kind === 'no-lookup') onChange({ ...row, state: 'no-lookup', resolved: null, message: res.note })
        else onChange({ ...row, state: 'error', resolved: null, message: res.message })
      })
    }, 420)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.input, row.platform, canLookup])

  const ref = accountRefOf(row)
  const ben = ref ? tryBeneficiary(row.platform, ref) : null

  return (
    <div className="panel" style={{ padding: 14, background: 'var(--surface-2)' }}>
      <div className="rcp">
        <PlatformSelect
          value={row.platform}
          label={`Recipient ${index + 1} platform`}
          /* ⚠ Changing the platform clears the input and every resolution derived from it. A handle
             typed for one platform is not a handle on another, and a stale `resolved` would carry
             the previous account's id into the launch. */
          onChange={(p) =>
            onChange({ ...row, platform: p, input: '', resolved: null, state: 'idle', message: undefined })
          }
        />

        <input
          type="text"
          className={row.platform === 'wallet' ? 'mono' : undefined}
          aria-label={`Recipient ${index + 1}`}
          placeholder={
            row.platform === 'wallet' ? '0x…' : row.platform === 'github' ? 'username' : `${meta.prefix}handle`
          }
          value={row.input}
          onChange={(e) => onChange({ ...row, input: e.target.value })}
        />

        <div className="row" style={{ gap: 4 }}>
          <input
            type="number"
            className="mono"
            aria-label={`Recipient ${index + 1} share, percent`}
            min={0}
            max={100}
            step={0.01}
            value={row.bps === 0 ? '' : row.bps / 100}
            placeholder="0"
            onChange={(e) => {
              const pctValue = Number(e.target.value)
              /* ⚠ Stored as bps, the unit the contract takes. Keeping percent in state and
                 converting at submit is how a 33.33 becomes 3333 in one place and 3332 in another. */
              onChange({ ...row, bps: Number.isFinite(pctValue) ? Math.round(pctValue * 100) : 0 })
            }}
          />
          <span className="faint small">%</span>
        </div>

        <button type="button" className="rcp__del" onClick={onRemove} disabled={!canRemove} aria-label="Remove recipient">
          ×
        </button>

        <div className="rcp__state">
          {row.state === 'checking' && <span className="faint">checking…</span>}

          {row.state === 'found' && row.resolved && (
            <>
              <Avatar platform={row.platform} handle={row.resolved.handle} src={row.resolved.avatar} size="sm" />
              <span>
                {row.resolved.name}{' '}
                <span className="faint mono">
                  {/* ⭐ The ID IS THE POINT, so it is shown. This is what goes on chain, and what
                      makes the share survive a rename. */}
                  {meta.label} #{row.resolved.id}
                </span>
              </span>
            </>
          )}

          {row.state === 'none' && <span className="field__err">No {meta.label} account by that name.</span>}

          {row.state === 'no-lookup' && (
            <span className="chip chip--warn" title={row.message}>
              keyed by name — {meta.label} has no lookup
            </span>
          )}

          {row.state === 'error' && <span className="field__err">{row.message}</span>}

          {/* ⛔⛔ SAID ON EVERY HANDLE-KEYED ROW, EVERY TIME. It is the one real weakness in a share
              aimed at Instagram or TikTok, and it belongs where the decision is being made. */}
          {row.state === 'idle' && meta.keyedBy === 'handle' && row.input.trim() !== '' && (
            <span className="chip chip--warn">
              this share follows the name, not the account
            </span>
          )}

          {row.platform === 'wallet' && row.input.trim() !== '' && !isAddress(row.input.trim()) && (
            <span className="field__err">That is not an address.</span>
          )}

          {ben && (
            /* ⭐⭐ THE HASH, SHOWN BEFORE ANYTHING IS SIGNED. It is what the vault will pay, derived
               in this browser from the same string the contract builds. Anyone can check it. */
            <span className="faint mono" style={{ marginLeft: 'auto' }} title={ben}>
              {short(ben, 5)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export function PlatformHint({ platform }: { platform: Platform }) {
  return (
    <span className="pmark">
      <PlatformIcon platform={platform} />
      {PLATFORM_META[platform].label}
    </span>
  )
}
