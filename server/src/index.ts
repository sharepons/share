/**
 * The SHARE server.
 *
 * It exists for one thing a static page cannot do: prove which X, GitHub, Instagram or TikTok
 * account somebody is, and sign a statement saying so, which lets that person take fees the chain
 * has already credited to them.
 *
 * ⭐⭐ IT NEVER SENDS MONEY, AND IT NEVER DECIDES AN AMOUNT. Every payout is a transaction the
 * recipient submits and pays for themselves, drawing on a balance the splitter computed on chain.
 * So the worst a total compromise of this box can do is redirect UNCLAIMED balances, and one
 * transaction from a cold key ends that. @see attest.ts.
 *
 * ⭐ It is also not load-bearing for the site. The launch feed, every split, every balance and every
 * market cap are read straight off Robinhood Chain by the browser. This being down means nobody can
 * sign in; it does not mean a single number on the site is wrong or missing.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isAddress, type Address, type Hex } from 'viem'

import { Attester } from './attest.ts'
import { cacheLookup, cachedLookup } from './lookupCache.ts'
import { checkBioCode, cleanHandle, newBioCode } from './providers/tiktokBio.ts'
import { loadConfig } from './config.ts'
import { Store } from './db.ts'
import {
  beneficiaryOf,
  isPlatform,
  PLATFORMS,
  type Identity,
  type IdentityProvider,
  type Platform,
} from './identity.ts'
import { LOGO_NAME, LOGO_TYPES, MAX_BYTES, rateLimited, storeLogo } from './logos.ts'
import { githubProvider } from './providers/github.ts'
import { instagramProvider } from './providers/instagram.ts'
import { verifySignedRequest } from './providers/metaSignedRequest.ts'
import { tiktokProvider } from './providers/tiktok.ts'
import { xProvider } from './providers/x.ts'

const config = loadConfig()
const store = new Store(config.dataDir)

/**
 * Everything somebody can sign in with, built from what is actually configured.
 *
 * ⚠ A platform missing from here is missing from the sign-in list on the site. That is the point:
 * a button that leads to a callback nobody registered looks like the product is broken.
 */
const providers = new Map<Platform, IdentityProvider>()
if (config.x) providers.set('x', xProvider(config.x.id, config.x.secret, config.xBearer, config.xLookupKey))
if (config.github) providers.set('github', githubProvider(config.github.id, config.github.secret))
if (config.instagram) providers.set('instagram', instagramProvider(config.instagram.id, config.instagram.secret))
if (config.tiktok) providers.set('tiktok', tiktokProvider(config.tiktok.id, config.tiktok.secret))

/**
 * ⭐ Resolving a handle is a SEPARATE capability from signing in, and GitHub is why.
 * `api.github.com/users/{login}` is public, so a GitHub recipient can be named on a launch even
 * where no GitHub OAuth app exists — only their eventual claim needs one. The launch form reads
 * `lookup` and the claim page reads `signin`, and they are different answers.
 */
const lookupOnly = new Map<Platform, IdentityProvider>([['github', githubProvider('', '')]])
const lookupFor = (p: Platform) => providers.get(p) ?? lookupOnly.get(p)

const attester =
  config.attestationKey && config.claimsAddress
    ? new Attester(config.attestationKey, config.chainId, config.claimsAddress, config.attestationTtlSeconds)
    : null

const SESSION_COOKIE = 'share.sid'
const HANDSHAKE_COOKIE = 'share.oauth'

/* ------------------------------------------------------------------- plumbing -- */

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

function setCookie(res: ServerResponse, name: string, value: string, maxAgeSeconds: number) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    /* ⚠ `Lax`, not `Strict`. An OAuth callback is a top-level navigation FROM another site, and
       `Strict` withholds the cookie on exactly that request — the handshake would fail for
       everybody, on every provider, with the browser doing precisely what it was told. */
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (config.secureCookies) bits.push('Secure')
  const existing = res.getHeader('set-cookie')
  const list = Array.isArray(existing) ? existing : existing ? [String(existing)] : []
  res.setHeader('set-cookie', [...list, bits.join('; ')])
}

const clearCookie = (res: ServerResponse, name: string) => setCookie(res, name, '', 0)

function json(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(text)
}

function redirect(res: ServerResponse, to: string) {
  res.writeHead(302, { location: to, 'cache-control': 'no-store' })
  res.end()
}

/**
 * ⛔⛔ A STATE COMPARISON HAS TO BE CONSTANT TIME AND LENGTH SAFE. `timingSafeEqual` THROWS on a
 * length mismatch, so the obvious call is itself a crash an attacker controls.
 */
function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * ⚠ Every state-changing request is checked against `PUBLIC_URL`. The session cookie is `SameSite=Lax`
 * — which stops a cross-site POST from carrying it — and this is the second lock, because `Lax` is a
 * browser promise and browsers have exceptions.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true // a same-origin fetch may omit it; the cookie policy still applies
  return origin === config.publicUrl
}

async function readBody(req: IncomingMessage, limit = MAX_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    // ⚠ Aborted at the limit rather than after. Buffering first and checking later is the limit
    // doing nothing at all.
    if (size > limit) throw new Error('too large')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

const publicIdentity = (i: Identity) => ({
  platform: i.platform,
  id: i.id,
  handle: i.handle,
  name: i.name,
  avatar: i.avatar,
  beneficiary: beneficiaryOf(i),
})

/* --------------------------------------------------------------------- routes -- */

const server = createServer((req, res) => {
  void handle(req, res).catch((e) => {
    console.error('[share]', e)
    if (!res.headersSent) json(res, 500, { error: 'something went wrong here' })
  })
})

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', config.publicUrl)
  const path = url.pathname
  const jar = cookies(req)
  const session = store.session(jar[SESSION_COOKIE])

  if (req.method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'cross-site request refused' })

  /**
   * What this deployment can actually do, per platform. ⭐ The site renders itself from this rather
   * than from a hard-coded list, so a platform that is not wired up says so instead of offering a
   * button that fails.
   */
  if (path === '/api/providers') {
    return json(res, 200, {
      providers: PLATFORMS.filter((p) => p !== 'wallet').map((p) => {
        const provider = providers.get(p)
        const lookup = lookupFor(p)
        return {
          platform: p,
          label: provider?.label ?? labelOf(p),
          /** Can somebody sign in as this platform and claim? */
          signin: Boolean(provider),
          /** Can a launcher resolve a typed handle here? ⛔ False forever on Instagram and TikTok. */
          lookup: Boolean(lookup?.canLookup),
          /**
           * ⛔⛔ `handle` MEANS THE SHARE FOLLOWS THE NAME. Instagram and TikTok publish no endpoint
           * that resolves a username to an account, so there is nothing else to key on. Rendered as
           * a warning on the launch form, not hidden.
           */
          keyedBy: p === 'x' || p === 'github' ? 'id' : 'handle',
          /**
           * ⭐ A second way to prove a handle, for platforms whose sign-in needs an approved app.
           * `'bio'` means: put a one-time code in the profile bio and we read it back publicly.
           * ⛔ Reported by the SERVER, like `signin`, so the interface never offers a route this
           * deployment cannot actually complete.
           */
          verify: p === 'tiktok' ? 'bio' : null,
        }
      }),
      /** ⚠ False means claiming is unavailable on this deployment — not that nobody is owed. */
      claiming: Boolean(attester),
    })
  }

  if (path === '/api/me') {
    return json(res, 200, { identity: session ? publicIdentity(session.identity) : null })
  }

  /* ------------------------------------------------------------------ sign in -- */

  if (path.startsWith('/api/auth/start/')) {
    const name = path.slice('/api/auth/start/'.length)
    if (!isPlatform(name)) return json(res, 404, { error: 'no such platform' })
    const provider = providers.get(name)
    if (!provider) return json(res, 503, { error: `signing in with ${labelOf(name)} is not set up here yet` })

    /* ⚠ Only a path, never a full URL. An open redirect on a sign-in callback is how a phishing page
       borrows a real domain's address bar. */
    const raw = url.searchParams.get('return') ?? '/claim'
    const returnTo = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/claim'

    const redirectUri = `${config.publicUrl}/api/auth/callback/${name}`
    const { url: authorizeUrl, state, verifier } = provider.begin(redirectUri)

    const handshake = randomBytes(24).toString('hex')
    store.putPending(handshake, { platform: name, state, verifier, returnTo, createdAt: Date.now() })
    setCookie(res, HANDSHAKE_COOKIE, handshake, 15 * 60)
    return redirect(res, authorizeUrl)
  }

  if (path.startsWith('/api/auth/callback/')) {
    const name = path.slice('/api/auth/callback/'.length)
    if (!isPlatform(name)) return json(res, 404, { error: 'no such platform' })
    const provider = providers.get(name)
    if (!provider) return json(res, 503, { error: 'that platform is not set up here' })

    /* ⚠ The provider's own refusal comes back as a query parameter, not an HTTP error. Somebody who
       pressed Cancel gets sent back quietly rather than shown a fault. */
    if (url.searchParams.get('error')) return redirect(res, '/claim?signin=cancelled')

    // ⛔ Read AND removed. A handshake is good exactly once.
    const pending = store.takePending(jar[HANDSHAKE_COOKIE] ?? '')
    clearCookie(res, HANDSHAKE_COOKIE)

    const state = url.searchParams.get('state') ?? ''
    const code = url.searchParams.get('code') ?? ''
    /* ⛔⛔ THE STATE IS CHECKED AGAINST THE SERVER'S RECORD **AND** THE BROWSER'S COOKIE. Either one
       alone leaves the flow forgeable: the record alone accepts a state minted for a different
       browser, and the cookie alone accepts anything the attacker set. */
    if (!pending || pending.platform !== name || !code || !sameSecret(pending.state, state)) {
      return redirect(res, '/claim?signin=expired')
    }

    let identity: Identity
    try {
      identity = await provider.complete(code, pending.verifier, `${config.publicUrl}/api/auth/callback/${name}`)
    } catch (e) {
      console.error('[share] sign-in failed', name, e)
      return redirect(res, '/claim?signin=failed')
    }

    const token = randomBytes(32).toString('hex')
    store.putSession(token, identity)
    setCookie(res, SESSION_COOKIE, token, 7 * 24 * 60 * 60)
    return redirect(res, pending.returnTo)
  }

  if (path === '/api/auth/signout' && req.method === 'POST') {
    store.dropSession(jar[SESSION_COOKIE])
    clearCookie(res, SESSION_COOKIE)
    return json(res, 200, { ok: true })
  }

  /**
   * Instagram's deauthorize callback. Meta POSTs here when somebody removes this app from their
   * Instagram account, and the URL is a required field in Business login settings.
   *
   * ⛔⛔ THIS IS A SERVER-TO-SERVER POST WITH NO COOKIE AND NO ORIGIN HEADER. It survives the CSRF
   * guard above only because `sameOrigin` treats a missing `Origin` as same-origin — a browser
   * cannot omit it on a cross-site POST, a datacentre can. The signature is the real check.
   *
   * ⚠⚠ AND IT IS BEHIND THE GATE. While the site is in private preview Caddy answers every path
   * with the gate page, and `file_server` refuses POST — so an unexempted callback answers Meta
   * **405** rather than anything it can act on. @see Caddyfile.share, which exempts this one path.
   *
   * ⭐ 200 EVEN WHEN THERE IS NOTHING TO DO, and that is honest, not a stub — see
   * `providers/metaSignedRequest.ts` for why the app-scoped `user_id` names nobody we hold.
   */
  if (path === '/api/instagram/deauthorize' && req.method === 'POST') {
    if (!config.instagram) return json(res, 503, { error: 'instagram is not set up here' })
    const form = new URLSearchParams((await readBody(req)).toString('utf8'))
    const signed = verifySignedRequest(form.get('signed_request') ?? '', config.instagram.secret)
    /* ⛔ 400, not 200. An unsigned POST to this path is not Meta, and answering it OK would make
       the endpoint indistinguishable from one that never checked. */
    if (!signed) return json(res, 400, { error: 'bad signed_request' })
    /* ⚠ Logged without the id. Knowing a revocation arrived is operationally useful; recording an
       app-scoped identifier we deliberately do not store is not. */
    console.log('[share] instagram deauthorize received and verified')
    return json(res, 200, { ok: true })
  }

  /* ------------------------------------------------------------------- handle -- */

  /**
   * Resolve a typed handle to the account that currently holds it.
   *
   * ⛔⛔ THIS IS WHAT MAKES AN X OR GITHUB SHARE SURVIVE A RENAME. The launch form sends the handle
   * somebody typed and gets back the stable numeric id, and it is the ID that goes on chain. A
   * launch built from the text would follow whoever holds that name later.
   */
  if (path === '/api/handle') {
    const platform = url.searchParams.get('platform') ?? ''
    const handle = (url.searchParams.get('handle') ?? '').trim()
    if (!isPlatform(platform) || platform === 'wallet') return json(res, 400, { error: 'no such platform' })
    if (!handle) return json(res, 400, { error: 'type a handle first' })

    const provider = lookupFor(platform)
    if (!provider?.canLookup) {
      /* ⚠ 200, not an error. "There is no lookup" is the correct, permanent answer for Instagram and
         TikTok, and the form draws a different row for it. An error status would make a working
         product look broken every time somebody picks Instagram. */
      return json(res, 200, {
        account: null,
        lookup: false,
        note: `${labelOf(platform)} publishes no way to look up an account by name, so this share is keyed by the handle itself.`,
      })
    }

    /* ⭐ Every X lookup is BILLED — a minimum charge per request even when nothing comes back — and
       a launch form invites the same handle several times as somebody edits their rows. ⛔ Minutes,
       never days: this mapping becomes `keccak256("x:<id>")` in a split on chain, so a stale entry
       after a rename would name the wrong person permanently. @see lookupCache.ts */
    const hit = cachedLookup(platform, handle)
    if (hit) {
      return json(res, 200, {
        account: hit.identity ? publicIdentity(hit.identity) : null,
        lookup: true,
        cached: true,
      })
    }

    try {
      const account = await provider.lookup(handle)
      /* ⚠ Misses are cached too, briefly. A half-typed handle is the common case and it costs the
         same to ask about as a real one. */
      cacheLookup(platform, handle, account)
      return json(res, 200, { account: account ? publicIdentity(account) : null, lookup: true })
    } catch (e) {
      const message = (e as Error).message
      if (message === 'X_CREDITS_DEPLETED') {
        return json(res, 503, { error: 'X handle lookups are out of credit on this deployment.' })
      }
      if (message === 'GITHUB_RATE_LIMITED') {
        return json(res, 503, { error: 'GitHub is rate limiting lookups from this server. Try again shortly.' })
      }
      return json(res, 502, { error: `${labelOf(platform)} did not answer` })
    }
  }

  /* ------------------------------------------------- verifying a handle by bio -- */
  /*
    ⛔⛔ WHY A SECOND WAY IN, AND WHY IT IS NOT A BACK DOOR.

    TikTok's Login Kit needs an approved app, and the scope carrying `username` — the only field a
    TikTok share can be keyed on — is gated behind review. Until that clears, a `tiktok:@jane` share
    accrues fees on chain that @jane cannot reach.

    ⭐ Nothing on chain learns how identity was proven: `/api/attestation` signs
    `beneficiaryOf(session.identity)`. So this ends where OAuth ends — a session — and every check
    after it is unchanged. It grants the signer key no power it did not already have.
  */
  if (path === '/api/verify/tiktok/start' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}') as {
      handle?: string
      recipient?: string
    }
    const handle = cleanHandle(body.handle ?? '')
    if (!handle) return json(res, 400, { error: 'that is not a TikTok handle' })

    /* ⛔ The wallet is required HERE, not at the end. The code goes into a public bio, so it is
       only safe because it can mint an attestation for exactly one address. */
    const recipient = (body.recipient ?? '').trim()
    if (!isAddress(recipient)) return json(res, 400, { error: 'connect a wallet first' })

    const code = newBioCode()
    store.putBioClaim({
      platform: 'tiktok',
      handle: handle.toLowerCase(),
      code,
      recipient: recipient.toLowerCase(),
      createdAt: Date.now(),
    })
    return json(res, 200, { handle, code, expiresInSeconds: 30 * 60 })
  }

  if (path === '/api/verify/tiktok/check' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}') as {
      handle?: string
      recipient?: string
    }
    const handle = cleanHandle(body.handle ?? '')
    const recipient = (body.recipient ?? '').trim()
    if (!handle || !isAddress(recipient)) return json(res, 400, { error: 'that is not a handle and a wallet' })

    const claim = store.bioClaim('tiktok', handle.toLowerCase())
    if (!claim) return json(res, 410, { error: 'that code has expired — start again' })

    /* ⛔ Constant-time, and checked before the network call. A wallet that did not request this
       verification must not even learn whether the code is in place. */
    if (!sameSecret(claim.recipient, recipient.toLowerCase())) {
      return json(res, 403, { error: 'that code was issued for a different wallet' })
    }

    const check = await checkBioCode(handle, claim.code)

    /* ⛔⛔ FOUR OUTCOMES, FOUR ANSWERS. Collapsing "we could not read TikTok" into "your code is not
       there" tells somebody their correct action failed and sends them to re-paste a code that is
       already in place. @see tiktokBio.ts */
    if (check.result === 'unreadable') {
      console.error('[share] tiktok bio check unreadable', handle, check.detail)
      return json(res, 502, {
        error: 'We could not read your TikTok profile just now — this is our end, not yours. Leave the code where it is and try again shortly.',
      })
    }
    if (check.result === 'no-such-account') return json(res, 404, { error: 'TikTok has no account with that handle' })
    if (check.result === 'missing') {
      return json(res, 409, {
        error: 'That code is not in your bio yet. Paste it in, save, and try again — TikTok can take a moment to publish an edit.',
      })
    }

    // ⛔ Spent on success only. @see takeBioClaim.
    store.takeBioClaim('tiktok', handle.toLowerCase())

    const token = randomBytes(32).toString('hex')
    store.putSession(token, check.identity)
    setCookie(res, SESSION_COOKIE, token, 7 * 24 * 60 * 60)
    return json(res, 200, { ok: true, identity: publicIdentity(check.identity) })
  }

  /* -------------------------------------------------------------- attestation -- */

  /**
   * Sign the statement a claim needs.
   *
   * ⚠ The recipient address comes from the person signing in and is bound into the signature, so an
   * intercepted attestation cannot be redirected. The server does not remember it and never chooses
   * it — a default would be a payout address picked by a machine.
   */
  if (path === '/api/attestation' && req.method === 'POST') {
    if (!session) return json(res, 401, { error: 'sign in first' })
    if (!attester) {
      return json(res, 503, {
        error: 'claiming is not switched on for this deployment yet — nothing owed to you has moved or expired',
      })
    }

    const body = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}') as { recipient?: string }
    const recipient = (body.recipient ?? '').trim()
    if (!isAddress(recipient)) return json(res, 400, { error: 'that is not an address' })

    const beneficiary = beneficiaryOf(session.identity) as Hex
    const { attestation, signature } = await attester.sign(beneficiary, recipient as Address)

    return json(res, 200, {
      attestation: {
        beneficiary: attestation.beneficiary,
        recipient: attestation.recipient,
        // ⚠ A string. JSON has no 64 bit integer, and a deadline that silently loses precision is a
        // signature the contract rejects for reasons nothing in the payload explains.
        deadline: attestation.deadline.toString(),
        salt: attestation.salt,
      },
      signature,
      claims: attester.claims,
      identity: publicIdentity(session.identity),
    })
  }

  /* --------------------------------------------------------------------- logo -- */

  /*
   * Serving a stored logo.
   *
   * ⛔⛔ THIS ROUTE WAS MISSING ENTIRELY. Uploads were written to `LOGO_DIR` and the API handed back
   * a URL under `LOGO_PUBLIC_BASE` that nothing answered — so every upload "succeeded" and produced
   * a 404, and the URL goes into a token's constructor with NO SETTER. A launch made against it
   * would carry a permanently broken image. A sibling project has 22 tokens in exactly that state.
   *
   * ⚠ GET and HEAD. HEAD matters: caches, link checkers and `curl -I` use it, and a route that
   * answers 404 to HEAD while serving GET looks broken to every one of them — it fooled the check
   * that was written to verify this very fix.
   * ⚠ Matched against `LOGO_NAME` before touching the filesystem. @see logos.ts
   */
  if ((req.method === 'GET' || req.method === 'HEAD') && path.startsWith('/logos/')) {
    if (!config.logoDir) return json(res, 404, { error: 'this deployment does not host logos' })
    const name = path.slice('/logos/'.length)
    if (!LOGO_NAME.test(name)) return json(res, 404, { error: 'no such logo' })
    try {
      const bytes = readFileSync(join(config.logoDir, name))
      res.writeHead(200, {
        'Content-Type': LOGO_TYPES[name.split('.').pop()!] ?? 'application/octet-stream',
        /* ⭐ Immutable: the name is a hash of the bytes, so a given URL can never mean a different
           image. ⚠ `nosniff` as well — the type is decided by what the bytes actually were. */
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': bytes.length,
      })
      /* ⚠ A HEAD reply carries the headers and no body — writing one is a protocol error. */
      return res.end(req.method === 'HEAD' ? undefined : bytes)
    } catch {
      return json(res, 404, { error: 'no such logo' })
    }
  }

  if (path === '/api/logo' && req.method === 'GET') {
    /* ⚠⚠ THE PROBE ANSWERS WITH A BODY, AND THE FRONT END READS THE BODY. On a deployment with no
       upload service this path is served by the site's own `try_files` rule, which answers 200 with
       the HTML of the home page — so a probe that trusted the status code would draw a drop zone
       that cannot work. */
    return json(res, 200, { upload: Boolean(config.logoDir), maxBytes: MAX_BYTES })
  }

  if (path === '/api/logo' && req.method === 'POST') {
    if (!config.logoDir) return json(res, 503, { error: 'this deployment does not host logos' })
    const who = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0]!.trim()
    if (rateLimited(who)) return json(res, 429, { error: 'too many uploads from here in the last hour' })

    let bytes: Buffer
    try {
      bytes = await readBody(req)
    } catch {
      return json(res, 413, { error: `that is larger than the ${MAX_BYTES / 1024 / 1024} MB limit` })
    }
    try {
      return json(res, 200, storeLogo(config.logoDir, config.logoPublicBase, bytes))
    } catch (e) {
      return json(res, 400, { error: (e as Error).message })
    }
  }

  /* ------------------------------------------------------------------- health -- */

  if (path === '/api/health') {
    store.prune()
    const ready = Boolean(attester)
    /* ⛔ 503 when claiming cannot happen, even though the site is fine. A health check that stays
       green while the one thing this server exists for is switched off is a health check nobody
       should have written. */
    return json(res, ready ? 200 : 503, {
      ok: ready,
      claiming: ready,
      signer: attester?.address ?? null,
      claims: config.claimsAddress ?? null,
      chainId: config.chainId,
      signin: [...providers.keys()],
      lookup: PLATFORMS.filter((p) => p !== 'wallet' && lookupFor(p)?.canLookup),
      logos: Boolean(config.logoDir),
      ...store.counts(),
    })
  }

  return json(res, 404, { error: 'no such endpoint' })
}

function labelOf(p: Platform): string {
  return { wallet: 'Wallet', x: 'X', github: 'GitHub', instagram: 'Instagram', tiktok: 'TikTok' }[p]
}

server.listen(config.port, '127.0.0.1', () => {
  /* ⛔⛔ 127.0.0.1, NEVER 0.0.0.0. Caddy is in front of this and it is the only thing that should be
     able to reach it. A sibling project bound an indexer to every interface and published a paid RPC
     key on a health endpoint the same week. */
  console.log(`[share] :${config.port} — ${config.publicUrl}`)
  console.log(`[share] sign-in: ${[...providers.keys()].join(', ') || 'none configured'}`)
  console.log(`[share] claiming: ${attester ? `on, signer ${attester.address}` : 'OFF (no ATTESTATION_KEY/CLAIMS_ADDRESS)'}`)
})
