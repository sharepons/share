
/*
 * ⚠ `body` is an ARRAY of paragraphs. Every card is a single paragraph today — the cards are read
 * ACROSS the row, so a break in one of them steps its later lines out of line with its neighbours'
 * and the row stops scanning cleanly. If a second paragraph is ever genuinely needed, the array and
 * the `.step p + p` rule in styles.css already handle it: that rule spends exactly one line-height
 * so the text lands back on the shared baseline grid.
 */
/* ⛔⛔ THE TITLES ARE THE /how-it-works PAGE'S, VERBATIM, IN ITS ORDER. This section and that page
   are the same four steps told at two lengths, and they drifted: this one used to read
   "Split the fees / Sign contracts / Launch / Claim" — different names, and Launch in third place
   for a sequence that launches second. Somebody reading both was told the product works two ways.
   ➤ If a step is renamed on the page, rename it here in the same edit. @see HowItWorksPage.tsx */
const STEPS: { n: string; title: string; body: string[] }[] = [
  {
    n: '01',
    title: 'Set your split',
    body: [
      'Choose who receives the fees and how much. Shares can be assigned to X accounts, GitHub accounts, Instagram accounts, TikTok accounts and wallets, and must total 100%.',
    ],
  },
  {
    n: '02',
    title: 'Launch the token',
    body: [
      'SHARE creates a fee contract holding your split and deploys the token on Pons with that contract as its fee recipient. One transaction: if any part fails, all of it reverts.',
    ],
  },
  {
    n: '03',
    title: 'Fees are distributed automatically',
    body: [
      'As the token trades, creator fees accumulate on Pons and are distributed by the split defined at launch. Each recipient receives their own balance, separate from everyone else\u2019s.',
    ],
  },
  {
    n: '04',
    title: 'Recipients claim their share',
    body: [
      'Recipients claim whenever they want — a wallet directly, a social account by connecting it. Nothing expires: once assigned, a share stays available to that recipient.',
    ],
  },
]

export function HowItWorks() {
  return (
    <section className="section" id="how">
      <div className="wrap">
        <div className="head head--center">
          <h2>How it works</h2>
        </div>
        <div className="steps">
          {STEPS.map((s) => (
            <div className="step" key={s.n}>
              <div className="step__n">{s.n}</div>
              <h3>{s.title}</h3>
              {s.body.map((para) => <p key={para}>{para}</p>)}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
