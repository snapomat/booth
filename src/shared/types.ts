import { z } from 'zod'

/**
 * Quelle für Liveview & Aufnahme.
 * - `auto`: gphoto2/Canon falls erkannt, sonst Mock.
 * - `gphoto2`: erzwingt die angeschlossene Canon.
 * - `webcam`: macOS-Webcam / iPhone Continuity Camera (im Renderer via getUserMedia).
 * - `mock`: generierte Testbilder.
 */
export const cameraSourceSchema = z.enum(['auto', 'gphoto2', 'webcam', 'mock'])
export type CameraSource = z.infer<typeof cameraSourceSchema>

/** Konkret aufgelöste Quelle (kein `auto` mehr). */
export type ResolvedCameraSource = 'gphoto2' | 'webcam' | 'mock'

/** Persistente Einstellungen der Photobooth (admin-geschützt). */
export const settingsSchema = z.object({
  /** Countdown vor der Aufnahme in Sekunden. */
  countdownSeconds: z.number().int().min(1).max(10),
  /** Anzahl Ausdrucke pro Aufnahme. */
  printsPerCapture: z.number().int().min(1).max(5),
  /** CUPS-Druckername (null = noch nicht gewählt). */
  printerName: z.string().nullable(),
  /** Begrüßungstext auf dem Startbildschirm. */
  welcomeText: z.string(),
  /** Welche Kamera-Quelle genutzt wird. */
  cameraSource: cameraSourceSchema,
  /** Sekunden, die der Vorschau-/Druck-Screen offen bleibt, bevor es zum Start zurückgeht. */
  reviewTimeoutSeconds: z.number().int().min(3).max(120),
  /** Eigenes Hintergrundbild (absoluter Pfad). Hat Vorrang vor allem anderen. */
  backgroundImagePath: z.string().nullable(),
  /** Gewählter Standard-Hintergrund (Dateiname). null = Slideshow aller Defaults. */
  backgroundDefault: z.string().nullable(),
  /** Deckkraft des Hintergrundbilds (0–1). */
  backgroundOpacity: z.number().min(0).max(1),
  /** Akzentfarbe (Buttons, Countdown-Ring etc.) als Hex. */
  accentColor: z.string()
})

export type Settings = z.infer<typeof settingsSchema>

export const defaultSettings: Settings = {
  countdownSeconds: 3,
  printsPerCapture: 1,
  printerName: null,
  welcomeText: 'Tippen zum Starten',
  cameraSource: 'auto',
  reviewTimeoutSeconds: 3,
  backgroundImagePath: null,
  backgroundDefault: null,
  backgroundOpacity: 0.35,
  accentColor: '#e8a23c'
}

/** Zustand der Kamera-Anbindung. */
export type CameraStatus =
  | 'idle'
  | 'live'
  | 'capturing'
  | 'reconnecting'
  | 'no-camera'
  | 'error'

/** Diagnose-Infos zur Kamera-Anbindung (für den Admin-Bereich). */
export interface CameraDiagnostics {
  /** gphoto2-Binary nicht gefunden (muss installiert werden). */
  gphoto2Missing: boolean
  /** Aktuell eine Kamera erkannt. */
  cameraDetected: boolean
  /** Plattform (linux/darwin/win32). */
  platform: string
}

/** Ergebnis der gphoto2-Installation. */
export interface InstallResult {
  ok: boolean
  message: string
}

/** Ein mitgelieferter Standard-Hintergrund. */
export interface DefaultBackground {
  name: string
  dataUrl: string
  /** Aus dem Bild abgeleitete, gut lesbare Akzentfarbe (Hex). */
  accent: string
}

/** Ergebnis einer Aufnahme. */
export interface CaptureResult {
  id: string
  /** Daten-URL des fertig komponierten Bildes in voller Auflösung (großes Vorschaubild). */
  dataUrl: string
  /** Kleines Thumbnail (für die Collage der letzten Fotos – spart Dekodier-Last). */
  thumbUrl: string
}

/** Typisierter API-Vertrag, der via Preload an den Renderer gereicht wird. */
export interface PhotoboothApi {
  getSettings(): Promise<Settings>
  saveSettings(partial: Partial<Settings>, adminPassword: string): Promise<Settings>
  verifyAdminPassword(password: string): Promise<boolean>
  listPrinters(): Promise<string[]>
  /** Öffnet einen nativen Datei-Dialog zur Bildauswahl, liefert den Pfad (oder null). */
  pickImageFile(): Promise<string | null>
  /** Lädt ein lokales Bild als Data-URL (für Vorschau/Hintergrund im Renderer). */
  readImageDataUrl(path: string): Promise<string | null>
  /** Liefert die mitgelieferten Standard-Hintergründe (Dateiname + Data-URL). */
  getDefaultBackgrounds(): Promise<DefaultBackground[]>
  /** Diagnose: gphoto2 installiert? Kamera erkannt? */
  getCameraDiagnostics(): Promise<CameraDiagnostics>
  /** Versucht (unter Linux, via pkexec/apt) gphoto2 zu installieren. */
  installGphoto2(): Promise<InstallResult>
  /** Konkret aufgelöste Kamera-Quelle (löst `auto` auf). */
  resolveCameraSource(): Promise<ResolvedCameraSource>
  /** Basis-URL des lokalen MJPEG-Liveview-Streams (für gphoto2/mock). */
  liveviewUrl(): Promise<string>
  /** Startet den backend-seitigen Liveview (gphoto2/mock) – nur on-demand (Spiegel/Sensor schonen). */
  startLiveview(): Promise<void>
  /** Stoppt den backend-seitigen Liveview. */
  stopLiveview(): Promise<void>
  /** Aufnahme über die backend-seitige Quelle (gphoto2/mock). */
  capture(): Promise<CaptureResult>
  /** Aufnahme aus einem im Renderer erzeugten Bild (Webcam/Continuity Camera). */
  captureFromDataUrl(dataUrl: string): Promise<CaptureResult>
  print(captureId: string): Promise<void>
  onCameraStatus(cb: (status: CameraStatus) => void): () => void
}
