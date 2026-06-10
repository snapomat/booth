import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CaptureResult, ResolvedCameraSource } from '@shared/types'

export interface UseCamera {
  source: ResolvedCameraSource | null
  /** MJPEG-Stream-URL (gphoto2/mock) – nur gesetzt, solange der Liveview läuft. */
  mjpegUrl: string | null
  /** Video-Element-Ref für den Webcam-Modus. */
  videoRef: React.RefObject<HTMLVideoElement | null>
  /** Fehlermeldung der Kamera-Initialisierung (z. B. Webcam blockiert). */
  error: string | null
  /** Startet den Liveview on-demand (Spiegel/Sensor der DSLR schonen). */
  startLiveview: () => Promise<void>
  /** Stoppt den Liveview wieder. */
  stopLiveview: () => Promise<void>
  /** Löst eine Aufnahme aus und liefert das druckfertige Ergebnis. */
  capture: () => Promise<CaptureResult>
}

/**
 * Verbindet den Renderer mit der konfigurierten Kamera-Quelle. Der Liveview
 * läuft NICHT dauerhaft, sondern wird vom Ablauf nur rund um die Aufnahme
 * gestartet/gestoppt – bei der DSLR bleibt sonst der Spiegel oben.
 */
export function useCamera(): UseCamera {
  const [source, setSource] = useState<ResolvedCameraSource | null>(null)
  const [mjpegUrl, setMjpegUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Nur die Quelle auflösen – kein Liveview beim Mount.
  useEffect(() => {
    let cancelled = false
    void window.api.resolveCameraSource().then((src) => {
      if (!cancelled) setSource(src)
    })
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const startLiveview = useCallback(async (): Promise<void> => {
    setError(null)
    if (source === 'webcam') {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('getUserMedia ist nicht verfügbar (kein Secure Context?).')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false
        })
        streamRef.current = stream
        // Kamera abgezogen / Stream beendet → sichtbar machen.
        stream.getVideoTracks()[0]?.addEventListener(
          'ended',
          () => setError('Webcam wurde getrennt'),
          { once: true }
        )
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch (err) {
        const cams = await navigator.mediaDevices
          .enumerateDevices()
          .then((d) => d.filter((x) => x.kind === 'videoinput').length)
          .catch(() => -1)
        const e = err as DOMException
        setError(`Webcam-Fehler: ${e.name || 'Error'} – ${e.message} (gefundene Kameras: ${cams})`)
        console.error('[webcam]', err)
      }
    } else {
      await window.api.startLiveview()
      const url = await window.api.liveviewUrl()
      // Cache-Buster, damit das <img> bei jedem Start frisch verbindet.
      setMjpegUrl(`${url}?t=${Date.now()}`)
    }
  }, [source])

  const stopLiveview = useCallback(async (): Promise<void> => {
    if (source === 'webcam') {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
    } else {
      setMjpegUrl(null)
      await window.api.stopLiveview()
    }
  }, [source])

  const capture = useCallback(async (): Promise<CaptureResult> => {
    if (source === 'webcam') {
      const video = videoRef.current
      if (!video || !video.videoWidth) throw new Error('Webcam nicht bereit')
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas-Kontext fehlt')
      ctx.drawImage(video, 0, 0)
      return window.api.captureFromDataUrl(canvas.toDataURL('image/jpeg', 0.92))
    }
    return window.api.capture()
  }, [source])

  return { source, mjpegUrl, videoRef, error, startLiveview, stopLiveview, capture }
}
