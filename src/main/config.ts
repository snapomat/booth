import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { defaultSettings, settingsSchema, type Settings } from '@shared/types'
import { createLogger } from './util/logger'
import { RateLimiter } from './util/rate-limit'

const log = createLogger('config')

// Private Config bleibt im userData-Verzeichnis …
const dataDir = join(app.getPath('userData'), 'data')
const settingsFile = join(dataDir, 'settings.json')
const adminFile = join(dataDir, 'admin.json')
// … die Fotos (und events.json) landen sichtbar auf dem Desktop.
const photosDir = join(app.getPath('desktop'), 'Snapomat')

for (const dir of [dataDir, photosDir]) {
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    log.error(`Verzeichnis ${dir} konnte nicht angelegt werden`, err)
  }
}

/** Schreibt eine Datei atomar (temp + rename), damit nie eine halbe Datei entsteht. */
export async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, file)
}

/** Verzeichnis für aufgenommene Fotos. */
export function getPhotosDir(): string {
  return photosDir
}

/** Daten-Verzeichnis (settings.json, admin.json, events.json). */
export function getDataDir(): string {
  return dataDir
}

let cached: Settings | null = null

export async function getSettings(): Promise<Settings> {
  if (cached) return cached
  try {
    const raw = await readFile(settingsFile, 'utf8')
    cached = settingsSchema.parse({ ...defaultSettings, ...JSON.parse(raw) })
  } catch (err) {
    // Defekte/fehlende Datei → Defaults, Betrieb läuft weiter.
    cached = { ...defaultSettings }
    if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
      log.warn('settings.json defekt – Defaults verwendet', err)
    }
  }
  return cached
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  const next = settingsSchema.parse({ ...(await getSettings()), ...partial })
  cached = next
  await writeAtomic(settingsFile, JSON.stringify(next, null, 2))
  return next
}

interface AdminRecord {
  salt: string
  hash: string
}

function hashPassword(password: string, salt: string): Buffer {
  return scryptSync(password, salt, 64)
}

/** Standard-PIN beim Erst-Setup – bitte nach der Installation ändern. */
const DEFAULT_PIN = '1234'

async function readAdmin(): Promise<AdminRecord> {
  try {
    return JSON.parse(await readFile(adminFile, 'utf8')) as AdminRecord
  } catch {
    return seedAdmin(DEFAULT_PIN)
  }
}

async function seedAdmin(password: string): Promise<AdminRecord> {
  const salt = randomBytes(16).toString('hex')
  const record: AdminRecord = { salt, hash: hashPassword(password, salt).toString('hex') }
  await writeAtomic(adminFile, JSON.stringify(record))
  return record
}

// Brute-Force-Bremse: 5 Fehlversuche → 30 s Sperre (gilt prozessweit).
const pinLimiter = new RateLimiter(5, 30_000)

/** Verbleibende PIN-Sperrzeit in Sekunden (0 = frei). */
export function adminLockSeconds(): number {
  return Math.ceil(pinLimiter.retryAfterMs() / 1000)
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  if (pinLimiter.isLocked()) return false
  const { salt, hash } = await readAdmin()
  const expected = Buffer.from(hash, 'hex')
  const actual = hashPassword(password, salt)
  const ok = expected.length === actual.length && timingSafeEqual(expected, actual)
  if (ok) pinLimiter.reset()
  else pinLimiter.recordFailure()
  return ok
}

export async function setAdminPassword(password: string): Promise<void> {
  await seedAdmin(password)
}

/** Mindestanforderung an einen neuen PIN (4-stellig, nur Ziffern). */
const PIN_PATTERN = /^\d{4}$/

/**
 * Ändert den Admin-PIN. Verlangt den korrekten alten PIN (rate-limitiert) und
 * validiert den neuen. Wirft mit klarer Meldung bei Fehlern.
 */
export async function changeAdminPassword(oldPin: string, newPin: string): Promise<void> {
  if (!PIN_PATTERN.test(newPin)) throw new Error('Neuer PIN muss 4-stellig sein (nur Ziffern).')
  if (!(await verifyAdminPassword(oldPin))) {
    const lock = adminLockSeconds()
    throw new Error(lock > 0 ? `Zu viele Fehlversuche – gesperrt für ${lock}s.` : 'Alter PIN falsch.')
  }
  await setAdminPassword(newPin)
}
