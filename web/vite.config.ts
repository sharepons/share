import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5235,
    strictPort: true,
    /*
      ⚠⚠ Without this the sign-in probe answers with the dev server's index.html, `/api/providers`
      parses as nothing, and the claim page renders "no platform is wired up" on a deployment where
      every platform is. Pointed at a real server on purpose: the alternative is running the API
      locally to exercise pages that only ever talk to it.

      ➤ Set SHARE_API to a running server (or the live site) before `npm run dev`.
    */
    proxy: {
      '/api': {
        target: process.env.SHARE_API || 'http://127.0.0.1:5234',
        changeOrigin: true,
        secure: true,
      },
      /*
        ⛔⛔ `/logos` IS PROXIED TOO, SO DEV HAS ONE ORIGIN LIKE PRODUCTION DOES.

        The server refuses any state-changing request whose `Origin` does not equal `PUBLIC_URL`, and
        a proxy forwards `Origin` UNCHANGED — `changeOrigin` rewrites Host, not Origin. So with the
        page on :5235 and PUBLIC_URL on :5234 every upload came back
        `cross-site request refused`, while the same code worked in production, where Caddy serves
        the site and the API from one hostname.

        ➤ The fix is to make dev look like production rather than to relax the check: point
          PUBLIC_URL at this dev server (see server/.env) and route BOTH paths through here. Logos
          have to come too, or the URL the upload returns 404s in the preview.
      */
      '/logos': {
        target: process.env.SHARE_API || 'http://127.0.0.1:5234',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
