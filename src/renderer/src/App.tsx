import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CaptureResult, DefaultBackground, Settings } from '@shared/types'
import { useCamera } from './useCamera'
import LiveView from './components/LiveView'
import AdminOverlay from './components/AdminOverlay'
import logo from './assets/logo.svg'

type Phase = 'idle' | 'countdown' | 'capturing' | 'review' | 'printing' | 'thanks'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Verstreute Positionen/Rotationen für die „Foto-Haufen"-Collage der alten Bilder.
const SCATTER: React.CSSProperties[] = [
  { top: '5%', left: '4%', rotate: '-9deg' },
  { top: '7%', right: '5%', rotate: '8deg' },
  { bottom: '6%', left: '6%', rotate: '7deg' },
  { bottom: '5%', right: '4%', rotate: '-8deg' },
  { top: '36%', left: '1%', rotate: '-5deg' },
  { top: '40%', right: '1%', rotate: '6deg' },
  { top: '3%', left: '33%', rotate: '5deg' },
  { bottom: '4%', right: '31%', rotate: '-6deg' }
]

export default function App(): React.JSX.Element {
  const cam = useCamera()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [count, setCount] = useState(0)
  const [capture, setCapture] = useState<CaptureResult | null>(null)
  const [reviewLeft, setReviewLeft] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const [bgDataUrl, setBgDataUrl] = useState<string | null>(null)
  const [defaults, setDefaults] = useState<DefaultBackground[]>([])
  const [bgIndex, setBgIndex] = useState(0)
  const [history, setHistory] = useState<CaptureResult[]>([])
  const busy = useRef(false)
  const cancelled = useRef(false)

  useEffect(() => {
    void window.api.getSettings().then(setSettings)
    void window.api.getDefaultBackgrounds().then(setDefaults)
  }, [])

  // Eigenes Hintergrundbild laden (null = Standard-Slideshow).
  useEffect(() => {
    const path = settings?.backgroundImagePath
    void (async () => {
      setBgDataUrl(path ? await window.api.readImageDataUrl(path) : null)
    })()
  }, [settings?.backgroundImagePath])

  // Akzentfarbe zur Laufzeit setzen.
  useEffect(() => {
    const c = settings?.accentColor
    if (!c) return
    document.documentElement.style.setProperty('--color-flare', c)
    document.documentElement.style.setProperty('--color-flare-deep', c)
  }, [settings?.accentColor])

  // Sanfte Slideshow der Standard-Hintergründe (nur Idle, kein eigenes/gewähltes Bild).
  useEffect(() => {
    if (phase !== 'idle' || bgDataUrl || settings?.backgroundDefault || defaults.length < 2) return
    const id = setInterval(() => setBgIndex((i) => (i + 1) % defaults.length), 6000)
    return () => clearInterval(id)
  }, [phase, bgDataUrl, settings?.backgroundDefault, defaults])

  // Mauszeiger nur im Admin zeigen, im Booth-Modus ausblenden.
  useEffect(() => {
    document.body.classList.toggle('hide-cursor', !adminOpen)
  }, [adminOpen])

  const canPrint = !!settings?.printerName

  const reset = useCallback(() => {
    setCapture(null)
    setError(null)
    setPhase('idle')
    busy.current = false
  }, [])

  const cancel = useCallback(() => {
    cancelled.current = true
  }, [])

  // Eigentlicher Aufnahme-Ablauf (ohne Idle-Guard, damit „Nochmal" direkt erneut auslösen kann).
  const runShot = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    cancelled.current = false
    setError(null)
    setCapture(null)
    // Liveview erst jetzt hochfahren (DSLR-Spiegel/Sensor schonen).
    await cam.startLiveview()
    const total = settings?.countdownSeconds ?? 3
    setPhase('countdown')
    for (let n = total; n > 0; n--) {
      if (cancelled.current) break
      setCount(n)
      await sleep(1000)
    }
    if (cancelled.current) {
      await cam.stopLiveview()
      reset()
      return
    }
    setPhase('capturing')
    await sleep(280)
    try {
      const result = await cam.capture()
      await cam.stopLiveview()
      setCapture(result)
      setHistory((h) => [result, ...h].slice(0, 12))
      setReviewLeft(settings?.reviewTimeoutSeconds ?? 3)
      setPhase('review')
    } catch (err) {
      console.error(err)
      await cam.stopLiveview()
      setError('Aufnahme fehlgeschlagen')
      setPhase('idle')
    }
    busy.current = false
  }, [settings, cam, reset])

  const start = useCallback(() => {
    if (phase !== 'idle' || adminOpen) return
    void runShot()
  }, [phase, adminOpen, runShot])

  const doPrint = useCallback(async () => {
    if (!capture) return
    setPhase('printing')
    try {
      await window.api.print(capture.id)
      setPhase('thanks')
      await sleep(3500)
      reset()
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Druck fehlgeschlagen')
      setReviewLeft(settings?.reviewTimeoutSeconds ?? 3)
      setPhase('review')
    }
  }, [capture, reset, settings])

  // Review-/Druck-Screen: nach konfiguriertem Timeout zurück zum Start.
  useEffect(() => {
    if (phase !== 'review') return
    const id = setInterval(() => {
      setReviewLeft((s) => {
        if (s <= 1) {
          clearInterval(id)
          reset()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [phase, reset])

  const reviewTotal = settings?.reviewTimeoutSeconds ?? 3
  const bgOpacity = settings?.backgroundOpacity ?? 0.35
  const previous = history.slice(1, 9)
  const chosenDefault = settings?.backgroundDefault
    ? (defaults.find((b) => b.name === settings.backgroundDefault)?.dataUrl ?? null)
    : null

  return (
    <div className="grain relative h-full w-full overflow-hidden">
      <LiveView
        source={cam.source}
        mjpegUrl={cam.mjpegUrl}
        videoRef={cam.videoRef}
        active={phase === 'countdown' || phase === 'capturing'}
      />

      {/* Hintergrund Startscreen: eigenes Bild → gewählter Default → Slideshow */}
      {phase === 'idle' &&
        (bgDataUrl || chosenDefault ? (
          <img
            src={bgDataUrl ?? chosenDefault ?? ''}
            alt=""
            className="absolute inset-0 z-0 h-full w-full object-cover"
            style={{ opacity: bgOpacity }}
          />
        ) : (
          defaults.map((bg, i) => (
            <img
              key={bg.name}
              src={bg.dataUrl}
              alt=""
              className="absolute inset-0 z-0 h-full w-full object-cover transition-opacity duration-[1500ms]"
              style={{ opacity: i === bgIndex ? bgOpacity : 0 }}
            />
          ))
        ))}

      {/* IDLE */}
      {phase === 'idle' && (
        <button onClick={start} className="absolute inset-0 z-10 flex flex-col items-center justify-center">
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(60% 50% at 50% 38%, rgba(232,162,60,0.16), transparent 70%)' }}
          />

          {/* Branding – Logo in Akzentfarbe (CSS-Mask) */}
          <div
            className="pointer-events-none absolute top-12 left-1/2 aspect-[1076/751] w-50 -translate-x-1/2 drop-shadow-[0_2px_16px_rgba(0,0,0,0.5)]"
            style={{
              backgroundColor: 'var(--color-flare)',
              maskImage: `url(${logo})`,
              WebkitMaskImage: `url(${logo})`,
              maskRepeat: 'no-repeat',
              WebkitMaskRepeat: 'no-repeat',
              maskSize: 'contain',
              WebkitMaskSize: 'contain',
              maskPosition: 'center',
              WebkitMaskPosition: 'center'
            }}
          />

          {settings && (
            <h1 className="max-w-[16ch] text-center font-display text-7xl font-light italic leading-[0.95] text-cream drop-shadow-[0_2px_20px_rgba(0,0,0,0.6)]">
              {settings.welcomeText}
            </h1>
          )}

          <span className="relative mt-16 grid place-items-center">
            <span
              className="grid h-36 w-36 place-items-center rounded-full bg-flare ring-1 ring-cream/30"
              style={{ animation: 'breathe 2.6s ease-in-out infinite' }}
            >
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#100b09" strokeWidth="1.6">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </span>
          </span>

          <span className="mt-16 font-mono text-xs tracking-[0.4em] text-cream-dim uppercase">
            Tippen zum Auslösen
          </span>

          {cam.error && <ErrorCard>{cam.error}</ErrorCard>}
          {error && <ErrorCard>{error}</ErrorCard>}
        </button>
      )}

      {/* Admin-Zugang: unten mittig, nur im Idle */}
      {phase === 'idle' && (
        <button
          onClick={() => setAdminOpen(true)}
          className="absolute bottom-6 left-1/2 z-20 grid h-11 w-11 -translate-x-1/2 place-items-center rounded-full text-cream-dim/50 transition hover:bg-cream/10 hover:text-cream"
          aria-label="Einstellungen"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      )}

      {/* COUNTDOWN – tippen bricht ab */}
      {phase === 'countdown' && (
        <button
          onClick={cancel}
          className="absolute inset-0 z-10 flex flex-col items-center justify-center"
        >
          <span className="absolute top-20 flex items-center gap-4 font-display text-5xl font-light italic text-cream drop-shadow-[0_2px_16px_rgba(0,0,0,0.7)]">
            Bitte lächeln
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </span>
          <span
            key={count}
            className="font-display text-[20rem] font-semibold leading-none text-cream drop-shadow-[0_8px_40px_rgba(0,0,0,0.7)]"
            style={{ animation: 'pop 1s ease-out' }}
          >
            {count}
          </span>
          <span className="absolute bottom-16 font-mono text-xs tracking-[0.4em] text-cream-dim uppercase">
            Tippen zum Abbrechen
          </span>
        </button>
      )}

      {/* CAPTURING – Blitz */}
      {phase === 'capturing' && (
        <div className="absolute inset-0 z-40 bg-cream" style={{ animation: 'flash 0.6s ease-out' }} />
      )}

      {/* REVIEW */}
      {phase === 'review' && capture && (
        <div className="absolute inset-0 z-30 overflow-hidden bg-ink/85 backdrop-blur-md">
          {/* Timeout-Leiste */}
          <div className="absolute inset-x-0 top-0 z-30 h-1 bg-cream/10">
            <div
              className="h-full bg-flare transition-[width] duration-1000 ease-linear"
              style={{ width: `${(reviewLeft / reviewTotal) * 100}%` }}
            />
          </div>

          {/* Verstreute alte Aufnahmen */}
          {previous.map((p, i) => (
            <div
              key={p.id}
              className="pointer-events-none absolute z-10 w-48 rounded-xl bg-cream p-1.5 shadow-2xl ring-1 ring-black/20"
              style={{ ...SCATTER[i % SCATTER.length], animation: 'printin 0.5s ease-out' }}
            >
              <img src={p.dataUrl} alt="" className="w-full rounded-lg object-cover" />
            </div>
          ))}

          {/* Aktuelles Bild groß + Aktionen */}
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-8">
            <img
              src={capture.dataUrl}
              alt="Aufnahme"
              className="max-h-[52vh] max-w-[64vw] rounded-2xl object-contain shadow-[0_30px_90px_-15px_rgba(0,0,0,0.9)] ring-1 ring-cream/20"
              style={{ animation: 'printin 0.5s ease-out' }}
            />

            {error && <ErrorCard>{error}</ErrorCard>}

            <div className="flex items-center gap-5">
              <button
                onClick={() => void runShot()}
                className="rounded-full border border-cream/25 bg-ink/40 px-10 py-5 font-mono text-sm tracking-widest text-cream uppercase backdrop-blur transition hover:bg-cream/10"
              >
                Nochmal
              </button>
              {canPrint && (
                <button
                  onClick={doPrint}
                  className="rounded-full bg-flare px-14 py-5 font-display text-2xl font-medium text-ink shadow-lg transition hover:bg-flare-deep"
                >
                  Drucken
                </button>
              )}
            </div>

            {canPrint && (
              <span className="font-mono text-xs tracking-[0.3em] text-cream-dim uppercase">
                Zurück in {reviewLeft}s
              </span>
            )}
          </div>
        </div>
      )}

      {/* PRINTING */}
      {phase === 'printing' && (
        <Overlay>
          <Spinner />
          <p className="font-display text-4xl font-light italic text-cream">Wird gedruckt …</p>
        </Overlay>
      )}

      {/* THANKS */}
      {phase === 'thanks' && (
        <Overlay>
          <p className="font-display text-7xl font-light italic text-cream">Danke!</p>
          <p className="font-mono text-sm tracking-[0.3em] text-cream-dim uppercase">
            Dein Foto kommt gleich aus dem Drucker
          </p>
        </Overlay>
      )}

      {adminOpen && (
        <AdminOverlay
          settings={settings}
          onClose={() => setAdminOpen(false)}
          onSaved={() => window.location.reload()}
        />
      )}
    </div>
  )
}

function Overlay({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-ink/90 backdrop-blur-md">
      {children}
    </div>
  )
}

function Spinner(): React.JSX.Element {
  return <span className="h-14 w-14 animate-spin rounded-full border-2 border-cream/20 border-t-flare" />
}

function ErrorCard({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mt-10 max-w-[40ch] rounded-xl border border-flare/40 bg-flare/10 px-5 py-3 text-center font-mono text-xs leading-relaxed tracking-wide text-cream">
      {children}
    </div>
  )
}
