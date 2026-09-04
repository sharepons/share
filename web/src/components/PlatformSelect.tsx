import { useEffect, useRef, useState } from 'react'
import { PLATFORM_META, PLATFORM_ORDER, type Platform } from '../lib/platforms.ts'
import { PlatformIcon } from './Icons.tsx'

/**
 * The recipient's platform picker.
 *
 * ## ⚠ WHY THIS IS NOT A `<select>`
 *
 * A native select opens the operating system's own menu — grey, square, in the system font, with a
 * tick column — which on this page sat beside a row of pills and looked like it belonged to another
 * application. It also cannot show each platform's icon, which is the fastest way to read the row.
 *
 * ⛔ THE COST OF LEAVING NATIVE IS THAT KEYBOARD SUPPORT IS NOW OURS TO PROVIDE, and this is a form
 * that signs a permanent transaction. So: Enter/Space/ArrowDown opens, arrows move, Enter or Space
 * chooses, Escape closes and returns focus to the trigger, Tab closes, and a click anywhere else
 * closes. `role="listbox"`/`option` with `aria-selected` and `aria-activedescendant` mirrors what the
 * native control announced.
 *
 * ⛔⛔ THE OPTIONS ARE IN `PLATFORM_ORDER`, NOT `PLATFORMS`. `PLATFORMS` is a wire format — its index
 * is the Solidity enum value sent on chain — so it must never be reordered for presentation.
 * @see lib/platforms.ts
 */
export function PlatformSelect({
  value,
  onChange,
  label,
}: {
  value: Platform
  onChange: (p: Platform) => void
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(() => Math.max(0, PLATFORM_ORDER.indexOf(value)))
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  /* ⚠ Reopening starts from what is currently chosen, not from wherever the arrows were left. */
  useEffect(() => {
    if (open) setActive(Math.max(0, PLATFORM_ORDER.indexOf(value)))
  }, [open, value])

  const choose = (p: Platform) => {
    onChange(p)
    setOpen(false)
    trigger.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false)
      if (e.key === 'Escape') trigger.current?.focus()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % PLATFORM_ORDER.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + PLATFORM_ORDER.length) % PLATFORM_ORDER.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(PLATFORM_ORDER.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const p = PLATFORM_ORDER[active]
      if (p) choose(p)
    }
  }

  const meta = PLATFORM_META[value]

  return (
    <div className="psel" ref={box} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        className={`psel__btn${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${meta.label}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="psel__icon"><PlatformIcon platform={value} /></span>
        <span className="psel__label">{meta.label}</span>
        <svg className="psel__caret" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
          <path d="M6.7 9.3 12 14.6l5.3-5.3 1.4 1.4L12 17.4 5.3 10.7z" />
        </svg>
      </button>

      {open && (
        <ul
          className="psel__pop"
          role="listbox"
          aria-label={label}
          aria-activedescendant={`${label}-${PLATFORM_ORDER[active]}`}
          tabIndex={-1}
        >
          {PLATFORM_ORDER.map((p, i) => (
            <li
              key={p}
              id={`${label}-${p}`}
              role="option"
              aria-selected={p === value}
              className={`psel__opt${i === active ? ' is-active' : ''}${p === value ? ' is-on' : ''}`}
              onMouseEnter={() => setActive(i)}
              /* ⚠ `onMouseDown`, not `onClick`. The outside-click listener runs on mousedown, so a
                 click handler would fire after the menu had already closed and choose nothing. */
              onMouseDown={(e) => { e.preventDefault(); choose(p) }}
            >
              <span className="psel__icon"><PlatformIcon platform={p} /></span>
              <span>{PLATFORM_META[p].label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
