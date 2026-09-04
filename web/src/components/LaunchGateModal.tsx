import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { GATE_MESSAGE } from '../lib/launchGate.ts'

/**
 * What a wallet that is not the first launcher sees when it presses **Launch token**.
 *
 * ⚠⚠ IT IS A DIALOG, NOT A DISABLED BUTTON, AND THAT WAS THE POINT. A greyed-out button with no
 * explanation is the same experience as a broken site: nothing happens, and the visitor is left to
 * guess whether the fault is theirs. The click is allowed to land and is answered in words.
 *
 * ⛔⛔ PORTALLED TO `document.body`, for the same reason `WalletModal` is — `.scrim` is
 * `position: fixed`, and any ancestor carrying `transform`, `filter`, `perspective` or
 * `backdrop-filter` becomes its containing block and clips it to that element's box. The launch form
 * has none today. Relying on that is relying on nobody ever adding one. @see WalletModal.tsx, where
 * exactly that bug was found and measured.
 *
 * ⚠ Reuses `.scrim` / `.modal` from styles.css rather than introducing a second dialog look. If the
 * modal styling changes, this changes with it, which is correct.
 */
export function LaunchGateModal({ onClose }: { onClose: () => void }) {
  const okRef = useRef<HTMLButtonElement>(null)

  /* ⛔ ESCAPE CLOSES IT. There is one button, and a dialog a keyboard user cannot dismiss without
     finding it is a trap — the same rule the connect dialog follows. */
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  /* ⚠ Focus moves INTO the dialog on open. Without it the focus ring is left behind on the launch
     button underneath, so Enter re-presses the very button that opened this. */
  useEffect(() => {
    okRef.current?.focus()
  }, [])

  const modal = (
    <div className="scrim" onClick={onClose} role="presentation">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        /* ⚠ `alertdialog` and labelled BY the heading, not with a duplicate string: a screen reader
           announcing "Launching is not available yet" twice is how a hand-written aria-label reads
           when the visible text already says it. */
        aria-labelledby="launch-gate-title"
        aria-describedby="launch-gate-body"
      >
        <div className="modal__head modal__head--center">
          <h3 id="launch-gate-title">{GATE_MESSAGE}</h3>
        </div>

        <div className="modal__body">
          {/* ⚠ Says WHEN, not just no. "Not available yet" on its own reads as broken; naming the
              condition that lifts it makes it a queue rather than a wall. ⛔ It does not name the
              wallet that may launch — that address is in a public repo and does not need repeating
              to every visitor who presses a button. */}
          <p id="launch-gate-body" className="note">
            The first token from this launchpad has not been created yet. Launching opens to everyone
            as soon as it has — there is no list to join and nothing to wait for here.
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
            <button ref={okRef} className="btn btn--primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
