import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import type { CameraStatus } from '@shared/types'
import { createLogger } from './util/logger'
import { JpegFrameSplitter } from './util/jpeg'
import { runCommand, CommandError } from './util/exec'
import { retry } from './util/async'

type FrameListener = (frame: Buffer) => void

const FRAME_TIMEOUT_MS = 6000 // keine Frames so lange → Liveview neu starten
const RESTART_BASE_MS = 500
const RESTART_MAX_MS = 8000
const CAPTURE_TIMEOUT_MS = 30_000
const DETECT_TIMEOUT_MS = 8000
const WATCHDOG_INTERVAL_MS = 2000

/**
 * Robuste Kapselung des Kamera-Zugriffs über die gphoto2-CLI.
 *
 * Selbstheilend: stürzt der Liveview-Prozess ab oder bleiben Frames aus, wird er
 * mit Backoff neu gestartet; eine Aufnahme läuft mit Timeout und Retries; ist die
 * Kamera weg, wird beim nächsten Start neu erkannt. Ohne gphoto2/Kamera läuft ein
 * Mock-Modus für die UI-Entwicklung.
 */
export class CameraManager extends EventEmitter {
  private readonly log = createLogger('camera')
  private readonly splitter = new JpegFrameSplitter()

  private available = false
  private gphoto2Missing = false
  private status: CameraStatus = 'idle'
  private latestFrame: Buffer | null = null
  private lastFrameAt = 0
  private readonly frameListeners = new Set<FrameListener>()

  private movieProc: ChildProcessWithoutNullStreams | null = null
  private mockTimer: NodeJS.Timeout | null = null
  private mockTick = 0

  private wantLive = false
  private capturing = false
  private restartTimer: NodeJS.Timeout | null = null
  private restartAttempts = 0
  private readonly watchdog: NodeJS.Timeout
  private disposed = false

  constructor() {
    super()
    this.watchdog = setInterval(() => this.checkWatchdog(), WATCHDOG_INTERVAL_MS)
  }

  /** Prüft, ob gphoto2 vorhanden ist und eine Kamera erkannt wird. */
  async detect(): Promise<boolean> {
    try {
      await runCommand('gphoto2', ['--version'], { timeoutMs: DETECT_TIMEOUT_MS })
      this.gphoto2Missing = false
      const { stdout } = await runCommand('gphoto2', ['--auto-detect'], {
        timeoutMs: DETECT_TIMEOUT_MS
      })
      this.available = stdout
        .split('\n')
        .slice(2)
        .some((l) => l.trim().length > 0)
    } catch (err) {
      this.available = false
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        this.gphoto2Missing = true
        this.log.info('gphoto2 nicht installiert – Mock-Modus aktiv')
      } else if (!(err instanceof CommandError)) {
        // CommandError (z. B. keine Kamera angeschlossen) ist normal → still.
        this.log.warn('gphoto2-Erkennung fehlgeschlagen', err)
      }
    }
    if (!this.available && this.status !== 'capturing') this.setStatus('no-camera')
    return this.available
  }

  /** True, wenn das gphoto2-Binary nicht gefunden wurde (ENOENT). */
  isGphoto2Missing(): boolean {
    return this.gphoto2Missing
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

  /** Startet den Liveview on-demand. Erkennt die Kamera bei Bedarf neu. */
  async startLiveview(): Promise<void> {
    this.wantLive = true
    if (this.movieProc || this.mockTimer) return
    if (!this.available) await this.detect()
    this.spawnLiveview()
  }

  /** Stoppt den Liveview und alle Neustart-Versuche. */
  stopLiveview(): void {
    this.wantLive = false
    this.clearRestart()
    this.stopMovieProcess()
    this.stopMock()
    if (this.status === 'live' || this.status === 'reconnecting') {
      this.setStatus(this.available ? 'idle' : 'no-camera')
    }
  }

  /**
   * Nimmt ein Foto auf (Timeout + Retries) und gibt den JPEG-Buffer zurück.
   * Stoppt vorher den Liveview, da die Kamera nur einen Zugriff erlaubt.
   */
  async capture(destPath: string): Promise<Buffer> {
    if (this.capturing) throw new Error('Aufnahme läuft bereits')
    this.capturing = true
    this.clearRestart()
    this.stopMovieProcess()
    this.setStatus('capturing')
    try {
      if (this.available) {
        return await retry(
          async () => {
            await runCommand(
              'gphoto2',
              ['--capture-image-and-download', '--filename', destPath, '--force-overwrite'],
              { timeoutMs: CAPTURE_TIMEOUT_MS }
            )
            const data = await readFile(destPath)
            if (data.length === 0) throw new Error('Aufnahme leer')
            return data
          },
          {
            attempts: 3,
            delayMs: 600,
            onRetry: (err, attempt, next) =>
              this.log.warn(`Aufnahme-Versuch ${attempt} fehlgeschlagen, Retry in ${next}ms`, err)
          }
        )
      }
      const mock = await this.renderMockPhoto()
      await writeFile(destPath, mock)
      return mock
    } catch (err) {
      this.log.error('Aufnahme endgültig fehlgeschlagen', err)
      // Kamera könnte abgezogen/aus sein – beim nächsten Start neu erkennen.
      this.available = false
      throw err
    } finally {
      this.capturing = false
    }
  }

  /** Räumt alles auf (beim Beenden). */
  dispose(): void {
    this.disposed = true
    this.wantLive = false
    clearInterval(this.watchdog)
    this.clearRestart()
    this.stopMovieProcess()
    this.stopMock()
    this.frameListeners.clear()
  }

  // ---- intern -------------------------------------------------------------

  private spawnLiveview(): void {
    if (this.disposed) return
    // Frischer Start: Frame-Uhr zurücksetzen, sonst feuert der Watchdog mit einem
    // alten Timestamp und killt den eben gestarteten Prozess sofort wieder.
    this.lastFrameAt = Date.now()
    if (this.available) this.startRealLiveview()
    else this.startMockLiveview()
    this.setStatus('live')
  }

  private startRealLiveview(): void {
    this.splitter.reset()
    let proc: ChildProcessWithoutNullStreams
    try {
      proc = spawn('gphoto2', ['--capture-movie', '--stdout'])
    } catch (err) {
      this.log.error('Liveview konnte nicht gestartet werden', err)
      this.scheduleRestart()
      return
    }
    this.movieProc = proc
    proc.stdout.on('data', (chunk: Buffer) => {
      for (const frame of this.splitter.push(chunk)) this.emitFrame(frame)
    })
    proc.on('error', (err) => {
      this.log.error('Liveview-Prozessfehler', err)
      if (this.movieProc === proc) this.movieProc = null
      if (this.wantLive && !this.capturing) this.scheduleRestart()
    })
    proc.on('exit', (code, signal) => {
      if (this.movieProc === proc) this.movieProc = null
      if (this.disposed || this.capturing || !this.wantLive) return
      this.log.warn(`Liveview beendet (code=${code} signal=${signal}) – Neustart`)
      this.scheduleRestart()
    })
  }

  private stopMovieProcess(): void {
    if (this.movieProc) {
      const proc = this.movieProc
      this.movieProc = null
      try {
        proc.kill('SIGTERM')
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL')
        }, 1500).unref?.()
      } catch (err) {
        this.log.warn('Liveview-Prozess konnte nicht beendet werden', err)
      }
    }
    this.splitter.reset()
  }

  private scheduleRestart(): void {
    if (this.restartTimer || !this.wantLive || this.disposed) return
    this.restartAttempts++
    const delay = Math.min(RESTART_MAX_MS, RESTART_BASE_MS * 2 ** (this.restartAttempts - 1))
    this.setStatus(this.available ? 'reconnecting' : 'no-camera')
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.wantLive || this.capturing || this.disposed) return
      void this.detect()
        .catch(() => {})
        .then(() => {
          if (this.wantLive && !this.capturing && !this.movieProc && !this.mockTimer) {
            this.spawnLiveview()
          }
        })
    }, delay)
  }

  private clearRestart(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.restartAttempts = 0
  }

  private checkWatchdog(): void {
    if (!this.wantLive || this.capturing || this.disposed) return
    if (!this.available || !this.movieProc) return
    if (this.lastFrameAt && Date.now() - this.lastFrameAt > FRAME_TIMEOUT_MS) {
      this.log.warn('Keine Frames – Watchdog startet Liveview neu')
      this.stopMovieProcess()
      this.scheduleRestart()
    }
  }

  private emitFrame(frame: Buffer): void {
    this.latestFrame = frame
    this.lastFrameAt = Date.now()
    this.restartAttempts = 0 // laufende Frames → Backoff zurücksetzen
    for (const cb of this.frameListeners) {
      try {
        cb(frame)
      } catch (err) {
        this.log.warn('Frame-Listener-Fehler', err)
      }
    }
  }

  private startMockLiveview(): void {
    this.mockTimer = setInterval(() => {
      void this.renderMockFrame()
        .then((f) => this.emitFrame(f))
        .catch((err) => this.log.warn('Mock-Frame-Fehler', err))
    }, 100)
  }

  private stopMock(): void {
    if (this.mockTimer) {
      clearInterval(this.mockTimer)
      this.mockTimer = null
    }
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
}
