/**
 * Everything the server needs, read once, checked once, and named when it is missing.
 *
 * ⭐ A provider only appears in the sign-in list if it can actually complete a sign-in. A button
 * that leads to a broken callback is worse than no button — it looks like the product is broken
 * rather than like that platform is not wired up yet.
 */
import { readFileSync } from 'node:fs'
import { isAddress, type Address, type Hex } from 'viem'

function env(name: string): string | undefined {
  const v = process.env[name]?.trim()
  return v ? v : undefined
}

/**
 * ⛔ Loaded from the file too, not only from the environment. A person running this by hand has an
 * empty `process.env`; systemd populates it. Refusing to start over a value that is plainly set in
 * `.env` sends whoever is reading it to fix something that is not broken.
 * ⚠ A real environment variable still wins, so an operator can override without editing the file.
 */
export function loadDotEnv(path = '.env') {
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    const name = m?.[1]
    if (name && !process.env[name]) process.env[name] = (m[2] ?? '').trim().replace(/^["']|["']$/g, '')
  }
}

export type Config = ReturnType<typeof loadConfig>

export function loadConfig() {
  loadDotEnv()

  const publicUrl = (env('PUBLIC_URL') ?? 'http://localhost:5234').replace(/\/+$/, '')

  /**
   * ⛔⛔ THE KEY THAT SIGNS ATTESTATIONS, AND THE ONLY SECRET HERE WITH MONEY NEAR IT.
   *
   * It cannot move anything. Its whole power is to state that a browser proved it holds a given
   * account — so a theft of this box lets an attacker redirect UNCLAIMED balances, and nothing else.
   * `owner` on ShareClaims revokes it in one transaction, and that key never touches a server.
   *
   * ⚠ Absent, the server still runs: sign-in works, handles resolve, the site is fully readable.
   * Only claiming is unavailable, and `/api/health` says so rather than 500ing at the moment
   * somebody presses the button.
   */
  const attestationKey = env('ATTESTATION_KEY') as Hex | undefined
  if (attestationKey && !/^0x[0-9a-fA-F]{64}$/.test(attestationKey)) {
    throw new Error('ATTESTATION_KEY must be a 32 byte hex private key')
  }

  const claimsAddress = env('CLAIMS_ADDRESS')
  if (claimsAddress && !isAddress(claimsAddress)) throw new Error('CLAIMS_ADDRESS is not an address')

  const cfg = {
    port: Number(env('PORT') ?? 5234),
    publicUrl,
    dataDir: env('DATA_DIR') ?? './data',

    /** ⛔ Part of the EIP-712 domain. A wrong one produces signatures that verify nowhere. */
    chainId: Number(env('CHAIN_ID') ?? 4663),
    claimsAddress: claimsAddress as Address | undefined,
    attestationKey,

    /** How long an attestation is good for. Short: one is minted per claim, on the button press. */
    attestationTtlSeconds: Number(env('ATTESTATION_TTL') ?? 900),

    x: pair('X_CLIENT_ID', 'X_CLIENT_SECRET'),
    xBearer: env('X_BEARER_TOKEN'),
    /**
     * A twitterapi.io key, used INSTEAD of `X_BEARER_TOKEN` for resolving @handles when it is set.
     *
     * ⭐ Sign-in and handle resolution are different problems with different bills. OAuth against X
     * is free; `GET /2/users/by/username` is prepaid per lookup against a balance held per developer
     * PROJECT, and a fresh project starts at zero — so this deployment could sign people in while
     * every lookup answered `402 credits depleted`.
     *
     * ⚠ Named `X_LOOKUP_KEY` rather than `TWITTERAPI_IO_KEY` because what matters here is the job it
     * does, not the vendor: if the lookup ever moves to another service, the variable does not have
     * to. ⛔ The same credential is called `TWITTERAPI_IO_KEY` in a sibling project's launcher.
     */
    xLookupKey: env('X_LOOKUP_KEY'),
    github: pair('GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'),
    instagram: pair('INSTAGRAM_CLIENT_ID', 'INSTAGRAM_CLIENT_SECRET'),
    tiktok: pair('TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'),

    logoDir: env('LOGO_DIR'),
    logoPublicBase: env('LOGO_PUBLIC_BASE') ?? `${publicUrl}/logos`,

    /** ⚠ Set on every cookie unless the site is being run over plain http on a laptop. */
    secureCookies: publicUrl.startsWith('https://'),
  }

  /*
    ⛔⛔ AN OAUTH CALLBACK IS REGISTERED AGAINST ONE EXACT URL. `PUBLIC_URL` is what every redirect
    is built from, so a deployment running on https with this left at localhost sends people to a
    callback the provider will refuse — and the refusal names the app, not the setting.
  */
  if (cfg.secureCookies && publicUrl.includes('localhost')) {
    throw new Error('PUBLIC_URL says https and localhost at once; one of those is wrong')
  }

  return cfg
}

function pair(idName: string, secretName: string): { id: string; secret: string } | undefined {
  const id = env(idName)
  const secret = env(secretName)
  if (!id || !secret) return undefined
  return { id, secret }
}
