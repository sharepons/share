import { useMemo } from 'react'
import type { Launch } from '../lib/launchpad.ts'
import { isLive } from '../lib/launchpad.ts'
import { LAUNCH } from '../lib/router.ts'
import { useWallet } from '../lib/wallet.tsx'
import { Link } from './Link.tsx'
import { TokenCard, TokenCardSkeleton } from './TokenCard.tsx'

/**
 * Every launch made from the connected wallet.
 *
 * ⛔⛔ FILTERED ON `creator`, NOT ON WHO IS PAID. A launcher and a recipient are different people —
 * somebody can launch a token that pays them nothing, and be paid by ten launches they had no part
 * in. This page answers "what have I launched"; the claim page answers "what am I owed".
 *
 * ⚠ Read from the SAME register the whole site is read from, filtered in the browser. No extra
 * request, and it cannot disagree with the dashboard about what exists.
 *
 * ⚠⚠ ADDRESSES ARE COMPARED LOWER-CASED. `creator` comes back from the chain checksummed and the
 * connected address comes from the wallet in whatever case that wallet feels like; comparing them
 * raw silently shows an empty page to somebody who has launched.
 */
export function MyTokens({ launches, loading }: { launches: Launch[]; loading: boolean }) {
  const { address } = useWallet()

  const mine = useMemo(() => {
    if (!address) return []
    const me = address.toLowerCase()
    return launches
      .filter((l) => l.creator.toLowerCase() === me)
      .sort((a, b) => Number(b.launchedAt - a.launchedAt))
  }, [launches, address])

  return (
    <section className="section">
      <div className="wrap">
        <div className="head head--center">
          <h2>My tokens</h2>
          <p className="lede">Every token launched from this wallet.</p>
        </div>

        {!address ? (
          /* ⚠ Not an error, and not an empty grid. Without a wallet the question has no answer
             rather than the answer being "none". */
          <div className="empty">
            <h3>No wallet connected</h3>
            <p>Connect a wallet to see what it has launched.</p>
          </div>
        ) : loading ? (
          <div className="grid grid--3">
            <TokenCardSkeleton />
            <TokenCardSkeleton />
            <TokenCardSkeleton />
          </div>
        ) : mine.length === 0 ? (
          <div className="empty">
            <h3>{isLive() ? 'This wallet has not launched anything' : 'No tokens have been deployed yet'}</h3>
            {isLive() && (
              <>
                <p>Tokens you launch will appear here.</p>
                <Link to={LAUNCH} className="btn btn--primary">Launch a token</Link>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid--3">
            {mine.map((l) => (
              <TokenCard key={l.token} launch={l} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
