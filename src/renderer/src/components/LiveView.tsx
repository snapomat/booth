import type React from 'react'
import { useState } from 'react'
import type { ResolvedCameraSource } from '@shared/types'

interface Props {
  source: ResolvedCameraSource | null
  mjpegUrl: string | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  /** Wird der Liveview gerade angezeigt? (sonst ruht die Kamera) */
  active: boolean
}

/** Vollflächige Live-Vorschau – je nach Quelle Webcam-Video oder MJPEG-Bild. */
export default function LiveView({ source, mjpegUrl, videoRef, active }: Props): React.JSX.Element {
  // Bei Verbindungsabbruch des MJPEG-Streams neu verbinden (Cache-Buster erhöhen).
  const [nonce, setNonce] = useState(0)
  const imgSrc = mjpegUrl
    ? `${mjpegUrl}${mjpegUrl.includes('?') ? '&' : '?'}r=${nonce}`
    : ''
  return (
    <div className="vignette absolute inset-0 overflow-hidden">
      {/* Webcam-Video bleibt gemountet, damit der Stream on-demand attachen kann. */}
      {source === 'webcam' && (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`h-full w-full -scale-x-100 object-cover transition-opacity duration-300 ${
            active ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
      {source !== 'webcam' && active && imgSrc && (
        <img
          src={imgSrc}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setTimeout(() => setNonce((n) => n + 1), 1000)}
        />
      )}
    </div>
  )
}
