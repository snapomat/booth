import { app, dialog, ipcMain } from 'electron'
import { extname, join } from 'node:path'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/ipc'
import type { CaptureResult, DefaultBackground, ResolvedCameraSource } from '@shared/types'
import { settingsSchema } from '@shared/types'
import type { CameraManager } from './camera'
import type { LiveviewServer } from './liveview-server'
import {
  getPhotosDir,
  getSettings,
  saveSettings,
  verifyAdminPassword
} from './config'
import { composePrint } from './composite'
import { listPrinters, printFile } from './print'

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

/** HSL → Hex (h in Grad, s/l in 0–1). */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x]
  const hex = (v: number): string => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * Leitet eine satte, mittelhelle Akzentfarbe aus einem Bild ab. Statt der
 * (oft neutralen) Dominanten wird der nach Sättigung gewichtete Durchschnitts-
 * Farbton der bunten Bildbereiche genommen – dunkler Text bleibt lesbar.
 */
async function imageAccent(path: string): Promise<string> {
  const fallback = '#e8a23c'
  try {
    const { data } = await sharp(path)
      .resize(64, 64, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    let sumSin = 0
    let sumCos = 0
    let wSat = 0
    let wTot = 0
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i] / 255
      const g = data[i + 1] / 255
      const b = data[i + 2] / 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const d = max - min
      if (d === 0) continue
      const sat = d / max
      const w = sat * max // bunte, nicht zu dunkle Pixel bevorzugen
      let h = max === r ? (((g - b) / d) % 6 + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      h *= 60
      const rad = (h * Math.PI) / 180
      sumSin += Math.sin(rad) * w
      sumCos += Math.cos(rad) * w
      wSat += sat * w
      wTot += w
    }
    if (wTot < 1e-3) return fallback // (nahezu) graustufiges Bild
    let hue = (Math.atan2(sumSin, sumCos) * 180) / Math.PI
    if (hue < 0) hue += 360
    const sat = Math.min(0.85, Math.max(0.55, wSat / wTot))
    return hslToHex(hue, sat, 0.58)
  } catch {
    return fallback
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
  const id = randomUUID()
  const path = join(getPhotosDir(), `${id}.jpg`)
  await writeFile(path, jpeg)
  captures.set(id, path)
  return { id, dataUrl }
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

  ipcMain.handle(IPC.resolveCameraSource, () => resolveCameraSource(camera))

  ipcMain.handle(IPC.liveviewUrl, () => liveview.url())

  ipcMain.handle(IPC.startLiveview, () => camera.startLiveview())
  ipcMain.handle(IPC.stopLiveview, () => camera.stopLiveview())

  ipcMain.handle(IPC.capture, async () => {
    const original = await camera.capture(join(getPhotosDir(), `${randomUUID()}.orig.jpg`))
    // Liveview NICHT wieder starten – Idle lässt die Kamera ruhen (Spiegel/Sensor).
    return persistCapture(original)
  })

  ipcMain.handle(IPC.captureFromDataUrl, async (_e, dataUrl: unknown) => {
    if (typeof dataUrl !== 'string') throw new Error('Ungültige Bilddaten')
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const original = Buffer.from(base64, 'base64')
    return persistCapture(original)
  })

  ipcMain.handle(IPC.print, async (_e, captureId: unknown) => {
    if (typeof captureId !== 'string') throw new Error('Ungültige Aufnahme-ID')
    const path = captures.get(captureId)
    if (!path) throw new Error('Aufnahme nicht gefunden')
    const settings = await getSettings()
    if (!settings.printerName) throw new Error('Kein Drucker konfiguriert')
    await printFile(path, settings.printerName, settings.printsPerCapture)
  })
}
