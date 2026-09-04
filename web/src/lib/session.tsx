import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { fetchCapabilities, fetchMe, signOut, type Account, type Capabilities } from './api.ts'

/**
 * Who is signed in, and what this deployment can do.
 *
 * ⚠ Both are fetched once at the top and shared. Asking twice costs two requests and lets two parts
 * of the page disagree on whether somebody is signed in, which is the sort of difference nobody
 * notices until the claim button is missing on one screen and present on another.
 */
type Ctx = {
  account: Account | null
  capabilities: Capabilities
  loading: boolean
  refresh: () => void
  signOut: () => Promise<void>
}

const EMPTY: Capabilities = { providers: [], claiming: false, offline: false }

const SessionCtx = createContext<Ctx | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [capabilities, setCapabilities] = useState<Capabilities>(EMPTY)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    /* ⚠ Block-bodied, not a concise arrow. `useEffect(() => promise)` hands React the promise as if
       it were a cleanup function, and React 19 renders a BLANK PAGE with no error — which passes
       every headless check, because Playwright's Chromium renders it fine. */
    void (async () => {
      const [me, caps] = await Promise.all([fetchMe(), fetchCapabilities()])
      setAccount(me)
      setCapabilities(caps)
      setLoading(false)
    })()
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return (
    <SessionCtx.Provider
      value={{
        account,
        capabilities,
        loading,
        refresh,
        signOut: async () => {
          await signOut()
          setAccount(null)
        },
      }}
    >
      {children}
    </SessionCtx.Provider>
  )
}

export function useSession(): Ctx {
  const ctx = useContext(SessionCtx)
  if (!ctx) throw new Error('useSession outside SessionProvider')
  return ctx
}
