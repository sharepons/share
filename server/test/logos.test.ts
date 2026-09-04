import { strict as assert } from 'node:assert'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { sniff, storeLogo } from '../src/logos.ts'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

test('magic bytes decide, not the extension', () => {
  assert.equal(sniff(PNG), 'png')
  assert.equal(sniff(SVG), null)
})

/** ⛔⛔ An SVG is a document that can carry script, served from the origin of a page whose whole job
 *  is getting somebody to sign a transaction. */
test('an svg is refused however it is labelled', () => {
  const dir = mkdtempSync(join(tmpdir(), 'share-'))
  assert.throws(() => storeLogo(dir, 'https://example.com/logos', SVG), /not a PNG/)
})

test('the same image always lands at the same url', () => {
  const dir = mkdtempSync(join(tmpdir(), 'share-'))
  const a = storeLogo(dir, 'https://example.com/logos', PNG)
  const b = storeLogo(dir, 'https://example.com/logos', PNG)
  assert.equal(a.url, b.url)
  assert.equal(readdirSync(dir).length, 1)
})

/** ⛔ Pons reverts above 512 bytes of metadata and names no field, so the launch fails pointing
 *  nowhere. Caught at upload instead. */
test('a url too long for the token metadata is refused at upload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'share-'))
  assert.throws(() => storeLogo(dir, `https://example.com/${'x'.repeat(600)}`, PNG), /longer than Pons allows/)
})

test('an empty file is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'share-'))
  assert.throws(() => storeLogo(dir, 'https://example.com/logos', Buffer.alloc(0)), /empty/)
})
