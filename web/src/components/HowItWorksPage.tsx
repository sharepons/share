import { useEffect, useRef } from 'react'
import { PlatformIcon } from './Icons.tsx'
import { PLATFORM_META, PLATFORM_ORDER } from '../lib/platforms.ts'

/**
 * How it works — the operator's copy, verbatim.
 *
 * ⛔⛔ THE WORDS ON THIS PAGE ARE SUPPLIED, NOT AUTHORED HERE. They were handed over as a finished
 * document on 4 Sep 2026 and replaced a much longer page. Do not "improve" a sentence in passing:
 * this is the one place the product explains itself, and the previous version was edited by three
 * different passes until the launch form and this page disagreed about what a split could contain.
 * If a fact here goes stale, change the fact with the operator, then change the sentence.
 *
 * ⚠ WHAT WENT MISSING WITH THE REWRITE, DELIBERATELY: the old page carried the disclosure that an
 * Instagram or TikTok share follows the HANDLE and can be inherited by whoever registers the name
 * next. That disclosure still stands on the launch form and on every token page — it is only this
 * third copy of it that is gone. @see lib/platforms.ts, which is where the rule actually lives.
 *
 * ## The shape
 *
 * A lede, four numbered steps on a single rail, and a closing panel — and nothing after it. ⛔ There
 * was a "Launch a token" button at the end; the operator removed it. The nav carries Launch on every
 * page, so the page ends on the guarantee rather than on a pitch. The rail is the whole design
 * idea: one continuous vertical line threading four numbered discs, so the eye is never asked where
 * to go next. Everything else on the page is deliberately quiet so that line is the only structure.
 *
 * ⛔ THE STEP IS A THREE-COLUMN GRID — disc, title, prose — and the title is a SIBLING of the body,
 * not a child of it. A single centred text column left ~570px of the page empty on either side and
 * read as a narrow strip of text adrift in a wide layout. Widening that one column instead is not
 * the fix: it just trades dead margins for 90-character lines. @see styles.css.
 */

/** The four steps. Titles carry no number — `.hiw__disc` draws it, so the two can never disagree. */
const STEPS: { title: string; body: string[] }[] = [
  {
    title: 'Set your split',
    body: [
      'Choose who should receive the fees and how much each recipient should receive.',
      'You can split the fees between multiple accounts and assign a percentage to each one. The total split must always equal 100%.',
      'Recipients do not need to have a SHARE account or even a wallet when the token is launched. Their share simply accrues until they claim it.',
    ],
  },
  {
    title: 'Launch the token',
    body: [
      'When you launch, SHARE creates a custom fee contract containing your split and deploys the token on Pons with that contract set as its fee recipient.',
      'Everything happens in a single transaction. If any part of the launch fails, the entire transaction reverts.',
      'Once the token is live, the fee split cannot be changed.',
    ],
  },
  {
    title: 'Fees are distributed automatically',
    body: [
      'As the token trades, creator fees accumulate on Pons.',
      'When fees are collected, the contract distributes them according to the split defined at launch. Each recipient receives their own balance, completely separate from everyone else\u2019s.',
      'There is no manual distribution and no need for the launcher to send payments.',
    ],
  },
  {
    title: 'Recipients claim their share',
    body: [
      'Recipients can claim their accumulated fees whenever they want.',
      'Wallet recipients can claim directly with their wallet. Social recipients can connect their X, GitHub, Instagram, or TikTok account and claim any fees assigned to them.',
      'There is no expiry on an unclaimed share. Once assigned, it remains available to that recipient.',
    ],
  },
]

const CLOSER = [
  'The fee split is defined when the token is launched and enforced by the contracts.',
  "The launchpad cannot change the percentages, redirect a recipient\u2019s share, or take control of the fees after launch.",
  'What you see in the split is what the contracts enforce onchain.',
]

/**
 * Fades each block in as it arrives.
 *
 * ⛔ IT MUST NOT BE A PLAIN CSS ANIMATION WITH STAGGERED DELAYS. That plays the whole page while it
 * is still below the fold, so on any screen shorter than the document the reader scrolls down into
 * content that already finished animating — which looks like nothing at all, and costs a repaint.
 *
 * ⚠ THE ELEMENTS START VISIBLE AND ARE HIDDEN BY THIS HOOK, not by the stylesheet. With the hidden
 * state in CSS, a browser with no `IntersectionObserver`, or a JS error anywhere above this in the
 * tree, leaves the entire page permanently at `opacity: 0` — a blank page that passes every build.
 * @see prefers-reduced-motion below: that path also leaves everything alone.
 */
function useReveal() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = root.current
    if (!host) return
    if (typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const items = Array.from(host.querySelectorAll<HTMLElement>('[data-reveal]'))
    for (const el of items) el.classList.add('is-veiled')

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          e.target.classList.remove('is-veiled')
          io.unobserve(e.target)
        }
      },
      // ⚠ A bottom margin, so a block starts moving just before its top edge clears the fold.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    )
    for (const el of items) io.observe(el)
    return () => io.disconnect()
  }, [])

  return root
}

export function HowItWorksPage() {
  const root = useReveal()

  return (
    <section className="section hiw">
      <div className="wrap" ref={root}>
        {/* The masthead: title above the intro, both centred — deliberately a different shape from
            the four left-aligned rows under it.
            ⛔⛔ IT IS THE BAND THAT KEEPS IT IN SYNC, NOT THE ALIGNMENT. Centred at a measure of its
            own (60ch, while the steps ran to 1080px) it read as a block from a different page. It
            shares `--hiw-band` with the steps, the closing panel and the CTA. @see styles.css. */}
        <header className="hiw__hero" data-reveal>
          <h2 className="hiw__hero-title">How it works</h2>
          <div className="hiw__hero-body">
            <p className="hiw__lede">
              Share Pons lets you split a token&rsquo;s trading fees between multiple people or
              accounts.
            </p>
            <p className="hiw__sub">
              Shares can be assigned to X accounts, GitHub accounts, Instagram accounts, TikTok
              accounts and wallets.
            </p>
            <p className="hiw__sub">
              Once the token is launched the fee split is locked and the distribution is automated.
            </p>

            {/* Decoration, and the only place the five destinations are shown rather than listed. */}
            <ul className="hiw__rail-icons" aria-hidden="true">
              {PLATFORM_ORDER.map((p) => (
                <li key={p} className="hiw__rail-icon" title={PLATFORM_META[p].label}>
                  <PlatformIcon platform={p} />
                </li>
              ))}
            </ul>
          </div>
        </header>

        <ol className="hiw__steps">
          {STEPS.map((s, i) => (
            <li className="hiw__step" key={s.title} data-reveal>
              <div className="hiw__disc" aria-hidden="true">
                {i + 1}
              </div>
              {/* ⛔ A GRID CHILD IN ITS OWN RIGHT, not a heading inside the body. That is the whole
                  reason the row can span the page: on a wide screen the title takes a column of its
                  own beside the prose. Put it back inside `.hiw__step-body` and the layout silently
                  collapses to one narrow centred column. */}
              <h3 className="hiw__step-title">
                <span className="hiw__step-n">{i + 1}.</span> {s.title}
              </h3>
              <div className="hiw__step-body">
                {s.body.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
            </li>
          ))}
        </ol>

        <section className="hiw__closer" data-reveal>
          <h3 className="hiw__closer-title">Built for transparency</h3>
          <div className="hiw__closer-body">
            {CLOSER.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}
