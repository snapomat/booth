import { app, BrowserWindow, globalShortcut, session } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { CameraStatus } from '@shared/types'
import { CameraManager } from './camera'
import { LiveviewServer } from './liveview-server'
import { registerIpc } from './ipc'
import { initUploader, disposeUploader } from './uploader'
import { createLogger } from './util/logger'

const log = createLogger('main')
const isDev = !!process.env['ELECTRON_RENDERER_URL']

const camera = new CameraManager()
const liveview = new LiveviewServer(camera)
let mainWindow: BrowserWindow | null = null
let reloadTimer: NodeJS.Timeout | null = null

function loadRenderer(win: BrowserWindow): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Erstellt das Fenster neu, wenn der Renderer abstürzt/hängt. */
function recoverRenderer(reason: string): void {
  log.error(`Renderer verloren (${reason}) – Fenster wird neu erstellt`)
  // Ausstehenden Reload-Retry verwerfen – er gehörte zum alten Fenster.
  if (reloadTimer) {
    clearTimeout(reloadTimer)
    reloadTimer = null
  }
  try {
    mainWindow?.destroy()
  } catch (err) {
    log.warn('Fenster konnte nicht zerstört werden', err)
  }
  mainWindow = null
  setTimeout(() => createWindow(), 500)
}

function createWindow(): void {
  const win = new BrowserWindow({
    // Zielgerät: 1024×768-Kiosk. In der Entwicklung passendes Fenster.
    width: 1024,
    height: 768,
    show: false,
    backgroundColor: '#100b09',
    autoHideMenuBar: true,
    // Im Produktivbetrieb echter Kiosk; in der Entwicklung Fenster + DevTools.
    fullscreen: !isDev,
    kiosk: !isDev,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // Renderer-Absturz / Hänger → neu erstellen.
  win.webContents.on('render-process-gone', (_e, details) => recoverRenderer(details.reason))
  win.webContents.on('unresponsive', () => recoverRenderer('unresponsive'))
  win.webContents.on('did-fail-load', (_e, errorCode, errorDesc, _url, isMainFrame) => {
    // -3 = ERR_ABORTED (normale Navigation), ignorieren.
    if (!isMainFrame || errorCode === -3) return
    log.warn(`Renderer-Load fehlgeschlagen (${errorCode} ${errorDesc}) – Retry`)
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) loadRenderer(mainWindow)
    }, 1500)
  })

  if (isDev) win.webContents.openDevTools({ mode: 'detach' })
  loadRenderer(win)
}

function sendCameraStatus(status: CameraStatus): void {
  // Beim Beenden / Neuladen kann das Fenster bereits zerstört sein.
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(IPC.cameraStatus, status)
  }
}

async function bootstrap(): Promise<void> {
  // Kamera/Mikrofon für getUserMedia (Webcam-Quelle) erlauben – lokale Kiosk-App.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  // Status-Events einmalig verdrahten (nicht pro Fenster).
  camera.on('status', sendCameraStatus)

  await camera.detect().catch((err) => log.error('Kamera-Erkennung fehlgeschlagen', err))
  await liveview.start().catch((err) => log.error('Liveview-Server-Start fehlgeschlagen', err))
  registerIpc(camera, liveview)
  initUploader()

  // Liveview wird NICHT automatisch gestartet – erst on-demand beim Auslösen,
  // um Spiegel/Sensor der DSLR zu schonen.

  createWindow()

  // Notausstieg aus dem Kiosk (z. B. zum Warten/Beenden auf dem Gerät).
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit())

  // Kiosk/Vollbild umschalten, ohne die App zu beenden.
  globalShortcut.register('CommandOrControl+Shift+F', () => {
    if (!mainWindow) return
    const leaving = mainWindow.isKiosk()
    mainWindow.setKiosk(!leaving)
    mainWindow.setFullScreen(!leaving)
  })
}

// Prozessweite Sicherungsnetze: niemals an einem unerwarteten Fehler sterben.
process.on('uncaughtException', (err) => log.error('uncaughtException', err))
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason))

app.whenReady().then(bootstrap).catch((err) => log.error('Bootstrap fehlgeschlagen', err))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  camera.dispose()
  liveview.stop()
  disposeUploader()
})
