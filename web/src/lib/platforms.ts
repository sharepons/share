/**
 * The four places a recipient can be, and everything the interface needs to draw one.
 *
 * ## ⛔⛔ `keyedBy` IS THE MOST IMPORTANT FIELD ON THIS PAGE
 *
 * X and GitHub publish an endpoint that turns a typed handle into a stable numeric id, so a share
 * aimed at them is aimed at an ACCOUNT: the recipient can rename themselves and still be paid.
 *
 * Instagram and TikTok publish no such endpoint — neither will say who `@jane` is until she has
 * personally authorised this app, which has not happened at the moment somebody launches a token for
 * her. So those shares are keyed by the HANDLE, and the share follows the NAME. If the account is
 * renamed and somebody else registers the old name, the new holder can claim it.
 *
 * ➤ That is stated on the launch form, on the token page and in the docs. It is a real weakness of
 * those two platforms and the alternative was refusing them entirely.
 */
import type { ReactNode } from 'react'

export const PLATFORMS = ['wallet', 'x', 'github', 'instagram', 'tiktok'] as const
export type Platform = (typeof PLATFORMS)[number]

/**
 * ⛔⛔⛔ `PLATFORMS` IS A WIRE FORMAT. DO NOT REORDER IT TO CHANGE HOW A MENU LOOKS.
 *
 * `platformIndex` is this array's index, and that integer is sent on chain as Solidity's
 * `ShareKeys.Platform` enum — `Wallet = 0, X = 1, GitHub = 2, Instagram = 3, TikTok = 4`. Moving an
 * entry does not fail: the launch succeeds and every recipient is recorded under the WRONG platform,
 * so a wallet is stored as a TikTok handle and the money is keyed to a string nobody can sign in as.
 *
 * ➤ To change the ORDER SOMETHING IS SHOWN IN, use `PLATFORM_ORDER` below. It exists for exactly
 *   this reason and is display-only.
 */
export const platformIndex = (p: Platform): number => PLATFORMS.indexOf(p)
export const platformFromIndex = (i: number): Platform => PLATFORMS[i] ?? 'wallet'

/**
 * The order a person is offered these in, which is NOT the order they are encoded in.
 * ⚠ A wallet is last because it is the fallback choice — most launches name accounts, and leading
 * with the one option that is not a social account framed the whole form as being about addresses.
 */
export const PLATFORM_ORDER: Platform[] = ['x', 'github', 'instagram', 'tiktok', 'wallet']

export type PlatformMeta = {
  id: Platform
  label: string
  /** How a person is addressed there, for placeholder text. */
  prefix: string
  keyedBy: 'id' | 'handle' | 'address'
  /** The brand colour, used only as a 2px edge on the avatar. ⛔ Never as a fill behind text. */
  tint: string
  profileUrl: (handle: string) => string
}

export const PLATFORM_META: Record<Platform, PlatformMeta> = {
  wallet: {
    id: 'wallet',
    label: 'Wallet',
    prefix: '0x',
    keyedBy: 'address',
    tint: '#8A93A6',
    profileUrl: (a) => `https://robinhoodchain.blockscout.com/address/${a}`,
  },
  x: {
    id: 'x',
    label: 'X',
    prefix: '@',
    keyedBy: 'id',
    tint: '#E9EDF5',
    profileUrl: (h) => `https://x.com/${h.replace(/^@/, '')}`,
  },
  github: {
    id: 'github',
    label: 'GitHub',
    prefix: '',
    keyedBy: 'id',
    tint: '#B8C0D0',
    profileUrl: (h) => `https://github.com/${h.replace(/^@/, '')}`,
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    prefix: '@',
    keyedBy: 'handle',
    tint: '#E1568C',
    profileUrl: (h) => `https://instagram.com/${h.replace(/^@/, '')}`,
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    prefix: '@',
    keyedBy: 'handle',
    tint: '#25E8E0',
    profileUrl: (h) => `https://www.tiktok.com/@${h.replace(/^@/, '')}`,
  },
}

export const SOCIALS: Platform[] = ['x', 'github', 'instagram', 'tiktok']

export const isPlatform = (v: unknown): v is Platform =>
  typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v)

/** How a recipient is written in prose and on a card. */
export function displayName(platform: Platform, handle: string, wallet?: string): string {
  if (platform === 'wallet') return wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'a wallet'
  const clean = handle.replace(/^@/, '')
  return platform === 'github' ? clean : `@${clean}`
}

export type IconProps = { className?: string }
export type Icon = (props: IconProps) => ReactNode
