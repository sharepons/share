# SHARE — specification

Everything that is true by construction, and the reasoning that put it there.

---

## 1. The identity scheme

A recipient is a string. The money is keyed by its `keccak256`.

```
x:1465280448          an X account, by numeric id
github:583231         a GitHub user, by numeric id
instagram:@jane       an Instagram account, by lower-cased handle
tiktok:@jane          a TikTok account, by lower-cased handle
wallet:0xabc…def      an address, lower cased, always
```

### ⛔⛔ Three implementations, one scheme

| Where | File | Job |
|---|---|---|
| chain | `contracts/src/ShareKeys.sol` | derives the key that gets paid |
| server | `server/src/identity.ts` | derives the key it attests to |
| browser | `web/src/lib/beneficiary.ts` | derives the key a launcher is shown before signing |

If any two drift, a launch is recorded paying one account while the money sits under another: every
claim reverts and the failure reads as a contract bug. All three test suites hard-code the *same*
vectors rather than sharing a helper that could be wrong in three places at once —
`contracts/test/Keys.t.sol`, `server/test/identity.test.ts`, `web/test/beneficiary.test.mjs`.

### ⛔⛔ The key is derived on chain, never supplied

`ShareLaunchpad` takes a platform and an account reference and builds the string itself. It does not
accept a `bytes32`. The consequence is the whole point: a listing that claims to pay `@octocat` and a
splitter that pays somebody else **cannot both exist**, because the label and the key are the same
bytes. Anybody can hash the string in the register and find it in the splitter.

### ⛔⛔ Why two platforms are keyed by handle

X and GitHub publish a public endpoint mapping a handle to a stable numeric id that is never
reissued. Instagram and TikTok publish nothing of the kind: neither will say who a username belongs
to until that person has authorised this app, and both then issue ids scoped to the *asking app*, so
even after sign-in the number is not an identifier anybody else could have used.

Two honest options existed: refuse those platforms, or key them by handle and disclose it. This keys
them by handle and discloses it — on the launch form (per row, every time), on the token page, in the
FAQ, in the docs page, and in three source files. **An Instagram or TikTok share follows the name.**

### Canonical forms, enforced on chain

- X / GitHub: decimal digits only, no leading zero (`07` and `7` are one account and would be two
  beneficiaries).
- Instagram / TikTok: lower-cased on chain; charset is the intersection of what both platforms allow
  (`[a-z0-9._]`). A pasted URL or an at-sign is refused, not hashed.
- Wallet: lower-case hex, never EIP-55. An address arrives checksummed from a wallet and lower-cased
  from tooling; hashing the string means two spellings are two people, so exactly one spelling exists.

---

## 2. The contracts

### `ShareLaunchpad`

One call, or nothing:

1. deploys a `ShareSplitter` with the recipients and shares as constructor arguments;
2. launches on Pons V2 with `creatorFeeRecipient` set to that splitter;
3. binds the token to the splitter and records the split in an array register.

**Atomic because the alternative has a window in it.** Three separate transactions leave a live token
trading under somebody's handle while its fees land in the launcher's wallet — the precise thing this
exists to make impossible.

Enforced:

| Rule | Why |
|---|---|
| shares sum to exactly `10000` | a short sum leaves a remainder in a contract with no withdraw — a slow leak rather than a revert |
| social recipients hold ≥ `minSocialBps` | without a floor, a launch paying a stranger 1% still carries their name, avatar and listing |
| wallets do not count towards that floor | a launcher paying themselves is not sharing |
| no duplicate beneficiary | the vault credits per beneficiary and the site renders per row; two rows for one person means neither number is what they get |
| ≤ 8 recipients | every release loops the list; an unbounded split costs more gas to distribute than it is worth |
| a social row must carry a handle | otherwise it renders as an anonymous hash everywhere it appears |

**The register is an array, not events.** Robinhood Chain makes a block roughly every 100ms — about
861,000 a day — and the public RPC caps `eth_getLogs` at 2,000 blocks, about three minutes of
history. A feed built on events is unreadable from a browser and needs an indexer, a cursor, a
database and a daemon. An `eth_call` against an array needs none of those and cannot fall behind.

### `ShareSplitter`

One per launch. No owner, no setters, no upgrade path, no arbitrary call, no withdraw.

- `harvest()` / `harvestToken(asset)` — **both, always.** Pons keeps two escrow ledgers and a launch
  lands in exactly one; a launch paired against USDG credits only the token side and its native
  balance reads a truthful, useless zero forever. Calling the wrong one succeeds and moves nothing.
- `sweepCurve` / `sweepPool` — passthroughs. Pons refuses `sweepFees` from everyone but its own
  operator and the fee recipient, which is the splitter. Without these, nobody on this side could
  move a launch's fees at all. `sweepPool` is the graduated case: graduating kills the curve, fees
  start accruing in the meme hook, and a launchpad that only knows `sweepCurve` can neither move a
  graduated launch's fees nor *see* them.
- `_release` works off the **balance**, so a direct transfer in is split on the same terms as a fee.
- Sub-unit dust goes to the first recipient — at most `n-1` of the smallest unit per release.
- A recipient rounded to zero is skipped rather than reverting the whole release.

**Every pair asset works here.** The charity launchpad this grew out of had to sell tokenized stocks
into USDG first, because its money had to leave the chain over a bridge carrying two assets. SHARE
pays on this chain in whatever the launch was paired against, so there is no bridge, no seller, no
blocked asset and no conversion slippage anywhere in the path.

### `ShareClaims`

The vault. Money enters against a named `(launch, beneficiary, asset)` triple and a claim can only
ever draw what that exact triple was credited. One recipient being paid from another's fees is not
prevented by a rule — it is **unrepresentable**.

- **Funding is permissionless.** Crediting somebody is only ever generous.
- **There is no `receive`.** Money arriving without naming a launch cannot be attributed, and a
  contract holding unattributable money is a contract somebody will eventually argue over.
- **Fee-on-transfer tokens credit what ARRIVED**, measured, not what was requested. Crediting the
  requested figure promises money the contract does not hold, and the shortfall surfaces as a revert
  on somebody's claim weeks later.
- **`sweepStray` cannot reach below `outstanding`.** The owner takes exactly what the contract holds
  beyond what it owes, which for a healthy vault is zero.
- **Pause blocks claims only.** Funding is never pausable, or a pause would strand fees in a splitter
  that has no way to hold them.
- Ownership handover is two-step. Signature `s` is range-checked (malleability refused).

#### ⭐⭐ The attestation carries no amount

```solidity
Attestation(bytes32 beneficiary, address recipient, uint256 deadline, bytes32 salt)
```

The voucher pattern this replaces has a server compute what somebody earned and sign for that number,
putting the arithmetic of every payout inside an unauditable process. Here the splitter already
divided on chain, so the amount is a subtraction the vault performs on its own ledger. The signer's
whole job is *"this browser proved it holds X account 12345"* — the one thing a contract genuinely
cannot check.

**Blast radius of a stolen signing key:** redirect *unclaimed* social balances to an address of the
attacker's choosing, until `owner` calls `setSigner`. It cannot invent money, touch a claimed
balance, or change a split. A wallet share is not exposed to it at all.

`claimAsWallet` needs nobody: the vault recomputes `wallet:0x…` from `msg.sender`, so a launcher who
kept a share of their own launch can claim it from a block explorer with this site closed.

One attestation covers a whole transaction, however many launches it pays.

---

## 3. The server

The only thing a static page cannot do: prove which account somebody is.

- **It never sends money and never decides an amount.** Every payout is a transaction the recipient
  submits and pays for.
- **It is not load-bearing for the site.** The launch feed, every split, every balance and every
  market cap are `eth_call`s made in the visitor's own browser. This being down means nobody can sign
  in; it does not mean a single number is wrong or missing.
- Binds to `127.0.0.1`, never `0.0.0.0`.
- `/api/health` answers **503** when claiming cannot happen, even though the site is fine. A health
  check that stays green while the one thing the server exists for is switched off is a health check
  nobody should have written.
- Sign-in state is checked against the server's record **and** the browser's cookie. Either alone
  leaves the flow forgeable.
- Handle lookup and sign-in are **separate capabilities**, reported separately. GitHub's user
  endpoint is public, so a GitHub recipient can be named on a launch even where no GitHub OAuth app
  exists; only their eventual claim needs one.

### Per-platform notes that cost time to rediscover

- **X** — PKCE `S256`, never `plain`. Handle lookup needs an app **bearer**, separate configuration
  from the OAuth pair, prepaid per call against a balance held **per project**: a new app in a fresh
  project starts at zero even though an older app on the same login works. `402` means credits
  depleted and is not transient.
- **GitHub** — the token endpoint returns **form-encoded** unless asked for JSON; a parser that
  assumes JSON gets `undefined` for every field. Classic OAuth apps ignore PKCE, so `state` is doing
  the work. The API answers **403 without a User-Agent**, which reads like a permissions problem. It
  must be an **OAuth App**, not a GitHub App.
- **Instagram** — "Instagram API with Instagram Login"; the Basic Display API was shut down in
  December 2024, so most documentation on the internet describes a dead product. The code it hands
  back through the browser has `#_` appended, and sent as-is the exchange fails with a generic
  "invalid authorization code" that points at the app configuration.
- **TikTok** — `client_key`, not `client_id`, on **both** the authorize URL and the token exchange.
  The PKCE challenge is lower-case **hex**, not base64url. `user.info.profile` is the scope that
  carries `username`; `user.info.basic` alone gives a display name, which is not a handle anybody can
  be paid by.

---

## 4. The site

- Dark, committed, no theme toggle and no light palette hiding in a media query.
- The split bar is the mark: header, card top edge, hero, loading state.
- The split palette is **validated, not chosen** — eight hues in fixed order, checked against the
  exact surface for the lightness band, chroma floor, adjacent-pair separation under protanopia,
  deuteranopia and tritanopia, the normal-vision floor, and 3:1 contrast. Worst adjacent CVD ΔE 8.4;
  worst normal-vision ΔE 19.3. Every segment carries a 2px gap and a named legend row, so identity is
  never colour alone.
- **Rules, never shadows.** There is no `box-shadow` in the stylesheet.
- **Square actions, rounded content** — 8px buttons, 16px cards.
- Mono carries every number, with tabular figures.

### Figures the site refuses to fake

| Situation | What it shows |
|---|---|
| a market cap that cannot be read | a dash, never `$0` |
| a launch whose pair asset has no pool | excluded from the total, **and the count of exclusions is printed beside it** |
| fees still on the curve | zero, with a sentence saying a zero does not mean nothing was earned |
| an empty register vs. an undeployed contract | two different sentences; they look identical on screen and mean completely different things |
| an unreachable sign-in server vs. no configured provider | two different sentences, same reason |
| a balance below 0.0001 | `<0.0001`, never `0` |
