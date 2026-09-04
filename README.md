# SHARE

**Share Pons lets you split a token's trading fees between multiple people or accounts.**

Shares can be assigned to X accounts, GitHub accounts, Instagram accounts, TikTok accounts and
wallets.

Once the token is launched the fee split is locked and the distribution is automated.

**Live at:** [sharepons.family](https://sharepons.family) · Robinhood Chain · launches on Pons V2.

---

## 1. Set your split

Choose who should receive the fees and how much each recipient should receive.

You can split the fees between multiple accounts and assign a percentage to each one. The total
split must always equal 100%.

Recipients do not need to have a SHARE account or even a wallet when the token is launched. Their
share simply accrues until they claim it.

## 2. Launch the token

When you launch, SHARE creates a custom fee contract containing your split and deploys the token on
Pons with that contract set as its fee recipient.

Everything happens in a single transaction. If any part of the launch fails, the entire transaction
reverts.

Once the token is live, the fee split cannot be changed.

## 3. Fees are distributed automatically

As the token trades, creator fees accumulate on Pons.

When fees are collected, the contract distributes them according to the split defined at launch.
Each recipient receives their own balance, completely separate from everyone else's.

There is no manual distribution and no need for the launcher to send payments.

## 4. Recipients claim their share

Recipients can claim their accumulated fees whenever they want.

Wallet recipients can claim directly with their wallet. Social recipients can connect their X,
GitHub, Instagram, or TikTok account and claim any fees assigned to them.

There is no expiry on an unclaimed share. Once assigned, it remains available to that recipient.

## Built for transparency

The fee split is defined when the token is launched and enforced by the contracts.

The launchpad cannot change the percentages, redirect a recipient's share, or take control of the
fees after launch.

What you see in the split is what the contracts enforce onchain.

---

## Deployed contracts

Robinhood Chain, 4 September 2026. Neither contract has an upgrade path.

| | |
|---|---|
| `ShareLaunchpad` | `0x6E96c9EC71e60893F7C3084bECfAb712a72779f7` |
| `ShareClaims` | `0x3cA5569e679b6A4D271d93342B7Ca7ad8e3b46FC` |
| `ShareSplitter` | one per launch, created by the launchpad inside the launch transaction |

## Layout

```
contracts/   Foundry. ShareLaunchpad, ShareSplitter, ShareClaims, ShareKeys.  73 tests,
             plus fork suites against the real Pons V2 — launch, sweep, graduation.
server/      Node, no framework. OAuth for X / GitHub / Instagram / TikTok, attestation signing,
             logo hosting.  40 tests.
web/         React + Vite. The whole site; reads the chain directly.  43 tests.
```

## Running it

```bash
cd contracts && forge test              # no network needed
cd contracts && ./rehearse.sh           # against the LIVE Pons factory, on a local fork
cd server   && npm i && npm test
cd web      && npm i && npm test && npm run dev
```

`web` proxies `/api` to `http://127.0.0.1:5234` by default; set `SHARE_API` to point it elsewhere.

⚠ Vite watches stdin for its keyboard shortcuts and exits cleanly on EOF, so `npm run dev &` starts,
serves, and then quits with code 0 and no error in the log. Run it under `screen` or a real TTY.

## Deploying

```bash
cd contracts
OWNER=0x… SIGNER=0x… DEPLOYER_KEY=0x… ./deploy.sh     # prints the two addresses
```

`OWNER` and `SIGNER` must be different keys, and the script refuses if they are not: the signer
lives on a server and is the one that will eventually be stolen; the owner is what revokes it. Then
set `VITE_LAUNCHPAD` / `VITE_CLAIMS` in `web/.env.production` and `CLAIMS_ADDRESS` in `server/.env`,
and run `cd server && npm run preflight` — it checks the chain against both env files.

## What this cannot promise

Everything above is enforced by contracts with no owner and no setters. These are not:

- **Instagram and TikTok shares follow the NAME, not the account.** Neither platform publishes a way
  to resolve a username to an account, so there is nothing else to key on. If the account is renamed
  and somebody else registers the old handle, the new holder can claim it. X and GitHub do not have
  this problem — they are keyed by a numeric id that is never reissued.
- **The attestation key is a real dependency.** Stolen, it can redirect *unclaimed* social balances
  until the vault's owner rotates it — one transaction, from a key that never touches a server. It
  cannot invent money, touch a claimed balance, or change a split. A wallet share never involves it.
- **Nothing makes a recipient claim.** A share credited to an account nobody signs in as sits in the
  vault for good. There is no expiry and no reclaim: it was never conditional on them turning up.

## License

MIT.
