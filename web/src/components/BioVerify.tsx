import { useState } from 'react'
import { checkBioVerify, startBioVerify } from '../lib/api.ts'
import { PLATFORM_META } from '../lib/platforms.ts'
import { PlatformIcon } from './Icons.tsx'
import { useWallet } from '../lib/wallet.tsx'

/**
 * Proving a TikTok handle by putting a one-time code in the profile bio.
 *
 * ## ⛔⛔ WHY THIS EXISTS ALONGSIDE SIGN-IN
 *
 * TikTok's Login Kit needs an approved app, and the scope carrying `username` — the only field a
 * TikTok share can be keyed on — is gated behind review. Until that clears, a `tiktok:@jane` share
 * accrues fees on chain that @jane cannot reach. This ends where sign-in ends: a session, and then
 * the ordinary claim.
 *
 * ⚠ It proves control of the account NOW, which is the same thing sign-in proves and exactly what
 * the key `tiktok:@jane` is worth. It does not make a handle-keyed share safe from a rename.
 *
 * ## ⛔ A WALLET FIRST, AND THAT IS NOT A FORMALITY
 *
 * The code goes into a PUBLIC bio. It is only safe because it is bound to one address: an onlooker
 * who copies it holds a string that can mint a claim to nobody but the person who asked for it.
 */
export function BioVerify({ onDone }: { onDone: () => void }) {
  const { address } = useWallet()
  const [handle, setHandle] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; kind: 'warn' | 'bad' } | null>(null)
  const [copied, setCopied] = useState(false)

  async function start() {
    if (!address) return
    setBusy(true)
    setNote(null)
    const out = await startBioVerify(handle, address)
    if ('error' in out) setNote({ text: out.error, kind: 'bad' })
    else {
      setCode(out.code)
      setConfirmed(out.handle)
    }
    setBusy(false)
  }

  async function check() {
    if (!address || !confirmed) return
    setBusy(true)
    setNote(null)
    const out = await checkBioVerify(confirmed, address)
    if (out.ok) {
      onDone()
    } else {
      /* ⛔ "Not there yet" is a nudge; anything else is a fault. Painting them the same way tells
         somebody whose code IS in place that they did it wrong. */
      setNote({ text: out.error, kind: out.pending ? 'warn' : 'bad' })
    }
    setBusy(false)
  }

  if (!address) {
    return (
      <div className="note" style={{ marginTop: 10 }}>
        Connect a wallet first. The code is tied to it, so nobody who sees it in your bio can use it.
      </div>
    )
  }

  return (
    <div className="stack" style={{ gap: 10, marginTop: 10 }}>
      {!code ? (
        <>
          <label className="small dim" htmlFor="bio-handle">
            Your {PLATFORM_META.tiktok.label} handle
          </label>
          <div className="row" style={{ gap: 8 }}>
            <input
              id="bio-handle"
              className="input mono"
              placeholder="@yourhandle"
              value={handle}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setHandle(e.target.value)}
              /* ⚠ Enter submits. This is one field and a button; making somebody reach for the
                 mouse to get past it is the kind of friction that reads as the form not working. */
              onKeyDown={(e) => {
                if (e.key === 'Enter' && handle.trim() && !busy) void start()
              }}
            />
            <button className="btn" disabled={busy || !handle.trim()} onClick={() => void start()}>
              {busy ? 'Working…' : 'Get a code'}
            </button>
          </div>
          <p className="small faint" style={{ margin: 0 }}>
            A profile link works too — paste it however it comes.
          </p>
        </>
      ) : (
        <>
          <p className="small dim" style={{ margin: 0 }}>
            Put this in the bio of <strong className="mono">@{confirmed}</strong>, save it on TikTok,
            then press Verify. You can take it out straight afterwards.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <input className="input mono" readOnly value={code} onFocus={(e) => e.currentTarget.select()} />
            <button
              className="btn btn--ghost"
              onClick={() => {
                /* ⚠ Never assume the write succeeded — clipboard access is refused outright in some
                   browsers, and a button that says "Copied" having copied nothing is worse than one
                   that does not offer to. */
                navigator.clipboard
                  ?.writeText(code)
                  .then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })
                  .catch(() => setNote({ text: 'Could not copy — select the code and copy it by hand.', kind: 'warn' }))
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" disabled={busy} onClick={() => void check()}>
              {busy ? 'Checking…' : 'Verify'}
            </button>
            <button
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => {
                setCode(null)
                setConfirmed(null)
                setNote(null)
              }}
            >
              Use a different handle
            </button>
          </div>
        </>
      )}
      {note && (
        <div className={`note note--${note.kind === 'warn' ? 'warn' : 'bad'}`}>{note.text}</div>
      )}
    </div>
  )
}

/** The row that opens it, styled like the sign-in rows it sits among. */
export function BioVerifyRow({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  return (
    <button className="pick" onClick={onOpen} aria-expanded={open}>
      <span className="pick__icon"><PlatformIcon platform="tiktok" /></span>
      <span className="stack">
        <span>Verify your {PLATFORM_META.tiktok.label} handle</span>
        {/* ⚠ Says what it will ask of them BEFORE they commit to it. "Continue with TikTok" would
            promise a sign-in that does not exist here yet. */}
        <span className="pick__sub">by putting a short code in your bio</span>
      </span>
    </button>
  )
}
