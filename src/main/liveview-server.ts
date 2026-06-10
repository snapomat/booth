import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { CameraManager } from './camera'
import { createLogger } from './util/logger'

const log = createLogger('liveview-server')

/**
 * Serviert den Liveview als `multipart/x-mixed-replace`-MJPEG-Stream auf
 * 127.0.0.1. Der Renderer bindet ihn einfach per `<img src=...>` ein.
 * Bindet nur an localhost — kein Zugriff von außen.
 */
export class LiveviewServer {
  private server: Server | null = null
  private port = 0

  constructor(private readonly camera: CameraManager) {}

  async start(): Promise<number> {
    if (this.server) return this.port
    const boundary = 'photoboothframe'
    this.server = createServer((req, res) => {
      if (req.url !== '/liveview.mjpg') {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, {
        'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
        'Cache-Control': 'no-cache, no-store',
        Connection: 'close',
        Pragma: 'no-cache'
      })

      let broken = false
      const write = (frame: Buffer): void => {
        if (broken || res.writableEnded || res.destroyed) return
        try {
          res.write(
            `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`
          )
          res.write(frame)
          res.write('\r\n')
        } catch {
          // Client weg / EPIPE → Abonnement beenden, nicht crashen.
          broken = true
          unsubscribe()
        }
      }

      const unsubscribe = this.camera.onFrame(write)
      const cleanup = (): void => {
        broken = true
        unsubscribe()
      }
      req.on('close', cleanup)
      res.on('error', cleanup)
      const latest = this.camera.getLatestFrame()
      if (latest) write(latest)
    })

    this.server.on('error', (err) => log.error('Liveview-Server-Fehler', err))
    this.server.on('clientError', (_err, socket) => socket.destroy())

    await new Promise<void>((resolve) => {
      this.server!.listen(0, '127.0.0.1', () => resolve())
    })
    this.port = (this.server!.address() as AddressInfo).port
    return this.port
  }

  url(): string {
    return `http://127.0.0.1:${this.port}/liveview.mjpg`
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }
}
