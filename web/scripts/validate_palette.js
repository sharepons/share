#!/usr/bin/env node
/*
 * The split-bar palette gate.
 *
 * ## ⛔⛔ WHY THIS EXISTS
 *
 * `src/styles.css` says the eight series colours are "validated, not chosen", and tells the next
 * person to run this before touching a value. For a while it said that about a file that did not
 * exist — the palette was checked once, by hand, and the command in the comment was a promise
 * rather than a tool. This is that tool.
 *
 * ## What it checks, and why each one is here
 *
 * 1. **3:1 contrast against the surface.** A bar segment is a non-text graphical object; below 3:1
 *    it disappears against the card it sits on. WCAG 1.4.11.
 * 2. **A lightness band.** Eight colours that wander across the lightness range read as a heap
 *    rather than a set. The band is where the ceiling lives too: on a LIGHT ground a pale segment
 *    is invisible, which is the opposite of the dark-ground failure.
 * 3. **A chroma floor.** A washed-out segment cannot be told from a grey rule.
 * 4. **Adjacent-pair separation under three kinds of colour blindness.** Adjacent segments touch,
 *    so those are the pairs a reader actually compares. Simulated with Machado 2009 at full
 *    severity for protanopia, deuteranopia and tritanopia.
 * 5. **A normal-vision floor across ALL pairs**, not only adjacent ones — the legend lists every
 *    recipient, so any two can be compared even when they are not neighbours.
 *
 * ⚠ COLOUR IS NEVER THE ONLY CHANNEL ANYWAY. Every segment carries a 2px surface gap and a direct
 * label in the legend beneath it. This gate is what keeps the bar readable, not what makes it
 * accessible on its own — that is the labelling, and no threshold here replaces it.
 *
 *   node scripts/validate_palette.js "#a #b …"  --mode light --surface "#ffffff"
 *   node scripts/validate_palette.js            --mode light --surface "#ffffff"   # reads styles.css
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/* ------------------------------------------------------------------ colour -- */

const hexToRgb = (h) => {
  const s = h.trim().replace(/^#/, '')
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16))
}
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** ⚠ The sRGB transfer function, not a 2.2 power curve. The linear segment near black is where the
    cheap approximation is most wrong, and dark series colours live exactly there. */
const toLinear = (c) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const fromLinear = (l) => {
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055
  return c * 255
}

const relLuminance = ([r, g, b]) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)

const contrast = (a, b) => {
  const [x, y] = [relLuminance(a), relLuminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/* CIE Lab, D65. */
function rgbToLab(rgb) {
  const [r, g, b] = rgb.map(toLinear)
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29)
  const [fx, fy, fz] = [f(x), f(y), f(z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

const chroma = (rgb) => {
  const [, a, b] = rgbToLab(rgb)
  return Math.hypot(a, b)
}

/**
 * CIEDE2000. ⚠ Not ΔE76 — on saturated blues ΔE76 overstates the difference badly, and blue against
 * blue-purple is exactly the adjacency this palette has to survive.
 */
function deltaE(rgb1, rgb2) {
  const [L1, a1, b1] = rgbToLab(rgb1)
  const [L2, a2, b2] = rgbToLab(rgb2)
  const kL = 1, kC = 1, kH = 1
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2)
  const Cb = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2)
  const deg = (r) => ((r * 180) / Math.PI + 360) % 360
  const hp1 = Cp1 === 0 ? 0 : deg(Math.atan2(b1, ap1))
  const hp2 = Cp2 === 0 ? 0 : deg(Math.atan2(b2, ap2))
  const dL = L2 - L1, dC = Cp2 - Cp1
  let dh = 0
  if (Cp1 * Cp2 !== 0) {
    dh = hp2 - hp1
    if (dh > 180) dh -= 360
    else if (dh < -180) dh += 360
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh * Math.PI) / 360)
  const Lb = (L1 + L2) / 2, Cpb = (Cp1 + Cp2) / 2
  let hb
  if (Cp1 * Cp2 === 0) hb = hp1 + hp2
  else if (Math.abs(hp1 - hp2) <= 180) hb = (hp1 + hp2) / 2
  else hb = hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2
  const T =
    1 -
    0.17 * Math.cos(((hb - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hb * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hb + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hb - 63) * Math.PI) / 180)
  const dTheta = 30 * Math.exp(-(((hb - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7))
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2)
  const Sc = 1 + 0.045 * Cpb
  const Sh = 1 + 0.015 * Cpb * T
  const Rt = -Math.sin((2 * dTheta * Math.PI) / 180) * Rc
  return Math.sqrt(
    (dL / (kL * Sl)) ** 2 + (dC / (kC * Sc)) ** 2 + (dH / (kH * Sh)) ** 2 + Rt * (dC / (kC * Sc)) * (dH / (kH * Sh))
  )
}

/**
 * Machado, Oliveira & Fernandes (2009), severity 1.0.
 * ⚠ Applied in LINEAR light. Applied to gamma-encoded values — the easy mistake — it lightens
 * everything and quietly reports separations that a real reader does not get.
 */
const CVD = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
}

function simulate(rgb, kind) {
  const m = CVD[kind]
  const [r, g, b] = rgb.map(toLinear)
  return [
    fromLinear(clamp(m[0] * r + m[1] * g + m[2] * b, 0, 1)),
    fromLinear(clamp(m[3] * r + m[4] * g + m[5] * b, 0, 1)),
    fromLinear(clamp(m[6] * r + m[7] * g + m[8] * b, 0, 1)),
  ].map((v) => clamp(v, 0, 255))
}

/* ------------------------------------------------------------------- gate -- */

const THRESHOLDS = {
  contrastMin: 3.0,
  chromaMin: 20,
  cvdAdjacentMin: 8.0,
  normalAllPairsMin: 12.0,
  /* ⛔ The band flips with the ground. On a light surface the DANGER is a pale segment washing out,
     so the ceiling is what bites; on a dark one it is the floor. */
  light: { Lmin: 30, Lmax: 68 },
  dark: { Lmin: 45, Lmax: 82 },
}

function parseArgs(argv) {
  const out = { colors: null, mode: 'light', surface: null }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mode') out.mode = argv[++i]
    else if (argv[i] === '--surface') out.surface = argv[++i]
    else rest.push(argv[i])
  }
  if (rest.length) out.colors = rest.join(' ').trim().split(/[\s,]+/).filter(Boolean)
  return out
}

function fromStylesheet() {
  const here = dirname(fileURLToPath(import.meta.url))
  const css = readFileSync(join(here, '..', 'src', 'styles.css'), 'utf8')
  const found = []
  for (let i = 1; i <= 8; i++) {
    const m = css.match(new RegExp(`--s${i}:\\s*(#[0-9a-fA-F]{3,6})`))
    if (!m) throw new Error(`--s${i} not found in src/styles.css`)
    found.push(m[1])
  }
  const surf = css.match(/--surface:\s*(#[0-9a-fA-F]{3,6})/)
  return { colors: found, surface: surf?.[1] }
}

const args = parseArgs(process.argv.slice(2))
let colors = args.colors
let surface = args.surface
if (!colors) {
  const read = fromStylesheet()
  colors = read.colors
  surface = surface ?? read.surface
}
if (!surface) surface = args.mode === 'light' ? '#ffffff' : '#12151b'
const band = THRESHOLDS[args.mode] ?? THRESHOLDS.light

const rgbs = colors.map(hexToRgb)
const surfRgb = hexToRgb(surface)
const failures = []
const pad = (s, n) => String(s).padEnd(n)

console.log(`\npalette gate — ${colors.length} colours, mode ${args.mode}, surface ${surface}\n`)

console.log('  #   colour     contrast   L*     chroma')
colors.forEach((hex, i) => {
  const c = contrast(rgbs[i], surfRgb)
  const [L] = rgbToLab(rgbs[i])
  const ch = chroma(rgbs[i])
  const bad = []
  if (c < THRESHOLDS.contrastMin) bad.push(`contrast ${c.toFixed(2)} < ${THRESHOLDS.contrastMin}`)
  if (L < band.Lmin || L > band.Lmax) bad.push(`L* ${L.toFixed(1)} outside ${band.Lmin}–${band.Lmax}`)
  if (ch < THRESHOLDS.chromaMin) bad.push(`chroma ${ch.toFixed(1)} < ${THRESHOLDS.chromaMin}`)
  console.log(
    `  s${i + 1}  ${pad(hex, 10)} ${pad(c.toFixed(2) + ':1', 10)} ${pad(L.toFixed(1), 6)} ${pad(ch.toFixed(1), 6)} ${
      bad.length ? '⛔ ' + bad.join('; ') : ''
    }`
  )
  bad.forEach((b) => failures.push(`s${i + 1} ${hex}: ${b}`))
})

/* Adjacent pairs, under each kind of colour blindness. These are the ones that touch. */
console.log('\n  adjacent separation (ΔE2000)')
console.log('  pair      normal   protan   deutan   tritan')
let worstCvd = Infinity
for (let i = 0; i < rgbs.length - 1; i++) {
  const a = rgbs[i], b = rgbs[i + 1]
  const n = deltaE(a, b)
  const row = ['protanopia', 'deuteranopia', 'tritanopia'].map((k) => deltaE(simulate(a, k), simulate(b, k)))
  const min = Math.min(...row)
  worstCvd = Math.min(worstCvd, min)
  const flag = min < THRESHOLDS.cvdAdjacentMin ? '⛔' : ''
  console.log(
    `  s${i + 1}-s${i + 2}   ${pad(n.toFixed(1), 8)} ${row.map((v) => pad(v.toFixed(1), 8)).join(' ')} ${flag}`
  )
  if (min < THRESHOLDS.cvdAdjacentMin)
    failures.push(`s${i + 1}-s${i + 2}: CVD ΔE ${min.toFixed(1)} < ${THRESHOLDS.cvdAdjacentMin}`)
}

/* Every pair, normal vision — the legend lists them all. */
let worstAll = Infinity
let worstPair = ''
for (let i = 0; i < rgbs.length; i++) {
  for (let j = i + 1; j < rgbs.length; j++) {
    const d = deltaE(rgbs[i], rgbs[j])
    if (d < worstAll) {
      worstAll = d
      worstPair = `s${i + 1}-s${j + 1}`
    }
  }
}
if (worstAll < THRESHOLDS.normalAllPairsMin)
  failures.push(`${worstPair}: normal-vision ΔE ${worstAll.toFixed(1)} < ${THRESHOLDS.normalAllPairsMin}`)

console.log(`\n  worst adjacent CVD ΔE   ${worstCvd.toFixed(1)}  (floor ${THRESHOLDS.cvdAdjacentMin})`)
console.log(`  worst any-pair ΔE       ${worstAll.toFixed(1)}  ${worstPair}  (floor ${THRESHOLDS.normalAllPairsMin})`)

if (failures.length) {
  console.log(`\n⛔ ${failures.length} FAILURE${failures.length > 1 ? 'S' : ''}\n`)
  failures.forEach((f) => console.log('   ' + f))
  console.log('')
  process.exit(1)
}
console.log('\n✅ palette passes\n')
