/** Zentrale Definition der IPC-Kanalnamen (Main ⇄ Preload). */
export const IPC = {
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  verifyAdminPassword: 'admin:verify',
  listPrinters: 'printers:list',
  pickImageFile: 'files:pickImage',
  readImageDataUrl: 'files:readImageDataUrl',
  getDefaultBackgrounds: 'files:defaultBackgrounds',
  cameraDiagnostics: 'camera:diagnostics',
  installGphoto2: 'camera:installGphoto2',
  resolveCameraSource: 'camera:resolveSource',
  liveviewUrl: 'camera:liveviewUrl',
  startLiveview: 'camera:startLiveview',
  stopLiveview: 'camera:stopLiveview',
  capture: 'camera:capture',
  captureFromDataUrl: 'camera:captureFromDataUrl',
  print: 'print:run',
  cameraStatus: 'camera:status'
} as const
