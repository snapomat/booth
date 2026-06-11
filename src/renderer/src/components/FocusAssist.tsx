import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useCamera } from '../useCamera'
import { focusScore } from '../focus'

const SAMPLE_W = 160
const SAMPLE_H = 120
const INTERVAL_MS = 200

/**
 * Fokus-Assistent: zeigt das Live-Bild groß und misst die Schärfe (Varianz des
 * Laplace-Operators) aus dem Bild. Der Operator dreht am Fokusring, bis der
 * Balken sein Maximum erreicht. Berechnung im Renderer per Canvas.
 */
export default function FocusAssist({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { source, mjpegUrl, videoRef, startLiveview, stopLiveview, error: camError } = useCamera()
  const imgRef = useRef<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const peakRef = useRef(1)
  const [ratio, setRatio] = useState(0)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  // Liveview an, sobald die Quelle bekannt ist; beim Schließen wieder aus.
  useEffect(() => {
    if (!source) return
    void startLiveview().catch(() => {})
    return () => {
      void stopLiveview().catch(() => {})
    }
  }, [source, startLiveview, stopLiveview])

  // Mess-Schleife: aktuelles Frame klein aufs Canvas zeichnen und auswerten.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    const id = setInterval(() => {
      const el = source === 'webcam' ? videoRef.current : imgRef.current
      if (!el) return
      const ready =
        el instanceof HTMLVideoElement
          ? el.readyState >= 2 && el.videoWidth > 0
          : el.complete && el.naturalWidth > 0
      if (!ready) return
      try {
        ctx.drawImage(el, 0, 0, SAMPLE_W, SAMPLE_H)
        const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H)
        const score = focusScore(data, SAMPLE_W, SAMPLE_H)
        // Langsam abklingende Bestmarke → Balken zeigt „relativ zum Schärfsten".
        peakRef.current = Math.max(peakRef.current * 0.999, score, 1)
        setRatio(Math.min(1, score / peakRef.current))
        setAnalyzeError(null)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'SecurityError') {
          setAnalyzeError('Schärfe-Analyse blockiert (CORS am Liveview-Server?).')
        }
      }
    }, INTERVAL_MS)
    return () => clearInterval(id)
  }, [source, videoRef])

  const sharp = ratio >= 0.95
  const pct = Math.round(ratio * 100)

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-ink">
      <div className="relative flex-1 overflow-hidden">
        {source === 'webcam' ? (
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
        ) : (
          <img
            ref={imgRef}
            src={mjpegUrl ?? ''}
            crossOrigin="anonymous"
            alt=""
            className="h-full w-full object-contain"
          />
        )}
        {/* Fadenkreuz als Ziel-Hilfe */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-24 w-24 rounded-full ring-2 ring-cream/30" />
        </div>
      </div>

      <div className="shrink-0 flex flex-col gap-4 bg-ink-2 px-8 py-6 ring-1 ring-cream/10">
        <div className="flex items-center justify-between">
          <span
            className={`font-display text-3xl italic ${sharp ? 'text-emerald-400' : 'text-cream'}`}
          >
            {sharp ? 'Scharf ✓' : 'Am Fokusring drehen …'}
          </span>
          <span className="font-mono text-sm text-cream-dim">{pct}%</span>
        </div>

        {/* Schärfe-Balken (relativ zur Bestmarke) */}
        <div className="h-4 overflow-hidden rounded-full bg-cream/10">
          <div
            className={`h-full transition-[width] duration-150 ${sharp ? 'bg-emerald-400' : 'bg-flare'}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {(analyzeError || camError) && (
          <span className="font-mono text-xs text-flare">{analyzeError ?? camError}</span>
        )}

        <div className="flex items-center justify-between gap-4">
          <span className="font-mono text-[0.65rem] tracking-wide text-cream-dim/70 uppercase">
            Balken maximieren = optimaler Fokus
          </span>
          <div className="flex gap-3">
            <button
              onClick={() => {
                peakRef.current = 1
                setRatio(0)
              }}
              className="rounded-lg bg-cream/10 px-5 py-2.5 font-mono text-xs tracking-wide text-cream uppercase transition hover:bg-cream/20"
            >
              Zurücksetzen
            </button>
            <button
              onClick={onClose}
              className="rounded-lg bg-flare px-6 py-2.5 font-mono text-xs tracking-wide text-ink uppercase transition hover:bg-flare-deep"
            >
              Fertig
            </button>
          </div>
        </div>
      </div>

      <canvas ref={canvasRef} width={SAMPLE_W} height={SAMPLE_H} className="hidden" />
    </div>
  )
}
