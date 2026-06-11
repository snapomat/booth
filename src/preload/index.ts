import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { CameraStatus, PhotoboothApi } from '@shared/types'

const api: PhotoboothApi = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (partial, adminPassword) =>
    ipcRenderer.invoke(IPC.saveSettings, partial, adminPassword),
  verifyAdminPassword: (password) => ipcRenderer.invoke(IPC.verifyAdminPassword, password),
  changeAdminPassword: (oldPin, newPin) =>
    ipcRenderer.invoke(IPC.changeAdminPassword, oldPin, newPin),
  listEvents: () => ipcRenderer.invoke(IPC.listEvents),
  createEvent: (name) => ipcRenderer.invoke(IPC.createEvent, name),
  setActiveEvent: (id) => ipcRenderer.invoke(IPC.setActiveEvent, id),
  deleteEvent: (id) => ipcRenderer.invoke(IPC.deleteEvent, id),
  listPrinters: () => ipcRenderer.invoke(IPC.listPrinters),
  pickImageFile: () => ipcRenderer.invoke(IPC.pickImageFile),
  readImageDataUrl: (path) => ipcRenderer.invoke(IPC.readImageDataUrl, path),
  getDefaultBackgrounds: () => ipcRenderer.invoke(IPC.getDefaultBackgrounds),
  getCameraDiagnostics: () => ipcRenderer.invoke(IPC.cameraDiagnostics),
  installGphoto2: () => ipcRenderer.invoke(IPC.installGphoto2),
  resolveCameraSource: () => ipcRenderer.invoke(IPC.resolveCameraSource),
  liveviewUrl: () => ipcRenderer.invoke(IPC.liveviewUrl),
  startLiveview: () => ipcRenderer.invoke(IPC.startLiveview),
  stopLiveview: () => ipcRenderer.invoke(IPC.stopLiveview),
  capture: () => ipcRenderer.invoke(IPC.capture),
  captureFromDataUrl: (dataUrl) => ipcRenderer.invoke(IPC.captureFromDataUrl, dataUrl),
  print: (captureId) => ipcRenderer.invoke(IPC.print, captureId),
  aiStatus: () => ipcRenderer.invoke(IPC.aiStatus),
  aiStylize: (captureId) => ipcRenderer.invoke(IPC.aiStylize, captureId),
  onCameraStatus: (cb) => {
    const listener = (_e: IpcRendererEvent, status: CameraStatus): void => cb(status)
    ipcRenderer.on(IPC.cameraStatus, listener)
    return () => ipcRenderer.removeListener(IPC.cameraStatus, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
