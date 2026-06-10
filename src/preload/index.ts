import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { CameraStatus, PhotoboothApi } from '@shared/types'

const api: PhotoboothApi = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (partial, adminPassword) =>
    ipcRenderer.invoke(IPC.saveSettings, partial, adminPassword),
  verifyAdminPassword: (password) => ipcRenderer.invoke(IPC.verifyAdminPassword, password),
  listPrinters: () => ipcRenderer.invoke(IPC.listPrinters),
  pickImageFile: () => ipcRenderer.invoke(IPC.pickImageFile),
  readImageDataUrl: (path) => ipcRenderer.invoke(IPC.readImageDataUrl, path),
  getDefaultBackgrounds: () => ipcRenderer.invoke(IPC.getDefaultBackgrounds),
  resolveCameraSource: () => ipcRenderer.invoke(IPC.resolveCameraSource),
  liveviewUrl: () => ipcRenderer.invoke(IPC.liveviewUrl),
  startLiveview: () => ipcRenderer.invoke(IPC.startLiveview),
  stopLiveview: () => ipcRenderer.invoke(IPC.stopLiveview),
  capture: () => ipcRenderer.invoke(IPC.capture),
  captureFromDataUrl: (dataUrl) => ipcRenderer.invoke(IPC.captureFromDataUrl, dataUrl),
  print: (captureId) => ipcRenderer.invoke(IPC.print, captureId),
  onCameraStatus: (cb) => {
    const listener = (_e: IpcRendererEvent, status: CameraStatus): void => cb(status)
    ipcRenderer.on(IPC.cameraStatus, listener)
    return () => ipcRenderer.removeListener(IPC.cameraStatus, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
