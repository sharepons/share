import { useEffect, useRef, useState } from 'react'
import { LOGO_MAX_BYTES, logoUploadAvailable, uploadLogo } from '../lib/upload.ts'
import { checkLogo, resolveImage } from '../lib/logo.ts'

/**
 * The token image.
 *
 * ⛔⛔ ON PONS V2 THE LOGO IS A LINK, NOT A PICTURE, AND IT HAS NO SETTER. The field holds a URI and
 * the deployer reverts above 512 bytes of metadata without naming the field — so an oversized image
 * fails the whole launch with a message that points nowhere. It is checked here, before anything is
 * signed, and whatever is in this box is what the token carries forever.
 *
 * ⚠⚠ EVERY FAILURE SAYS "NOTHING WAS UPLOADED", EXPLICITLY, and clears the field. Somebody who
 * believes their image was accepted when it was not launches a token with no picture, permanently.
 */
export function LogoField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  /* ⚠ Asked once, and the drop zone is only drawn if the answer is yes. Offering an upload on a
     deployment with nothing behind it produces "the upload failed (405)" — a status code, shown to
     somebody who did nothing wrong. The probe reads the BODY, not the status. @see lib/upload.ts */
  useEffect(() => { void logoUploadAvailable().then(setAvailable) }, [])

  const check = checkLogo(value)
  const preview = resolveImage(value)

  async function take(file: File | undefined | null) {
    if (!file) return
    setBusy(true)
    setFailed(null)
    try {
      const { url } = await uploadLogo(file)
      onChange(url)
    } catch (e) {
      onChange('')
      setFailed(
        `${e instanceof Error ? e.message : 'the upload failed'}. Nothing was uploaded, and the image has been ` +
          'left empty rather than pointing at something that does not exist.',
      )
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="field">
      <label>Token image</label>
      <div className="logo__row">
        {/* ⚠ A tinted square, not an empty grey box. Before an image exists this tile is most of what
            the field looks like, and a neutral hole beside a dashed rectangle reads as something
            that failed to load rather than as a slot waiting to be filled. */}
        <span className="logo__tile" aria-hidden="true">
          {preview ? <img src={preview} alt="" /> : <span className="logo__tile-empty">none</span>}
        </span>

        {/* ⚠ A flex COLUMN. The drop zone is not the only child — the error text and the remove
            button sit under it — so the column has to lay them out. @see .logo__col */}
        <div className="logo__col">
          {available === false ? (
            /* ⚠ A plain input, not a broken drop zone. Nothing has gone wrong for the visitor. */
            <input
              type="text"
              className="mono"
              placeholder="https://  or  ipfs://"
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : (
            <div
              className={`logo__drop${over ? ' is-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files?.[0]) }}
              onClick={() => input.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() }
              }}
            >
              <input
                ref={input}
                type="file"
                hidden
                accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
                onChange={(e) => void take(e.target.files?.[0])}
              />
              {busy ? (
                <div className="logo__drop-title">Uploading…</div>
              ) : value ? (
                <>
                  <div className="logo__drop-title">Image set</div>
                  <div className="logo__drop-sub">Click or drop another to replace it</div>
                </>
              ) : (
                <>
                  <div className="logo__drop-title">Upload an image</div>
                  {/* ⚠ The wording no longer says "Not SVG", at the operator's request. The REFUSAL
                      is unchanged: the file input's `accept` list omits SVG and the server validates
                      the type again. An SVG can carry script and this URL goes into the token's
                      constructor with no setter, so the guard must stay even though the note is gone. */}
                  <div className="logo__drop-sub">
                    PNG, JPEG, GIF, WebP or AVIF, up to {LOGO_MAX_BYTES / 1024 / 1024} MB
                  </div>
                </>
              )}
            </div>
          )}

          {failed && <p className="field__err">{failed}</p>}
          {!failed && !check.ok && <p className="field__err">{check.error}</p>}
          {value && (
            <button type="button" className="btn btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => { onChange(''); setFailed(null) }}>
              Remove image
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
