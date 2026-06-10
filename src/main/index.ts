import { app, BrowserWindow, globalShortcut, session } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { CameraStatus } from '@shared/types'
import { CameraManager } from './camera'
import { LiveviewServer } from './liveview-server'
import { registerIpc } from './ipc'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

const camera = new CameraManager()
const liveview = new LiveviewServer(camera)
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#0b0f1a',
    autoHideMenuBar: true,
    // Im Produktivbetrieb echter Kiosk; in der Entwicklung Fenster + DevTools.
    fullscreen: !isDev,
    kiosk: !isDev,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  camera.on('status', (status: CameraStatus) => {
    // Beim Beenden kann das Fenster bereits zerstört sein.
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(IPC.cameraStatus, status)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function bootstrap(): Promise<void> {
  // Kamera/Mikrofon für getUserMedia (Webcam-Quelle) erlauben – lokale Kiosk-App.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  await camera.detect()
  await liveview.start()
  registerIpc(camera, liveview)

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

app.whenReady().then(bootstrap)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  camera.stopLiveview()
  liveview.stop()
})
