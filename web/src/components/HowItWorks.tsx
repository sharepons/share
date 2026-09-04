
/*
 * ⚠ `body` is an ARRAY of paragraphs. Every card is a single paragraph today — the cards are read
 * ACROSS the row, so a break in one of them steps its later lines out of line with its neighbours'
 * and the row stops scanning cleanly. If a second paragraph is ever genuinely needed, the array and
 * the `.step p + p` rule in styles.css already handle it: that rule spends exactly one line-height
 * so the text lands back on the shared baseline grid.
 */
const STEPS: { n: string; title: string; body: string[] }[] = [
  {
    n: '01',
    title: 'Split the fees',
    body: [
      'Split the fees with a X, GitHub, Instagram or TikTok account. You can share the fees across multiple accounts, giving each account its own share to claim directly.',
    ],
  },
  {
    n: '02',
    title: 'Sign contracts',
    body: [
      'The contracts signed at launch handle fee distribution automatically. Fee splits are fixed at launch and cannot be changed afterwards.',
    ],
  },
  {
    n: '03',
    title: 'Launch',
    body: [
      'One transaction deploys your fee split, creates the token on Pons and automates the entire distribution.',
    ],
  },
  {
    n: '04',
    title: 'Claim',
    body: [
      'Fee recipients can claim their share of the fees at any time. Each share is permanent and can never be changed or taken away.',
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
