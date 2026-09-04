import { parseAbi, parseUnits, formatUnits, type Address, type Hex, type WalletClient } from 'viem'
import { publicClient, rhc } from './chain.ts'

/**
 * Burning tokens you hold.
 *
 * ## ⛔⛔ THIS IS THE ONLY IRREVERSIBLE THING A VISITOR CAN DO FROM THIS SITE
 *
 * Everything else here either moves money to whoever it already belonged to, or creates something.
 * This destroys. There is no undo, no admin, and nobody to appeal to — so every guard below is
 * about making the destructive call HARD TO MAKE BY ACCIDENT, not about making it convenient.
 *
 * ## ⛔⛔ `burn()` IS NOT "SEND TO 0xdEaD", AND THE DIFFERENCE IS PERMANENT
 *
 * A sibling project on this stack sent 29.37M tokens to `0x…dEaD` and called it a burn. It was a
 * TRANSFER: the tokens are unreachable, but `totalSupply` still reads 1,000,000,000 and always
 * will, so every market cap, every percentage and every holder chart computed from supply is wrong
 * for the life of that token. ➤ This module calls the token's real `burn(uint256)`, which reduces
 * `totalSupply`, and `burnedSupplyDrop` below verifies exactly that — **the supply FELL**, never
 * that tokens arrived somewhere.
 */

/** ERC20Burnable. ⛔ Confirmed present in $SHARE's deployed bytecode as `0x42966c68`, not assumed. */
export const BURN_ABI = parseAbi([
  'function burn(uint256 amount)',
  'function balanceOf(address owner) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
])

/**
 * Who is shown the burn control.
 *
 * ⛔⛔ A VISIBILITY GATE, NOT A PERMISSION. `burn` is permissionless — it destroys the CALLER's own
 * tokens and can never touch anybody else's — so there is nothing here to protect. This exists only
 * to keep a destructive control out of the way of people who did not ask for it.
 * ⚠ And the repo is PUBLIC: this address is already in the bundle for the first-launch gate.
 * Anybody can read it. Nothing about hiding the button is a secret, and it must never be described
 * as one.
 *
 * ⚠ Case-folded on both sides — a wallet hands back a checksummed address and viem some paths
 * lower-cased. @see lib/launchGate.ts, which had the same rule for the same reason.
 */
export const BURN_OPERATOR = '0x3c5EDCb0c426828E8B237e81Bd5937964a822434'

export function canSeeBurn(address: string | null | undefined): boolean {
  if (!address) return false
  return address.toLowerCase() === BURN_OPERATOR.toLowerCase()
}

export type BurnAmountCheck =
  | { ok: true; wei: bigint; display: string }
  | { ok: false; wei: null; error: string }

/**
 * Turn what somebody typed into an exact wei amount, or refuse.
 *
 * ⛔⛔ THE DECIMALS TRAP IS THE WHOLE REASON THIS IS A FUNCTION. A holder of 22,801,302 tokens who
 * types `22801302` means 22.8 million tokens — 2.28e25 wei. Passing that number straight to a
 * uint256 field burns 0.000000000000022801302 of a token and looks like the burn silently did
 * nothing. Reading it the other way round — treating a wei figure as tokens — is the same mistake
 * with the opposite, catastrophic sign. `parseUnits` is the only correct conversion and the field
 * is always in TOKENS.
 *
 * ⚠ Refuses more than the balance HERE rather than letting the node revert: an on-chain revert
 * costs a wallet round trip to say something the browser already knew.
 */
export function checkBurnAmount(input: string, balance: bigint, decimals: number): BurnAmountCheck {
  const v = input.trim().replace(/,/g, '')
  if (!v) return { ok: false, wei: null, error: 'Enter how many tokens to burn.' }
  if (!/^\d+(\.\d+)?$/.test(v)) return { ok: false, wei: null, error: 'Numbers only — this is an amount of tokens, not wei.' }

  /* ⛔⛔ CHECKED BEFORE parseUnits, BECAUSE parseUnits DOES NOT THROW — IT SILENTLY TRUNCATES.
     Discovered by a test that asserted the opposite and failed. Relying on the catch below meant
     this guard never ran: 19 decimal places on an 18-decimal token quietly became 18, and the
     amount burned was not the amount typed. ⚠ Small here, but "silently changes what the user
     typed" is exactly the class of bug this whole file exists to prevent. */
  const frac = v.split('.')[1] ?? ''
  if (frac.length > decimals) {
    return { ok: false, wei: null, error: `That is more precise than ${decimals} decimals.` }
  }

  let wei: bigint
  try {
    wei = parseUnits(v, decimals)
  } catch {
    return { ok: false, wei: null, error: 'That is not an amount this token can represent.' }
  }

  if (wei <= 0n) return { ok: false, wei: null, error: 'Burn has to be more than zero.' }
  if (wei > balance) {
    return { ok: false, wei: null, error: `You hold ${formatUnits(balance, decimals)}, which is less than that.` }
  }
  return { ok: true, wei, display: formatUnits(wei, decimals) }
}

/** ⚠ Read fresh at the moment of burning, never taken from a page that may have been open for hours. */
export async function readBurnState(token: Address, owner: Address) {
  const [balance, totalSupply, decimals] = await Promise.all([
    publicClient.readContract({ address: token, abi: BURN_ABI, functionName: 'balanceOf', args: [owner] }),
    publicClient.readContract({ address: token, abi: BURN_ABI, functionName: 'totalSupply' }),
    publicClient.readContract({ address: token, abi: BURN_ABI, functionName: 'decimals' }),
  ])
  return { balance, totalSupply, decimals: Number(decimals) }
}

/**
 * ⛔ Simulated first, ALWAYS. A token without ERC20Burnable has no `burn` at all, and the failure
 * without a simulation is a wallet popup for a transaction that cannot succeed — the visitor pays
 * attention, approves, and watches it revert.
 */
export async function burnTokens(
  wallet: WalletClient,
  account: Address,
  token: Address,
  amountWei: bigint,
): Promise<Hex> {
  const { request } = await publicClient.simulateContract({
    address: token,
    abi: BURN_ABI,
    functionName: 'burn',
    args: [amountWei],
    account,
  })
  return wallet.writeContract({ ...request, chain: rhc, account })
}

/**
 * ⛔⛔ THE ONLY HONEST CONFIRMATION: DID `totalSupply` ACTUALLY FALL?
 *
 * Checking that a balance went down proves a transfer happened. Checking that `0x…dEaD` went up
 * proves the same thing. Neither distinguishes a real burn from the mistake at the top of this
 * file. Supply is the only number that moves if and only if tokens were destroyed.
 *
 * @returns how far supply dropped. ⚠ Zero means it did NOT burn, whatever else looked right.
 */
export async function burnedSupplyDrop(token: Address, supplyBefore: bigint): Promise<bigint> {
  const after = await publicClient.readContract({ address: token, abi: BURN_ABI, functionName: 'totalSupply' })
  return supplyBefore - (after as bigint)
}
