import type React from 'react'
import { useEffect, useState } from 'react'
import type {
  CameraDiagnostics,
  CameraSource,
  DefaultBackground,
  EventInfo,
  Settings
} from '@shared/types'
import { defaultSettings } from '@shared/types'
import OnScreenKeyboard from './OnScreenKeyboard'

interface Props {
  settings: Settings | null
  onClose: () => void
  onSaved: (settings: Settings) => void
}

type Tab = 'allgemein' | 'events' | 'hintergrund' | 'kamera' | 'ai'
/** Welches Textfeld die On-Screen-Tastatur gerade bedient. */
type KbField = 'welcomeText' | 'newEvent' | 'pinOld' | 'pinNext' | 'pinConfirm' | 'aiPrompt'

const sources: CameraSource[] = ['auto', 'gphoto2', 'webcam', 'mock']
const inputCls =
  'w-full rounded-lg bg-ink/60 px-4 py-2.5 font-body text-cream outline-none ring-1 ring-cream/15 focus:ring-flare'

/** Passwortgeschützter Admin-Bereich – Tabs statt Scrollen (1024×768-Touch). */
export default function AdminOverlay({ settings, onClose, onSaved }: Props): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [printers, setPrinters] = useState<string[]>([])
  const [defaults, setDefaults] = useState<DefaultBackground[]>([])
  const [diag, setDiag] = useState<CameraDiagnostics | null>(null)
  const [installing, setInstalling] = useState(false)
  const [tab, setTabState] = useState<Tab>('allgemein')
  const [kbField, setKbField] = useState<KbField | null>(null)
  const [form, setForm] = useState<Settings | null>(settings)
  const [events, setEvents] = useState<EventInfo[]>([])
  const [activeEventId, setActiveEventId] = useState<string | null>(null)
  const [newEventName, setNewEventName] = useState('')
  const [pinForm, setPinForm] = useState({ old: '', next: '', confirm: '' })
  const [pinMsg, setPinMsg] = useState<string | null>(null)

  const setTab = (t: Tab): void => {
    setTabState(t)
    setKbField(null)
  }

  // Bindet die On-Screen-Tastatur an das aktuell fokussierte Textfeld.
  const kbBinding = (): { value: string; onChange: (v: string) => void } | null => {
    switch (kbField) {
      case 'welcomeText':
        return form ? { value: form.welcomeText, onChange: (v) => patch({ welcomeText: v }) } : null
      case 'newEvent':
        return { value: newEventName, onChange: setNewEventName }
      case 'pinOld':
        return { value: pinForm.old, onChange: (v) => setPinForm((p) => ({ ...p, old: v })) }
      case 'pinNext':
        return { value: pinForm.next, onChange: (v) => setPinForm((p) => ({ ...p, next: v })) }
      case 'pinConfirm':
        return { value: pinForm.confirm, onChange: (v) => setPinForm((p) => ({ ...p, confirm: v })) }
      case 'aiPrompt':
        return form ? { value: form.aiPrompt, onChange: (v) => patch({ aiPrompt: v }) } : null
      default:
        return null
    }
  }

  // ESC schließt den Admin-Bereich.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function refreshEvents(): Promise<void> {
    const state = await window.api.listEvents()
    setEvents(state.events)
    setActiveEventId(state.activeId)
  }

  async function submitPin(pin: string): Promise<void> {
    if (await window.api.verifyAdminPassword(pin)) {
      setUnlocked(true)
      setError(null)
      setPrinters(await window.api.listPrinters())
      setDefaults(await window.api.getDefaultBackgrounds())
      setDiag(await window.api.getCameraDiagnostics())
      await refreshEvents()
    } else {
      setError('Falsche PIN')
      setPassword('')
    }
  }

  async function addEvent(): Promise<void> {
    setError(null)
    try {
      await window.api.createEvent(newEventName)
      setNewEventName('')
      await refreshEvents()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Event konnte nicht angelegt werden')
    }
  }

  async function activateEvent(id: string): Promise<void> {
    await window.api.setActiveEvent(id)
    await refreshEvents()
  }

  async function removeEvent(id: string): Promise<void> {
    setError(null)
    try {
      await window.api.deleteEvent(id)
      await refreshEvents()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Event konnte nicht gelöscht werden')
    }
  }

  async function changePin(): Promise<void> {
    setPinMsg(null)
    if (pinForm.next !== pinForm.confirm) {
      setPinMsg('Neue PIN stimmt nicht überein.')
      return
    }
    try {
      await window.api.changeAdminPassword(pinForm.old, pinForm.next)
      setPinForm({ old: '', next: '', confirm: '' })
      setPinMsg('PIN geändert.')
    } catch (err) {
      setPinMsg(err instanceof Error ? err.message : 'PIN-Änderung fehlgeschlagen')
    }
  }

  function pressDigit(d: string): void {
    if (password.length >= 4) return
    const next = password + d
    setError(null)
    setPassword(next)
    if (next.length === 4) void submitPin(next) // 4-stellige PIN → automatisch prüfen
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

  async function installGphoto2(): Promise<void> {
    setInstalling(true)
    setError(null)
    const res = await window.api.installGphoto2()
    setInstalling(false)
    if (!res.ok) setError(res.message)
    setDiag(await window.api.getCameraDiagnostics())
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-ink/90 p-4">
      <div className="grain relative flex max-h-[94vh] w-[44rem] max-w-[96vw] flex-col overflow-hidden rounded-2xl bg-ink-2 ring-1 ring-cream/10">
        <div className="flex shrink-0 items-center justify-between border-b border-cream/10 px-7 py-4">
          <div>
            <p className="font-mono text-[0.6rem] tracking-[0.35em] text-flare uppercase">Einstellungen</p>
            <h2 className="font-display text-2xl font-light italic text-cream">Snapomat</h2>
          </div>
          <button onClick={onClose} className="text-cream-dim hover:text-cream" aria-label="Schließen">
            ✕
          </button>
        </div>

        <div className="px-7 py-5">
          {!unlocked ? (
            <div className="flex flex-col items-center gap-5 py-2">
              <Label>PIN eingeben</Label>
              <div className="flex h-4 items-center gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-3.5 w-3.5 rounded-full ${i < password.length ? 'bg-flare' : 'bg-cream/15'}`}
                  />
                ))}
              </div>
              {error && <p className="font-mono text-xs text-flare">{error}</p>}
              <div className="grid grid-cols-3 gap-3">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                  <PinKey key={d} onClick={() => pressDigit(d)}>
                    {d}
                  </PinKey>
                ))}
                <span />
                <PinKey onClick={() => pressDigit('0')}>0</PinKey>
                <PinKey onClick={() => setPassword((p) => p.slice(0, -1))}>⌫</PinKey>
              </div>
            </div>
          ) : form ? (
            <div className="flex flex-col gap-5">
              {/* Tab-Leiste */}
              <div className="flex flex-wrap gap-2">
                <TabButton active={tab === 'allgemein'} onClick={() => setTab('allgemein')}>
                  Allgemein
                </TabButton>
                <TabButton active={tab === 'events'} onClick={() => setTab('events')}>
                  Events
                </TabButton>
                <TabButton active={tab === 'hintergrund'} onClick={() => setTab('hintergrund')}>
                  Hintergrund
                </TabButton>
                <TabButton active={tab === 'kamera'} onClick={() => setTab('kamera')}>
                  Kamera & Druck
                </TabButton>
                <TabButton active={tab === 'ai'} onClick={() => setTab('ai')}>
                  AI
                </TabButton>
              </div>

              {/* feste Mindesthöhe verhindert „Springen" beim Tabwechsel */}
              <div className="min-h-[16rem]">
                {tab === 'allgemein' && (
                  <div className="flex flex-col gap-4">
                    <Field label="Begrüßungstext">
                      <input
                        value={form.welcomeText}
                        onChange={(e) => patch({ welcomeText: e.target.value })}
                        onFocus={() => setKbField('welcomeText')}
                        className={inputCls}
                      />
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

                    <div className="mt-2 flex flex-col gap-3 rounded-xl bg-ink/40 p-4 ring-1 ring-cream/10">
                      <Label>Admin-PIN ändern</Label>
                      <div className="grid grid-cols-3 gap-3">
                        <input
                          type="password"
                          inputMode="numeric"
                          placeholder="Alte PIN"
                          value={pinForm.old}
                          onChange={(e) => setPinForm((p) => ({ ...p, old: e.target.value }))}
                          onFocus={() => setKbField('pinOld')}
                          className={inputCls}
                        />
                        <input
                          type="password"
                          inputMode="numeric"
                          placeholder="Neue PIN"
                          value={pinForm.next}
                          onChange={(e) => setPinForm((p) => ({ ...p, next: e.target.value }))}
                          onFocus={() => setKbField('pinNext')}
                          className={inputCls}
                        />
                        <input
                          type="password"
                          inputMode="numeric"
                          placeholder="Neue PIN wdh."
                          value={pinForm.confirm}
                          onChange={(e) => setPinForm((p) => ({ ...p, confirm: e.target.value }))}
                          onFocus={() => setKbField('pinConfirm')}
                          className={inputCls}
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={changePin}
                          className="self-start rounded-lg bg-cream/10 px-4 py-2 font-mono text-xs tracking-wide text-cream uppercase transition hover:bg-cream/20"
                        >
                          PIN ändern
                        </button>
                        {pinMsg && <span className="font-mono text-xs text-flare">{pinMsg}</span>}
                      </div>
                    </div>
                  </div>
                )}

                {tab === 'events' && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-end gap-3">
                      <Field label="Neues Event">
                        <input
                          value={newEventName}
                          onChange={(e) => setNewEventName(e.target.value)}
                          onFocus={() => setKbField('newEvent')}
                          placeholder="z. B. Hochzeit Müller"
                          className={inputCls}
                        />
                      </Field>
                      <button
                        onClick={addEvent}
                        disabled={!newEventName.trim()}
                        className="shrink-0 rounded-lg bg-flare px-4 py-2.5 font-mono text-xs tracking-wide text-ink uppercase transition hover:bg-flare-deep disabled:opacity-50"
                      >
                        Anlegen
                      </button>
                    </div>
                    <div className="flex max-h-56 flex-col gap-2 overflow-y-auto p-1">
                      {events.map((ev) => (
                        <div
                          key={ev.id}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ring-1 ${
                            ev.id === activeEventId ? 'bg-flare/10 ring-flare/40' : 'bg-ink/40 ring-cream/10'
                          }`}
                        >
                          <span className="flex-1 truncate font-body text-cream">{ev.name}</span>
                          {ev.id === activeEventId ? (
                            <span className="font-mono text-[0.6rem] tracking-widest text-flare uppercase">
                              aktiv
                            </span>
                          ) : (
                            <button
                              onClick={() => void activateEvent(ev.id)}
                              className="rounded-md bg-cream/10 px-3 py-1.5 font-mono text-[0.6rem] tracking-widest text-cream uppercase transition hover:bg-cream/20"
                            >
                              aktivieren
                            </button>
                          )}
                          {events.length > 1 && (
                            <button
                              onClick={() => void removeEvent(ev.id)}
                              className="font-mono text-[0.6rem] tracking-widest text-cream-dim uppercase transition hover:text-flare"
                            >
                              löschen
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="font-mono text-[0.65rem] tracking-wide text-cream-dim/70">
                      Neue Aufnahmen landen im Ordner des aktiven Events. Löschen entfernt auch die Fotos.
                    </p>
                  </div>
                )}

                {tab === 'hintergrund' && (
                  <div className="flex flex-col gap-4">
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
                    </Field>
                    <FilePicker
                      path={form.backgroundImagePath}
                      onPick={() => pickInto((p) => patch({ backgroundImagePath: p, backgroundDefault: null }))}
                      onClear={() => patch({ backgroundImagePath: null })}
                    />
                    <div className="grid grid-cols-[1fr_auto] items-end gap-4">
                      <Field label={`Deckkraft · ${Math.round(form.backgroundOpacity * 100)} %`}>
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
                          className="h-11 w-20 cursor-pointer rounded-lg bg-ink/60 ring-1 ring-cream/15"
                        />
                      </Field>
                    </div>
                  </div>
                )}

                {tab === 'kamera' && (
                  <div className="flex flex-col gap-4">
                    {diag && diag.gphoto2Missing && (
                      <div className="flex flex-col gap-2 rounded-xl bg-flare/10 px-4 py-3 text-sm text-cream ring-1 ring-flare/40">
                        <span>
                          <b>gphoto2</b> ist nicht installiert – ohne läuft nur der Mock-Modus.
                        </span>
                        {diag.platform === 'linux' ? (
                          <button
                            onClick={installGphoto2}
                            disabled={installing}
                            className="self-start rounded-lg bg-flare px-4 py-2 font-mono text-xs tracking-wide text-ink uppercase transition hover:bg-flare-deep disabled:opacity-60"
                          >
                            {installing ? 'Installiere …' : 'gphoto2 installieren'}
                          </button>
                        ) : (
                          <span className="font-mono text-xs text-cream-dim">
                            macOS/Windows: gphoto2 manuell installieren (z. B. „brew install gphoto2").
                          </span>
                        )}
                      </div>
                    )}
                    {diag && !diag.gphoto2Missing && (
                      <p className="font-mono text-xs tracking-wide text-cream-dim uppercase">
                        Kamera: {diag.cameraDetected ? '✓ erkannt' : '— nicht erkannt (USB/Verbindung prüfen)'}
                      </p>
                    )}
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
                  </div>
                )}

                {tab === 'ai' && (
                  <div className="flex flex-col gap-4">
                    <label className="flex items-center justify-between gap-3 rounded-xl bg-ink/40 px-4 py-3 ring-1 ring-cream/10">
                      <span className="flex flex-col">
                        <Label>AI-Portraits</Label>
                        <span className="font-mono text-[0.6rem] text-cream-dim/70">
                          Gast kann optional eine AI-Variante wählen (online).
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={form.aiEnabled}
                        onChange={(e) => patch({ aiEnabled: e.target.checked })}
                        className="h-5 w-5 accent-flare"
                      />
                    </label>
                    {form.aiEnabled && (
                      <>
                        <div className="grid grid-cols-[1fr_auto] gap-3">
                          <Field label="OpenAI-API-Key">
                            <input
                              type="password"
                              autoComplete="off"
                              spellCheck={false}
                              placeholder="sk-…"
                              value={form.aiApiKey}
                              onChange={(e) => patch({ aiApiKey: e.target.value })}
                              className={inputCls}
                            />
                          </Field>
                          <Field label="Modell">
                            <input
                              value={form.aiModel}
                              onChange={(e) => patch({ aiModel: e.target.value })}
                              spellCheck={false}
                              className={`${inputCls} w-44`}
                            />
                          </Field>
                        </div>
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <Label>Stil-Prompt</Label>
                            <button
                              onClick={() => patch({ aiPrompt: defaultSettings.aiPrompt })}
                              className="font-mono text-[0.6rem] tracking-wide text-cream-dim uppercase transition hover:text-flare"
                            >
                              Standard
                            </button>
                          </div>
                          <textarea
                            rows={4}
                            value={form.aiPrompt}
                            onChange={(e) => patch({ aiPrompt: e.target.value })}
                            onFocus={() => setKbField('aiPrompt')}
                            className={`${inputCls} resize-none`}
                          />
                        </div>
                        <span className="font-mono text-[0.6rem] tracking-wide text-cream-dim/70">
                          Key wird lokal gespeichert (nicht auf dem Desktop). Leer lassen = Fallback auf
                          <b> OPENAI_API_KEY</b>. Fotos werden zur Verarbeitung an OpenAI gesendet.
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>

              {error && <p className="font-mono text-xs text-flare">{error}</p>}
              <button
                onClick={save}
                className="rounded-lg bg-flare px-4 py-3 font-display text-lg text-ink transition hover:bg-flare-deep"
              >
                Speichern & neu laden
              </button>
            </div>
          ) : null}
        </div>

        {unlocked &&
          (() => {
            const kb = kbBinding()
            return kb ? (
              <OnScreenKeyboard value={kb.value} onChange={kb.onChange} onClose={() => setKbField(null)} />
            ) : null
          })()}
      </div>
    </div>
  )
}

function PinKey({
  children,
  onClick,
  variant
}: {
  children: React.ReactNode
  onClick: () => void
  variant?: 'ok'
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`grid h-16 w-16 place-items-center rounded-xl font-display text-2xl transition ${
        variant === 'ok'
          ? 'bg-flare text-ink hover:bg-flare-deep'
          : 'bg-cream/5 text-cream hover:bg-cream/15'
      }`}
    >
      {children}
    </button>
  )
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-2 font-mono text-xs tracking-wide uppercase transition ${
        active ? 'bg-flare text-ink' : 'bg-cream/5 text-cream-dim hover:bg-cream/10'
      }`}
    >
      {children}
    </button>
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
