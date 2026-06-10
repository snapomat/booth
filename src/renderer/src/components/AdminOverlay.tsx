import type React from 'react'
import { useEffect, useState } from 'react'
import type { CameraSource, DefaultBackground, Settings } from '@shared/types'

interface Props {
  settings: Settings | null
  onClose: () => void
  onSaved: (settings: Settings) => void
}

const sources: CameraSource[] = ['auto', 'gphoto2', 'webcam', 'mock']
const inputCls =
  'w-full rounded-lg bg-ink/60 px-4 py-2.5 font-body text-cream outline-none ring-1 ring-cream/15 focus:ring-flare'

/** Passwortgeschützter Admin-Bereich für die Geräte-Einstellungen. */
export default function AdminOverlay({ settings, onClose, onSaved }: Props): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [printers, setPrinters] = useState<string[]>([])
  const [defaults, setDefaults] = useState<DefaultBackground[]>([])
  const [form, setForm] = useState<Settings | null>(settings)

  // ESC schließt den Admin-Bereich.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function unlock(): Promise<void> {
    if (await window.api.verifyAdminPassword(password)) {
      setUnlocked(true)
      setError(null)
      setPrinters(await window.api.listPrinters())
      setDefaults(await window.api.getDefaultBackgrounds())
    } else {
      setError('Falsches Passwort')
    }
  }

  async function save(): Promise<void> {
    if (!form) return
    try {
      onSaved(await window.api.saveSettings(form, password))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    }
  }

  const patch = (p: Partial<Settings>): void => setForm((f) => (f ? { ...f, ...p } : f))

  async function pickInto(apply: (path: string) => void): Promise<void> {
    const path = await window.api.pickImageFile()
    if (path) apply(path)
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-ink/85 p-6 backdrop-blur-xl">
      <div className="grain w-[38rem] max-w-full overflow-hidden rounded-2xl bg-ink-2 ring-1 ring-cream/10">
        <div className="flex items-center justify-between border-b border-cream/10 px-8 py-6">
          <div>
            <p className="font-mono text-[0.65rem] tracking-[0.35em] text-flare uppercase">Einstellungen</p>
            <h2 className="font-display text-3xl font-light italic text-cream">Snapomat</h2>
          </div>
          <button onClick={onClose} className="text-cream-dim hover:text-cream" aria-label="Schließen">
            ✕
          </button>
        </div>

        <div className="p-8">
          {!unlocked ? (
            <div className="flex flex-col gap-4">
              <Label>Admin-Passwort</Label>
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && unlock()}
                className={inputCls}
              />
              {error && <p className="font-mono text-xs text-flare">{error}</p>}
              <button
                onClick={unlock}
                className="mt-1 rounded-lg bg-flare px-4 py-3 font-display text-lg text-ink transition hover:bg-flare-deep"
              >
                Entsperren
              </button>
              <p className="font-mono text-[0.65rem] tracking-wide text-cream-dim/60">
                Standard beim Erststart: „admin"
              </p>
            </div>
          ) : form ? (
            <div className="flex flex-col gap-5">
              <Field label="Begrüßungstext">
                <input value={form.welcomeText} onChange={(e) => patch({ welcomeText: e.target.value })} className={inputCls} />
              </Field>

              <Field label="Kamera-Quelle">
                <select
                  value={form.cameraSource}
                  onChange={(e) => patch({ cameraSource: e.target.value as CameraSource })}
                  className={`${inputCls} field-select`}
                >
                  {sources.map((s) => (
                    <option key={s} value={s} className="bg-ink-2">
                      {s}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-3 gap-4">
                <Field label="Countdown (s)">
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={form.countdownSeconds}
                    onChange={(e) => patch({ countdownSeconds: Number(e.target.value) })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Drucke">
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={form.printsPerCapture}
                    onChange={(e) => patch({ printsPerCapture: Number(e.target.value) })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Timeout (s)">
                  <input
                    type="number"
                    min={3}
                    max={120}
                    value={form.reviewTimeoutSeconds}
                    onChange={(e) => patch({ reviewTimeoutSeconds: Number(e.target.value) })}
                    className={inputCls}
                  />
                </Field>
              </div>

              <Field label="Drucker (CUPS)">
                <select
                  value={form.printerName ?? ''}
                  onChange={(e) => patch({ printerName: e.target.value || null })}
                  className={`${inputCls} field-select`}
                >
                  <option value="" className="bg-ink-2">
                    — kein Drucker —
                  </option>
                  {printers.map((p) => (
                    <option key={p} value={p} className="bg-ink-2">
                      {p}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Hintergrund Startscreen">
                <div className="grid grid-cols-4 gap-2">
                  <BgTile
                    active={!form.backgroundImagePath && !form.backgroundDefault}
                    onClick={() => patch({ backgroundImagePath: null, backgroundDefault: null })}
                    label="Slideshow"
                  />
                  {defaults.map((bg) => (
                    <BgTile
                      key={bg.name}
                      active={!form.backgroundImagePath && form.backgroundDefault === bg.name}
                      onClick={() =>
                        patch({
                          backgroundDefault: bg.name,
                          backgroundImagePath: null,
                          accentColor: bg.accent
                        })
                      }
                      img={bg.dataUrl}
                    />
                  ))}
                </div>
                <div className="mt-2">
                  <FilePicker
                    path={form.backgroundImagePath}
                    onPick={() => pickInto((p) => patch({ backgroundImagePath: p, backgroundDefault: null }))}
                    onClear={() => patch({ backgroundImagePath: null })}
                  />
                </div>
              </Field>

              <div className="grid grid-cols-[1fr_auto] items-end gap-4">
                <Field label={`Hintergrund-Deckkraft · ${Math.round(form.backgroundOpacity * 100)} %`}>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(form.backgroundOpacity * 100)}
                    onChange={(e) => patch({ backgroundOpacity: Number(e.target.value) / 100 })}
                    className="w-full accent-flare"
                  />
                </Field>
                <Field label="Akzentfarbe">
                  <input
                    type="color"
                    value={form.accentColor}
                    onChange={(e) => patch({ accentColor: e.target.value })}
                    className="h-11 w-16 cursor-pointer rounded-lg bg-ink/60 ring-1 ring-cream/15"
                  />
                </Field>
              </div>

              {error && <p className="font-mono text-xs text-flare">{error}</p>}
              <button
                onClick={save}
                className="mt-1 rounded-lg bg-flare px-4 py-3 font-display text-lg text-ink transition hover:bg-flare-deep"
              >
                Speichern & neu laden
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function BgTile({
  active,
  onClick,
  img,
  label
}: {
  active: boolean
  onClick: () => void
  img?: string
  label?: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`relative grid aspect-video place-items-center overflow-hidden rounded-lg bg-ink/60 ring-2 transition ${
        active ? 'ring-flare' : 'ring-cream/10 hover:ring-cream/30'
      }`}
    >
      {img ? (
        <img src={img} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="font-mono text-[0.6rem] tracking-widest text-cream-dim uppercase">{label}</span>
      )}
    </button>
  )
}

function FilePicker({
  path,
  onPick,
  onClear
}: {
  path: string | null
  onPick: () => void
  onClear: () => void
}): React.JSX.Element {
  const name = path ? (path.split(/[/\\]/).pop() ?? path) : null
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onPick}
        className="shrink-0 rounded-lg bg-cream/10 px-4 py-2.5 font-mono text-xs tracking-wide text-cream uppercase transition hover:bg-cream/20"
      >
        Datei wählen
      </button>
      <span className="flex-1 truncate font-mono text-xs text-cream-dim">{name ?? 'keine'}</span>
      {path && (
        <button onClick={onClear} className="shrink-0 font-mono text-xs text-cream-dim hover:text-flare">
          entfernen
        </button>
      )}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="font-mono text-[0.65rem] tracking-[0.25em] text-cream-dim uppercase">{children}</span>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
    </label>
  )
}
