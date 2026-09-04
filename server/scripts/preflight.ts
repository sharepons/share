/**
 * Checks that the deployed contracts, the server's `.env` and the site's `.env.production` all
 * describe the SAME deployment — before anybody presses Claim.
 *
 * ```
 *   cd server && npm run preflight
 *   WEB_ENV=../web/.env.local npm run preflight     # to check a different build's config
 * ```
 *
 * ## ⛔⛔ WHY THIS EXISTS: THE WIRING IS TRANSCRIBED BY HAND AND FAILS SILENTLY
 *
 * `contracts/deploy.sh` prints three lines and a person copies them into two files. Nothing until
 * now compared what they typed against the chain, and every way of getting it wrong produces a
 * product that looks healthy:
 *
 *   • ATTESTATION_KEY not the key the vault was deployed against → every SOCIAL claim reverts as a
 *     bad signature. ⚠ Wallet claims keep working (`claimAsWallet` recomputes the identity from
 *     `msg.sender` and never touches the signer), the launch feed keeps rendering, `/api/health`
 *     reports claiming as available, and the OAuth sign-in completes. The only symptom is a revert
 *     that reads like a contract bug — on a stack where "it must be the contract" has cost days.
 *   • CHAIN_ID wrong → the EIP-712 domain separator differs and the signatures verify NOWHERE, with
 *     exactly the same symptom.
 *   • VITE_CLAIMS and CLAIMS_ADDRESS pointing at different vaults → the site reads one ledger and
 *     the server signs for another. Both are real contracts. Both answer.
 *
 * ➤ So this reads nothing from the repo's own constants where it can help it. It derives an address
 *   from the key the server will actually load, rebuilds the domain separator from the code that
 *   actually signs, and compares both against the deployed vault.
 *
 * ⛔ READ-ONLY. It sends no transaction, needs no gas, and never prints a key.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createPublicClient, http, isAddress, getAddress, hashDomain, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { loadDotEnv } from '../src/config.ts'
import { DOMAIN_NAME, DOMAIN_VERSION } from '../src/attest.ts'

const RPC = process.env.RHC_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const WEB_ENV = process.env.WEB_ENV ?? '../web/.env.production'
/**
 * ⛔⛔ THE DEPLOYMENT HAS NO `.env.production` — vite BAKES those values into the bundle at build
 * time, and only `dist/` is shipped. So on the box the source-file check finds nothing and reports
 * a perfectly good deployment as "the site will say the launchpad is not deployed".
 *
 * ➤ Point `WEB_DIST` at the served directory and the addresses are read from the JS that is
 *   actually being served — which is a strictly better check than a file describing what someone
 *   intended to build. ⚠ On the box: `WEB_DIST=/root/share-web/dist`.
 */
const WEB_DIST = process.env.WEB_DIST ?? ''

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const OFF = '\x1b[0m'

let failures = 0
let warnings = 0

const ok = (m: string) => console.log(`   ${GREEN}✓${OFF} ${m}`)
const bad = (m: string) => {
  failures++
  console.log(`   ${RED}✗ ${m}${OFF}`)
}
const warn = (m: string) => {
  warnings++
  console.log(`   ${YELLOW}⚠ ${m}${OFF}`)
}

/** ⚠ The same parse `loadDotEnv` uses, so this reads the web file the way vite does — not more
    cleverly. A preflight that is better at reading config than the thing it checks is a preflight
    that passes on a file the real loader chokes on. */
function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return out
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m?.[1]) out[m[1]] = (m[2] ?? '').trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

const CLAIMS_ABI = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'signer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'domainSeparator', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
] as const

const PAD_ABI = [
  { type: 'function', name: 'claims', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'factory', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'escrow', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'minSocialBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16' }] },
  { type: 'function', name: 'count', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

const FACTORY_ABI = [
  { type: 'function', name: 'launchEnabled', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'feeEscrow', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const

/** Every 0x-address that appears in the built bundle. ⚠ Returns null when there is no dist to read,
    which is NOT the same as "the bundle contains nothing" — the caller must render the difference. */
function addressesInDist(dir: string): Set<string> | null {
  const assets = `${dir}/assets`
  if (!dir || !existsSync(assets)) return null
  const found = new Set<string>()
  for (const f of readdirSync(assets)) {
    if (!f.endsWith('.js')) continue
    for (const m of readFileSync(`${assets}/${f}`, 'utf8').matchAll(/0x[0-9a-fA-F]{40}/g)) {
      found.add(m[0].toLowerCase())
    }
  }
  return found
}

async function main() {
  loadDotEnv()
  const web = readEnvFile(WEB_ENV)
  const inDist = addressesInDist(WEB_DIST)

  /* ⭐ When the addresses cannot come from a source file, they may be given directly — and are then
     checked against the bundle rather than taken on trust. */
  web.VITE_CLAIMS ||= process.env.VITE_CLAIMS ?? ''
  web.VITE_LAUNCHPAD ||= process.env.VITE_LAUNCHPAD ?? ''
  web.VITE_SITE_URL ||= process.env.VITE_SITE_URL ?? ''

  console.log(`\nSHARE preflight`)
  console.log(`  server .env    ./.env`)
  console.log(`  site   env     ${WEB_ENV}`)
  console.log(`  rpc            ${RPC}\n`)

  /* ------------------------------------------------------- what is set at all -- */

  console.log('config')

  const claimsEnv = process.env.CLAIMS_ADDRESS?.trim()
  const key = process.env.ATTESTATION_KEY?.trim()
  const viteClaims = web.VITE_CLAIMS
  const vitePad = web.VITE_LAUNCHPAD

  /* ⚠ A blank address is NOT treated as a failure of the same kind as a wrong one. Before the
     deploy every one of these is legitimately empty and the site says so honestly; the point of
     stopping here is to avoid reporting "the signer is wrong" when nothing is deployed. */
  if (!claimsEnv && !viteClaims && !vitePad) {
    console.log(`   ${YELLOW}⚠ nothing is deployed yet — CLAIMS_ADDRESS, VITE_CLAIMS and VITE_LAUNCHPAD are all empty.${OFF}`)
    console.log('     That is the correct state before contracts/deploy.sh has run. Nothing else to check.\n')
    process.exit(0)
  }

  if (!claimsEnv) bad('CLAIMS_ADDRESS is not set in server/.env — the server cannot sign for a vault it does not know')
  else if (!isAddress(claimsEnv)) bad(`CLAIMS_ADDRESS is not an address: ${claimsEnv}`)
  else ok(`CLAIMS_ADDRESS ${getAddress(claimsEnv)}`)

  if (!viteClaims) bad(`VITE_CLAIMS is not set in ${WEB_ENV} — the site will say the launchpad is not deployed`)
  else if (!isAddress(viteClaims)) bad(`VITE_CLAIMS is not an address: ${viteClaims}`)
  else ok(`VITE_CLAIMS     ${getAddress(viteClaims)}`)

  if (!vitePad) bad(`VITE_LAUNCHPAD is not set in ${WEB_ENV} — the feed has nothing to read`)
  else if (!isAddress(vitePad)) bad(`VITE_LAUNCHPAD is not an address: ${vitePad}`)
  else ok(`VITE_LAUNCHPAD  ${getAddress(vitePad)}`)

  /* ⛔ The site and the server must name the SAME vault. Two real, answering contracts is the worst
     version of this bug: the site reads one ledger and the server signs against the other, so a
     balance appears and the claim for it verifies nowhere. */
  if (claimsEnv && viteClaims && isAddress(claimsEnv) && isAddress(viteClaims)) {
    if (same(claimsEnv, viteClaims)) ok('the site and the server name the same vault')
    else bad(`the site reads ${getAddress(viteClaims)} and the server signs for ${getAddress(claimsEnv)} — different vaults`)
  }

  /* ⛔⛔ THE BUNDLE THAT IS ACTUALLY SERVED, not the file that says what should have been built.
     A stale `dist` — a config edited but never rebuilt, or a rebuild that never rsynced — is
     invisible to every other check here and serves the OLD addresses to every visitor. */
  if (inDist) {
    for (const [label, addr] of [['vault', viteClaims], ['launchpad', vitePad]] as const) {
      if (!addr || !isAddress(addr)) continue
      if (inDist.has(addr.toLowerCase())) ok(`the served bundle contains the ${label} address`)
      else bad(`the ${label} ${getAddress(addr)} is NOT in the served bundle at ${WEB_DIST} — dist is stale, rebuild and redeploy`)
    }
  } else if (WEB_DIST) {
    warn(`WEB_DIST is set to ${WEB_DIST} but there is no assets/ there — the bundle was not checked`)
  }

  if (!key) {
    warn('ATTESTATION_KEY is not set — the server runs, but claiming is unavailable and /api/health says so')
  } else if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    bad('ATTESTATION_KEY is not a 32 byte hex private key — the server refuses to start')
  }

  if (!claimsEnv || !isAddress(claimsEnv) || !vitePad || !isAddress(vitePad)) {
    console.log(`\n${RED}⛔ ${failures} problem(s) in the config itself. Nothing was read from the chain.${OFF}\n`)
    process.exit(1)
  }

  /* --------------------------------------------------------------- the chain -- */

  console.log('\nchain')

  const client = createPublicClient({ transport: http(RPC) })
  const liveChainId = await client.getChainId()
  const configuredChainId = Number(process.env.CHAIN_ID ?? 4663)

  /* ⛔⛔ CHAIN_ID IS PART OF THE EIP-712 DOMAIN, NOT JUST AN RPC SETTING. Wrong, every attestation
     this server issues verifies nowhere, and the server does not need the chain to start — so
     nothing else would ever notice. */
  if (configuredChainId === liveChainId) ok(`CHAIN_ID ${configuredChainId} matches the RPC`)
  else bad(`CHAIN_ID is ${configuredChainId} but the RPC is chain ${liveChainId} — every signature would verify nowhere`)

  const claims = getAddress(claimsEnv) as Address
  const pad = getAddress(vitePad) as Address

  for (const [label, addr] of [['the vault', claims], ['the launchpad', pad]] as const) {
    const code = await client.getCode({ address: addr })
    if (code && code !== '0x') ok(`there is code at ${label} (${addr})`)
    else bad(`NOTHING IS DEPLOYED at ${label} (${addr}) on chain ${liveChainId}`)
  }
  if (failures) {
    console.log(`\n${RED}⛔ ${failures} problem(s). Stopping before reading contract state.${OFF}\n`)
    process.exit(1)
  }

  const [onChainOwner, onChainSigner, paused, onChainDomain] = await Promise.all([
    client.readContract({ address: claims, abi: CLAIMS_ABI, functionName: 'owner' }),
    client.readContract({ address: claims, abi: CLAIMS_ABI, functionName: 'signer' }),
    client.readContract({ address: claims, abi: CLAIMS_ABI, functionName: 'paused' }),
    client.readContract({ address: claims, abi: CLAIMS_ABI, functionName: 'domainSeparator' }),
  ])

  /* ------------------------------------------------------------ the signer -- */

  console.log('\nthe attestation path')

  if (key && /^0x[0-9a-fA-F]{64}$/.test(key)) {
    /* ⭐ Derived from the key the SERVER will actually load, not from a value pasted into a note.
       This is the single check the whole file exists for. */
    const derived = privateKeyToAccount(key as Hex).address
    if (same(derived, onChainSigner)) {
      ok(`the server's key signs as ${derived}, which is the vault's signer`)
    } else {
      bad(
        `THE SERVER'S KEY IS NOT THE VAULT'S SIGNER.\n` +
          `       server signs as   ${derived}\n` +
          `       vault expects     ${onChainSigner}\n` +
          `       ➤ Every social claim reverts as a bad signature. Wallet claims keep working and\n` +
          `         nothing else looks wrong. Fix ATTESTATION_KEY, or have the cold owner call\n` +
          `         setSigner(${derived}).`,
      )
    }

    /* ⭐⭐ THE WHOLE DOMAIN IN ONE COMPARISON. Rebuilt from the constants the signing code actually
       uses and the config the server actually loaded, then compared to the separator baked into the
       deployed vault. It catches a wrong chain id, a wrong vault address, and any drift in the
       contract's NAME or VERSION strings — all of which produce the same unreadable symptom. */
    const localDomain = hashDomain({
      domain: { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId: BigInt(configuredChainId), verifyingContract: claims },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
      },
    })
    if (same(localDomain, onChainDomain)) {
      ok("the server's EIP-712 domain separator matches the deployed vault's")
    } else {
      bad(
        `THE EIP-712 DOMAINS DO NOT MATCH — signatures would verify nowhere.\n` +
          `       server  ${localDomain}\n` +
          `       vault   ${onChainDomain}\n` +
          `       ➤ chain id, vault address, or the contract's NAME/VERSION has moved.`,
      )
    }
  } else {
    warn(`skipped: no usable ATTESTATION_KEY. The vault expects ${onChainSigner}`)
  }

  /* ⛔ The separation the deploy script refuses to break, verified on the LIVE deployment rather
     than on the arguments somebody meant to pass. One key doing both jobs means the thing that
     revokes a stolen signer is the stolen key. */
  if (same(onChainOwner, onChainSigner)) {
    bad(`the vault's owner and signer are the SAME address (${onChainOwner}) — a stolen signer could not be revoked`)
  } else {
    ok(`owner ${onChainOwner} is not the signer`)
  }

  if (paused) warn('the vault is PAUSED — no claim of any kind will go through')
  else ok('the vault is not paused')

  /* ------------------------------------------------------------ the launchpad -- */

  console.log('\nthe launchpad')

  const [padClaims, factory, padEscrow, floor, launchCount] = await Promise.all([
    client.readContract({ address: pad, abi: PAD_ABI, functionName: 'claims' }),
    client.readContract({ address: pad, abi: PAD_ABI, functionName: 'factory' }),
    client.readContract({ address: pad, abi: PAD_ABI, functionName: 'escrow' }),
    client.readContract({ address: pad, abi: PAD_ABI, functionName: 'minSocialBps' }),
    client.readContract({ address: pad, abi: PAD_ABI, functionName: 'count' }),
  ])

  /* ⛔⛔ THE LAUNCHPAD CREDITS ONE VAULT AND IT CANNOT BE REPOINTED. If it is not the vault the
     server signs for, every launch made here accrues into a ledger nobody reads and no attestation
     can ever unlock. Both contracts are real and both answer every call. */
  if (same(padClaims, claims)) ok('the launchpad credits the vault the server signs for')
  else bad(`the launchpad credits ${padClaims}, but the server signs for ${claims} — launches would accrue where nobody can claim them`)

  const factoryCode = await client.getCode({ address: factory })
  if (factoryCode && factoryCode !== '0x') {
    ok(`Pons factory ${factory} has code`)

    const [enabled, liveEscrow] = await Promise.all([
      client.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'launchEnabled' }),
      client.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'feeEscrow' }),
    ])
    if (enabled) ok('Pons has launches OPEN')
    else warn('Pons has CLOSED launches on this factory — existing tokens still earn, but nothing new can launch')

    /* ⚠ The launchpad caches the escrow at construction. Pons repointing it later is not a
       deployment mistake, but it does mean harvest pulls from a ledger that is no longer credited. */
    if (same(padEscrow, liveEscrow)) ok('the launchpad harvests the escrow Pons currently uses')
    else bad(`the launchpad cached escrow ${padEscrow} but Pons now uses ${liveEscrow} — harvest would pull from the wrong ledger`)
  } else {
    bad(`the launchpad points at ${factory}, where there is NO CODE — no launch can ever succeed`)
  }

  /* ⛔⛔ IMMUTABLE, AND CHOSEN ONCE BY A SHELL VARIABLE. Reported every run because it is the one
     number here that cannot be corrected after the fact. */
  if (floor === 0) ok('minSocialBps 0 — any split is accepted, including one wallet at 100%')
  else warn(`minSocialBps is ${floor} — every launch giving social accounts less than ${floor / 100}% reverts FOREVER. There is no setter.`)

  ok(`${launchCount} launch(es) in the register`)

  /* ---------------------------------------------------------------- the urls -- */

  console.log('\nurls')

  const publicUrl = (process.env.PUBLIC_URL ?? '').replace(/\/+$/, '')
  const siteUrl = (web.VITE_SITE_URL ?? '').replace(/\/+$/, '')

  /* ⛔ Every OAuth callback is registered against one exact URL built from PUBLIC_URL. If the site
     and the API disagree about the origin, sign-in redirects somewhere that is not this deployment
     and the provider's error names the app rather than the setting. */
  /* ⚠ A LOCAL SERVER CHECKED AGAINST THE PRODUCTION SITE CONFIG IS NOT A MISCONFIGURATION.
     `server/.env` on a laptop points at localhost while `web/.env.production` names the real domain,
     and the two are supposed to differ — they are different tiers. Reported as a failure, this told
     an operator their fresh, perfectly wired deployment was broken, which is the fastest way to
     teach somebody to ignore a red line. ⛔ The on-chain half above is the part that is tier
     independent; only this URL pair is not. */
  const localDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(publicUrl)

  if (!publicUrl) warn('PUBLIC_URL is not set — OAuth callbacks would be built from http://localhost:5234')
  else if (!siteUrl) warn(`VITE_SITE_URL is not set in ${WEB_ENV} — absolute URLs and og tags have no base`)
  else if (same(publicUrl, siteUrl)) ok(`the site and the API agree the origin is ${publicUrl}`)
  else if (localDev) {
    warn(
      `PUBLIC_URL is ${publicUrl} (local) and ${WEB_ENV} names ${siteUrl}.\n` +
        `       That is expected on a laptop — they are different tiers. ⛔ Run this ON the deployment\n` +
        `       to check the pair that actually serves OAuth callbacks.`,
    )
  } else bad(`PUBLIC_URL is ${publicUrl} but VITE_SITE_URL is ${siteUrl} — OAuth callbacks would leave this deployment`)

  // ⚠ Expected on a laptop; only worth saying when it is not one.
  if (publicUrl && !publicUrl.startsWith('https://') && !localDev) {
    warn('PUBLIC_URL is not https — session cookies will not be marked Secure')
  }

  /* ------------------------------------------------------------------ verdict -- */

  console.log('')
  if (failures) {
    console.log(`${RED}⛔ ${failures} problem(s)${warnings ? `, ${warnings} warning(s)` : ''}. Do not open this to the public.${OFF}\n`)
    process.exit(1)
  }
  console.log(
    `${GREEN}✅ the contracts, the server and the site all describe the same deployment.${OFF}` +
      (warnings ? ` ${YELLOW}${warnings} warning(s) above.${OFF}` : ''),
  )
  console.log('')
}

main().catch((e) => {
  /* ⛔ A read that did not answer is NOT a pass. An RPC timeout here must never be reported as a
     healthy deployment — that is exactly how a confident zero gets built on this stack. */
  console.error(`\n${RED}⛔ preflight could not finish: ${e instanceof Error ? e.message : String(e)}${OFF}`)
  console.error('   Nothing above was verified. This is not a pass.\n')
  process.exit(2)
})
