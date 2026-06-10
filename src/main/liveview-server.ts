import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { CameraManager } from './camera'

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

      const write = (frame: Buffer): void => {
        if (res.writableEnded) return
        res.write(
          `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`
        )
        res.write(frame)
        res.write('\r\n')
      }

      const latest = this.camera.getLatestFrame()
      if (latest) write(latest)
      const unsubscribe = this.camera.onFrame(write)
      req.on('close', unsubscribe)
    })

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
