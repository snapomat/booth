import { existsSync, readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { UploadStatus } from '@shared/types'
import { getDataDir, getPhotosDir, getSettings, writeAtomic } from './config'
import { getActiveEvent, listEvents } from './events'
import { createLogger } from './util/logger'

const log = createLogger('uploader')

const QUEUE_FILE = join(getDataDir(), 'upload-queue.json')
const RETRY_INTERVAL_MS = 20_000
const UPLOAD_TIMEOUT_MS = 60_000
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])

interface QueueItem {
  filePath: string
  folderPath: string
  title: string
}

interface QueueState {
  pending: QueueItem[]
  uploaded: string[]
  /** Dauerhaft gescheiterte Uploads (4xx) – blockieren die Queue nicht. */
  failed: QueueItem[]
  codes: Record<string, string>
}

/** Upload-Fehler mit Hinweis, ob ein Retry sinnvoll ist. */
class UploadError extends Error {
  constructor(
    message: string,
    public readonly permanent: boolean
  ) {
    super(message)
    this.name = 'UploadError'
  }
}

let state: QueueState = { pending: [], uploaded: [], failed: [], codes: {} }
let running = false
let timer: NodeJS.Timeout | null = null
let lastError: string | null = null
let lastUploadAt: string | null = null

function loadState(): void {
  try {
    const raw = JSON.parse(readFileSync(QUEUE_FILE, 'utf8')) as Partial<QueueState>
    state = {
      pending: Array.isArray(raw.pending) ? raw.pending : [],
      uploaded: Array.isArray(raw.uploaded) ? raw.uploaded : [],
      failed: Array.isArray(raw.failed) ? raw.failed : [],
      codes: raw.codes && typeof raw.codes === 'object' ? raw.codes : {}
    }
  } catch {
    state = { pending: [], uploaded: [], failed: [], codes: {} }
  }
}

async function saveState(): Promise<void> {
  await writeAtomic(QUEUE_FILE, JSON.stringify(state, null, 2)).catch((err) =>
    log.warn('Upload-Queue konnte nicht gespeichert werden', err)
  )
}

function isKnown(filePath: string): boolean {
  return (
    state.uploaded.includes(filePath) ||
    state.pending.some((i) => i.filePath === filePath) ||
    state.failed.some((i) => i.filePath === filePath)
  )
}

/** Reiht eine Datei zum Upload ein (idempotent). Stößt die Verarbeitung an. */
export function enqueueUpload(item: QueueItem): void {
  if (isKnown(item.filePath)) return
  state.pending.push(item)
  void saveState().then(() => void processQueue())
}

/** Beim Start: bereits vorhandene, noch nicht hochgeladene Fotos nachtragen. */
async function scanBacklog(): Promise<void> {
  try {
    const { events } = await listEvents()
    for (const ev of events) {
      const dir = join(getPhotosDir(), ev.dir)
      if (!existsSync(dir)) continue
      const files = await readdir(dir).catch(() => [])
      for (const f of files) {
        if (!IMAGE_EXT.has(extname(f).toLowerCase())) continue
        const filePath = join(dir, f)
        if (!isKnown(filePath)) state.pending.push({ filePath, folderPath: ev.dir, title: ev.name })
      }
    }
    await saveState()
  } catch (err) {
    log.warn('Backlog-Scan fehlgeschlagen', err)
  }
}

async function uploadOne(item: QueueItem, baseUrl: string, token: string): Promise<void> {
  const data = await readFile(item.filePath)
  const form = new FormData()
  form.append('folderPath', item.folderPath)
  form.append('title', item.title)
  form.append('filename', basename(item.filePath))
  form.append('image', new Blob([new Uint8Array(data)], { type: 'image/jpeg' }), basename(item.filePath))

  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/ingest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
  })
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 200)
    // 4xx (außer 408 Timeout / 429 Rate-Limit) sind dauerhaft – Retry zwecklos.
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429
    throw new UploadError(`Ingest ${res.status}: ${body}`, permanent)
  }
  const json = (await res.json().catch(() => null)) as { gallery?: { code?: string } } | null
  const code = json?.gallery?.code
  if (typeof code === 'string') state.codes[item.folderPath] = code
}

async function processQueue(): Promise<void> {
  if (running) return
  const { uploadEnabled, galleryBaseUrl, galleryIngestToken } = await getSettings()
  if (!uploadEnabled || !galleryBaseUrl.trim() || !galleryIngestToken.trim()) return
  if (state.pending.length === 0) return
  running = true
  try {
    // Kopie durchgehen; bei Fehler abbrechen (nächster Tick versucht erneut).
    while (state.pending.length > 0) {
      const item = state.pending[0]
      if (!existsSync(item.filePath)) {
        // Datei weg (z. B. Event gelöscht) → aus der Queue nehmen.
        state.pending.shift()
        await saveState()
        continue
      }
      try {
        await uploadOne(item, galleryBaseUrl.trim(), galleryIngestToken.trim())
        state.pending.shift()
        state.uploaded.push(item.filePath)
        lastUploadAt = new Date().toISOString()
        lastError = null
        await saveState()
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        if (err instanceof UploadError && err.permanent) {
          // Dauerhaft kaputt (z. B. 400) → in die Dead-Letter-Liste, Queue läuft weiter.
          log.error('Upload dauerhaft fehlgeschlagen – übersprungen', err)
          const bad = state.pending.shift()
          if (bad) state.failed.push(bad)
          await saveState()
          continue
        }
        // Transient (offline/5xx/Timeout) → unverändert lassen, nächster Tick versucht erneut.
        log.warn('Upload fehlgeschlagen – Retry später', err)
        break
      }
    }
  } finally {
    running = false
  }
}

/** Initialisiert den Uploader (Queue laden, Backlog nachtragen, Timer starten). */
export function initUploader(): void {
  loadState()
  void scanBacklog().then(() => void processQueue())
  timer = setInterval(() => void processQueue(), RETRY_INTERVAL_MS)
  timer.unref?.()
}

export function disposeUploader(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/** Status für den Admin-Bereich (inkl. Galerie-Code des aktiven Events). */
export async function uploadStatus(): Promise<UploadStatus> {
  const { uploadEnabled, galleryBaseUrl, galleryIngestToken } = await getSettings()
  const active = await getActiveEvent().catch(() => null)
  const galleryCode = active ? (state.codes[active.dir] ?? null) : null
  return {
    enabled: uploadEnabled,
    configured: uploadEnabled && !!galleryBaseUrl.trim() && !!galleryIngestToken.trim(),
    pending: state.pending.length,
    failed: state.failed.length,
    lastError,
    lastUploadAt,
    galleryCode
  }
}
