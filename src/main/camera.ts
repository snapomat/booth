import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { EventEmitter } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import type { CameraStatus } from '@shared/types'

const execFileAsync = promisify(execFile)

const JPEG_SOI = Buffer.from([0xff, 0xd8])
const JPEG_EOI = Buffer.from([0xff, 0xd9])

type FrameListener = (frame: Buffer) => void

/**
 * Kapselt den Zugriff auf die Canon-Kamera über die gphoto2-CLI.
 *
 * - Liveview: `gphoto2 --capture-movie --stdout` liefert einen MJPEG-Strom,
 *   der hier in einzelne JPEG-Frames zerlegt und an Abonnenten verteilt wird.
 * - Aufnahme: `gphoto2 --capture-image-and-download`.
 *
 * Ist keine Kamera/gphoto2 vorhanden, läuft ein Mock-Modus mit generierten
 * Bildern, damit sich die Oberfläche auch ohne Hardware entwickeln lässt.
 */
export class CameraManager extends EventEmitter {
  private available = false
  private status: CameraStatus = 'idle'
  private movieProc: ChildProcessWithoutNullStreams | null = null
  private buffer = Buffer.alloc(0)
  private latestFrame: Buffer | null = null
  private frameListeners = new Set<FrameListener>()
  private mockTimer: NodeJS.Timeout | null = null
  private mockTick = 0

  async detect(): Promise<boolean> {
    try {
      await execFileAsync('gphoto2', ['--version'])
      // Kamera angeschlossen?
      const { stdout } = await execFileAsync('gphoto2', ['--auto-detect'])
      // Erste Zeile ist die Kopfzeile, ab Zeile 3 stehen erkannte Kameras.
      this.available = stdout.split('\n').slice(2).some((l) => l.trim().length > 0)
    } catch {
      this.available = false
    }
    this.setStatus(this.available ? 'idle' : 'no-camera')
    return this.available
  }

  isAvailable(): boolean {
    return this.available
  }

  getStatus(): CameraStatus {
    return this.status
  }

  getLatestFrame(): Buffer | null {
    return this.latestFrame
  }

  onFrame(cb: FrameListener): () => void {
    this.frameListeners.add(cb)
    return () => this.frameListeners.delete(cb)
  }

  startLiveview(): void {
    if (this.movieProc || this.mockTimer) return
    if (this.available) {
      this.startRealLiveview()
    } else {
      this.startMockLiveview()
    }
    this.setStatus('live')
  }

  stopLiveview(): void {
    if (this.movieProc) {
      this.movieProc.kill('SIGTERM')
      this.movieProc = null
    }
    if (this.mockTimer) {
      clearInterval(this.mockTimer)
      this.mockTimer = null
    }
    this.buffer = Buffer.alloc(0)
    if (this.status === 'live') this.setStatus('idle')
  }

  /**
   * Nimmt ein Foto auf und gibt den JPEG-Buffer in voller Auflösung zurück.
   * Stoppt vorher den Liveview (Kamera erlaubt nur einen Zugriff).
   */
  async capture(destPath: string): Promise<Buffer> {
    this.stopLiveview()
    this.setStatus('capturing')
    try {
      if (this.available) {
        await execFileAsync('gphoto2', [
          '--capture-image-and-download',
          '--filename',
          destPath,
          '--force-overwrite'
        ])
        return await readFile(destPath)
      }
      const mock = await this.renderMockPhoto()
      await writeFile(destPath, mock)
      return mock
    } finally {
      this.setStatus('idle')
    }
  }

  private startRealLiveview(): void {
    const proc = spawn('gphoto2', ['--capture-movie', '--stdout'])
    this.movieProc = proc
    proc.stdout.on('data', (chunk: Buffer) => this.ingest(chunk))
    proc.on('error', (err) => this.fail(err.message))
    proc.on('exit', () => {
      if (this.movieProc === proc) this.movieProc = null
    })
  }

  /** Zerlegt den MJPEG-Strom in einzelne JPEG-Frames. */
  private ingest(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const start = this.buffer.indexOf(JPEG_SOI)
      if (start < 0) break
      const end = this.buffer.indexOf(JPEG_EOI, start + 2)
      if (end < 0) {
        if (start > 0) this.buffer = this.buffer.subarray(start)
        break
      }
      const frame = this.buffer.subarray(start, end + 2)
      this.buffer = this.buffer.subarray(end + 2)
      this.emitFrame(frame)
    }
  }

  private emitFrame(frame: Buffer): void {
    this.latestFrame = frame
    for (const cb of this.frameListeners) cb(frame)
  }

  private startMockLiveview(): void {
    this.mockTimer = setInterval(() => {
      void this.renderMockFrame().then((f) => this.emitFrame(f))
    }, 100)
  }

  private async renderMockFrame(): Promise<Buffer> {
    this.mockTick = (this.mockTick + 1) % 360
    const hue = this.mockTick
    const svg = `<svg width="640" height="427" xmlns="http://www.w3.org/2000/svg">
      <rect width="640" height="427" fill="hsl(${hue},45%,18%)"/>
      <circle cx="${320 + Math.round(180 * Math.cos(this.mockTick / 12))}" cy="213" r="60" fill="hsl(${(hue + 120) % 360},60%,55%)"/>
      <text x="320" y="400" font-family="sans-serif" font-size="22" fill="#ffffffaa" text-anchor="middle">MOCK LIVEVIEW · keine Kamera</text>
    </svg>`
    return sharp(Buffer.from(svg)).jpeg({ quality: 70 }).toBuffer()
  }

  private async renderMockPhoto(): Promise<Buffer> {
    const svg = `<svg width="1800" height="1200" xmlns="http://www.w3.org/2000/svg">
      <rect width="1800" height="1200" fill="#1e293b"/>
      <text x="900" y="600" font-family="sans-serif" font-size="80" fill="#f8fafc" text-anchor="middle">📸 Mock-Foto</text>
      <text x="900" y="700" font-family="sans-serif" font-size="36" fill="#94a3b8" text-anchor="middle">gphoto2/Kamera nicht verbunden</text>
    </svg>`
    return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer()
  }

  private setStatus(status: CameraStatus): void {
    if (this.status === status) return
    this.status = status
    this.emit('status', status)
  }

  private fail(message: string): void {
    console.error('[camera]', message)
    this.setStatus('error')
  }
}
