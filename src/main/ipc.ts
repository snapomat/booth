import { app, dialog, ipcMain } from 'electron'
import { extname, join } from 'node:path'
import { readdir, readFile, writeFile, rm } from 'node:fs/promises'
import sharp from 'sharp'
import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/ipc'
import type { CaptureResult, DefaultBackground, ResolvedCameraSource } from '@shared/types'
import { settingsSchema } from '@shared/types'
import type { CameraManager } from './camera'
import type { LiveviewServer } from './liveview-server'
import {
  changeAdminPassword,
  getPhotosDir,
  getSettings,
  saveSettings,
  verifyAdminPassword
} from './config'
import { createEvent, deleteEvent, getActiveEventDir, listEvents, setActiveEvent } from './events'
import { resolveApiKey, stylizePhoto } from './ai-portraits'
import { composePrint } from './composite'
import { listPrinters, printFile } from './print'
import { accentFromPixels, DEFAULT_ACCENT } from './util/color'
import { createLogger } from './util/logger'
import { runCommand } from './util/exec'

const log = createLogger('ipc')

/** Im Speicher gehaltene, druckfertige Aufnahmen der aktuellen Sitzung. */
const captures = new Map<string, string>()

const imageMime: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

/** Liest eine Bilddatei als Data-URL (oder null bei Fehler/unbekanntem Typ). */
async function imageToDataUrl(path: string): Promise<string | null> {
  const type = imageMime[extname(path).toLowerCase()]
  if (!type) return null
  try {
    const data = await readFile(path)
    return `data:${type};base64,${data.toString('base64')}`
  } catch {
    return null
  }
}

/** Verzeichnis mit den mitgelieferten Standard-Hintergründen (Dev vs. Paket). */
function backgroundsDir(): string {
  // Paket: process.resourcesPath/resources/backgrounds (via extraResources).
  // Dev: aus out/main heraus zwei Ebenen hoch zum Projektroot.
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', 'backgrounds')
    : join(__dirname, '..', '..', 'resources', 'backgrounds')
}

/** Akzentfarbe aus dem Bild ableiten (Farb-Logik im util/color-Modul, getestet). */
async function imageAccent(path: string): Promise<string> {
  try {
    const { data, info } = await sharp(path)
      .resize(64, 64, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return accentFromPixels(data, info.channels)
  } catch (err) {
    log.warn(`Akzentfarbe für ${path} fehlgeschlagen`, err)
    return DEFAULT_ACCENT
  }
}

export async function resolveCameraSource(
  camera: CameraManager
): Promise<ResolvedCameraSource> {
  const { cameraSource } = await getSettings()
  if (cameraSource === 'auto') return camera.isAvailable() ? 'gphoto2' : 'mock'
  return cameraSource
}

/** Speichert ein druckfertiges Bild und liefert das Renderer-Ergebnis. */
async function persistCapture(original: Buffer): Promise<CaptureResult> {
  const { jpeg, dataUrl } = await composePrint(original)
  // Kleines Thumbnail für die Collage – spart RAM & Dekodier-Last im Renderer.
  const thumb = await sharp(jpeg).resize(480).jpeg({ quality: 68 }).toBuffer()
  const thumbUrl = `data:image/jpeg;base64,${thumb.toString('base64')}`
  const id = randomUUID()
  // In den Ordner des aktiven Events legen (gruppiert die Aufnahmen).
  const path = join(await getActiveEventDir(), `${id}.jpg`)
  await writeFile(path, jpeg)
  captures.set(id, path)
  return { id, dataUrl, thumbUrl }
}

export function registerIpc(camera: CameraManager, liveview: LiveviewServer): void {
  ipcMain.handle(IPC.getSettings, () => getSettings())

  ipcMain.handle(IPC.saveSettings, async (_e, partial: unknown, adminPassword: unknown) => {
    if (typeof adminPassword !== 'string' || !(await verifyAdminPassword(adminPassword))) {
      throw new Error('Falsches Admin-Passwort')
    }
    const parsed = settingsSchema.partial().parse(partial)
    return saveSettings(parsed)
  })

  ipcMain.handle(IPC.verifyAdminPassword, (_e, pw: unknown) =>
    typeof pw === 'string' ? verifyAdminPassword(pw) : false
  )

  ipcMain.handle(IPC.changeAdminPassword, async (_e, oldPin: unknown, newPin: unknown) => {
    if (typeof oldPin !== 'string' || typeof newPin !== 'string') {
      throw new Error('Ungültige Eingabe')
    }
    await changeAdminPassword(oldPin, newPin)
  })

  ipcMain.handle(IPC.listEvents, () => listEvents())
  ipcMain.handle(IPC.createEvent, (_e, name: unknown) => {
    if (typeof name !== 'string') throw new Error('Ungültiger Event-Name')
    return createEvent(name)
  })
  ipcMain.handle(IPC.setActiveEvent, (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Ungültige Event-ID')
    return setActiveEvent(id)
  })
  ipcMain.handle(IPC.deleteEvent, (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Ungültige Event-ID')
    return deleteEvent(id)
  })

  ipcMain.handle(IPC.listPrinters, () => listPrinters())

  ipcMain.handle(IPC.pickImageFile, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.readImageDataUrl, (_e, path: unknown) =>
    typeof path === 'string' ? imageToDataUrl(path) : null
  )

  ipcMain.handle(IPC.getDefaultBackgrounds, async () => {
    try {
      const dir = backgroundsDir()
      const files = (await readdir(dir)).filter((f) => imageMime[extname(f).toLowerCase()]).sort()
      const entries = await Promise.all(
        files.map(async (f) => ({
          name: f,
          dataUrl: await imageToDataUrl(join(dir, f)),
          accent: await imageAccent(join(dir, f))
        }))
      )
      return entries.filter((e): e is DefaultBackground => e.dataUrl !== null)
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC.cameraDiagnostics, () => ({
    gphoto2Missing: camera.isGphoto2Missing(),
    cameraDetected: camera.isAvailable(),
    platform: process.platform
  }))

  ipcMain.handle(IPC.installGphoto2, async () => {
    if (process.platform !== 'linux') {
      return {
        ok: false,
        message: 'Automatische Installation nur unter Linux (macOS: brew install gphoto2).'
      }
    }
    try {
      // pkexec öffnet einen grafischen Admin-Dialog (PolicyKit).
      await runCommand('pkexec', ['apt-get', 'install', '-y', 'gphoto2', 'libgphoto2-6'], {
        timeoutMs: 180_000
      })
      await camera.detect()
      return { ok: true, message: 'gphoto2 wurde installiert.' }
    } catch (err) {
      log.error('gphoto2-Installation fehlgeschlagen', err)
      return { ok: false, message: err instanceof Error ? err.message : 'Installation fehlgeschlagen' }
    }
  })

  ipcMain.handle(IPC.resolveCameraSource, () => resolveCameraSource(camera))

  ipcMain.handle(IPC.liveviewUrl, () => liveview.url())

  ipcMain.handle(IPC.startLiveview, () => camera.startLiveview())
  ipcMain.handle(IPC.stopLiveview, () => camera.stopLiveview())

  ipcMain.handle(IPC.capture, async () => {
    const origPath = join(getPhotosDir(), `${randomUUID()}.orig.jpg`)
    try {
      const original = await camera.capture(origPath)
      // Liveview NICHT wieder starten – Idle lässt die Kamera ruhen (Spiegel/Sensor).
      return await persistCapture(original)
    } catch (err) {
      log.error('Aufnahme/Speichern fehlgeschlagen', err)
      throw err
    } finally {
      // Original-Temp nicht aufheben – wir behalten nur das komponierte Bild.
      void rm(origPath, { force: true }).catch(() => {})
    }
  })

  ipcMain.handle(IPC.captureFromDataUrl, async (_e, dataUrl: unknown) => {
    if (typeof dataUrl !== 'string') throw new Error('Ungültige Bilddaten')
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const original = Buffer.from(base64, 'base64')
    return persistCapture(original)
  })

  ipcMain.handle(IPC.aiStatus, async () => {
    const { aiEnabled, aiApiKey } = await getSettings()
    return aiEnabled && !!resolveApiKey(aiApiKey)
  })

  ipcMain.handle(IPC.aiStylize, async (_e, captureId: unknown) => {
    if (typeof captureId !== 'string') throw new Error('Ungültige Aufnahme-ID')
    const srcPath = captures.get(captureId)
    if (!srcPath) throw new Error('Aufnahme nicht gefunden')
    const { aiEnabled, aiPrompt, aiApiKey, aiModel } = await getSettings()
    const apiKey = resolveApiKey(aiApiKey)
    if (!aiEnabled || !apiKey) throw new Error('AI-Portraits sind nicht aktiv')
    try {
      const original = await readFile(srcPath)
      const styled = await stylizePhoto(original, { apiKey, model: aiModel, prompt: aiPrompt })
      return await persistCapture(styled)
    } catch (err) {
      log.error('AI-Stilisierung fehlgeschlagen', err)
      throw err
    }
  })

  ipcMain.handle(IPC.print, async (_e, captureId: unknown) => {
    if (typeof captureId !== 'string') throw new Error('Ungültige Aufnahme-ID')
    const path = captures.get(captureId)
    if (!path) throw new Error('Aufnahme nicht gefunden')
    const settings = await getSettings()
    if (!settings.printerName) throw new Error('Kein Drucker konfiguriert')
    try {
      await printFile(path, settings.printerName, settings.printsPerCapture)
    } catch (err) {
      log.error('Druck fehlgeschlagen', err)
      throw err
    }
  })
}
