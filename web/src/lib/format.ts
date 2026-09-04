import { formatUnits } from 'viem'

/** ⚠ Never rounds a real balance to `0`. A recipient looking at their own share reads a zero as
 *  "there is nothing", and the difference between nothing and nearly nothing matters to them. */
export function amount(v: bigint, decimals: number, max = 4): string {
  const n = Number(formatUnits(v, decimals))
  if (n === 0) return '0'
  if (n < 0.0001) return '<0.0001'
  return n.toLocaleString('en-US', { maximumFractionDigits: max })
}

/** USD, scaled by 1e6. ⛔ `null` renders as a dash. A missing figure must never render as $0. */
export function usd(scaled: bigint | null): string {
  if (scaled === null) return '—'
  const n = Number(scaled) / 1e6
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n === 0) return '$0'
  return `$${n.toFixed(4)}`
}

export const pct = (bps: number) => `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`

export function ago(unixSeconds: bigint | number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - Number(unixSeconds))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(Number(unixSeconds) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export const short = (a?: string, n = 4) => (!a ? '' : `${a.slice(0, 2 + n)}…${a.slice(-n)}`)
