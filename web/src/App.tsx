import { useCallback, useEffect, useState } from 'react'
import { readLaunches, readMinSocialBps, type Launch } from './lib/launchpad.ts'
import { isPreview, previewLaunches } from './lib/preview.ts'
import { useRoute } from './lib/router.ts'
import { SessionProvider } from './lib/session.tsx'
import { WalletProvider } from './lib/wallet.tsx'
import { ClaimPage } from './components/ClaimPage.tsx'
import { Explore } from './components/Explore.tsx'
import { Footer } from './components/Footer.tsx'
import { Header } from './components/Header.tsx'
import { WalletPicker } from './components/WalletPicker.tsx'
import { Hero } from './components/Hero.tsx'
import { HowItWorks } from './components/HowItWorks.tsx'
import { HowItWorksPage } from './components/HowItWorksPage.tsx'
import { LaunchForm } from './components/LaunchForm.tsx'
import { PrivacyPage, TermsPage } from './components/Legal.tsx'
import { MyTokens } from './components/MyTokens.tsx'
import { Launches } from './components/Launches.tsx'
import { TokenPage } from './components/TokenPage.tsx'

function Site() {
  const route = useRoute()
  const [launches, setLaunches] = useState<Launch[]>([])
  const [minSocialBps, setMinSocialBps] = useState(2000)
  const [loading, setLoading] = useState(true)

  /* ⭐ Fetched ONCE and shared by every page. The home feed, the explore grid, the people table and
     the claim page are all views of the same register: two independent scans would cost twice the
     requests against a rate-limited public RPC and would be able to disagree with each other on
     screen. */
  const refresh = useCallback(() => {
    /* ⚠⚠ Block-bodied, not a concise arrow. `useEffect(() => promise)` hands React the promise as if
       it were a cleanup function and React 19 renders a BLANK PAGE with no error — which passes
       every headless check, because Playwright's Chromium renders it fine. */
    /* ⛔⛔ `?preview` SHORT-CIRCUITS THE CHAIN READ ENTIRELY — it does not merge with, fall back to,
       or top up real data. A fabricated launch sitting in the same list as real ones is how somebody
       ends up buying an address that does not exist. See lib/preview.ts. */
    if (isPreview()) {
      setLaunches(previewLaunches())
      setLoading(false)
      return
    }
    void (async () => {
      try {
        const [l, m] = await Promise.all([readLaunches(), readMinSocialBps()])
        setLaunches(l)
        setMinSocialBps(m)
      } catch {
        /* The chain being unreachable must not blank the page. Each section renders its own empty
           state and the launch form still validates. */
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return (
    <>
      <Header route={route} />
      {/* ⚠ Mounted once at the top, so any page can call `openPicker()`. @see lib/wallet.tsx */}
      <WalletPicker />
      <main>
        {route.name === 'token' ? (
          <TokenPage address={route.address} />
        ) : route.name === 'launch' ? (
          <LaunchForm minSocialBps={minSocialBps} onLaunched={refresh} />
        ) : route.name === 'explore' ? (
          <Explore launches={launches} loading={loading} />
        ) : route.name === 'mine' ? (
          <MyTokens launches={launches} loading={loading} />
        ) : route.name === 'claim' ? (
          <ClaimPage launches={launches} loading={loading} />
        ) : route.name === 'how' ? (
          <HowItWorksPage />
        ) : route.name === 'privacy' ? (
          <PrivacyPage />
        ) : route.name === 'terms' ? (
          <TermsPage />
        ) : (
          <>
            <Hero launches={launches} loading={loading} />
            <hr className="rule" />
            <HowItWorks />
            <Launches launches={launches} loading={loading} />
          </>
        )}
      </main>
      <Footer />
    </>
  )
}

export default function App() {
  return (
    <WalletProvider>
      <SessionProvider>
        <Site />
      </SessionProvider>
    </WalletProvider>
  )
}
