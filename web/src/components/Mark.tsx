import { HAS_LOGO } from '../lib/brand.ts'

/**
 * The brand mark.
 *
 * ⛔⛔ THE PHOTOGRAPHED MARK GETS NO TILE AND THE DRAWN ONE DOES, which is why the ground is a
 * modifier rather than one rule. `logo.png` is a glass object shot on white; a coloured plate behind
 * it makes it read as a sticker on the page instead of an object on it. It carries at 46px with
 * nothing behind it — at 30px in a padded tile it was a grey smudge, and SIZE is what fixed that.
 * The drawn fallback is the opposite: eight vivid bars that need an edge to sit inside.
 *
 * ⚠ So do not "simplify" these into one rule. They are two different marks.
 *
 * ➤ Without `VITE_HAS_LOGO=1` the mark is DRAWN — four bars of the split palette, the product's own
 *   diagram at 30px — rather than a placeholder image that could reach an og:image or a token's
 *   metadata, which has no setter on Pons V2 and is therefore permanent.
 */
export function Mark() {
  return (
    <span className={HAS_LOGO ? 'mark' : 'mark mark--drawn'}>
      {HAS_LOGO ? (
        <img src="/logo.png" alt="" />
      ) : (
        <span className="mark__bars" aria-hidden="true">
          <i className="s1" style={{ flex: 4 }} />
          <i className="s2" style={{ flex: 3 }} />
          <i className="s3" style={{ flex: 2 }} />
          <i className="s4" style={{ flex: 1 }} />
        </span>
      )}
    </span>
  )
}
