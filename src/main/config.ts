import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { defaultSettings, settingsSchema, type Settings } from '@shared/types'
import { createLogger } from './util/logger'

const log = createLogger('config')

const dataDir = join(app.getPath('userData'), 'data')
const photosDir = join(dataDir, 'photos')
const settingsFile = join(dataDir, 'settings.json')
const adminFile = join(dataDir, 'admin.json')

try {
  mkdirSync(photosDir, { recursive: true })
} catch (err) {
  log.error('Daten-Verzeichnis konnte nicht angelegt werden', err)
}

/** Schreibt eine Datei atomar (temp + rename), damit nie eine halbe Datei entsteht. */
async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, file)
}

/** Verzeichnis für aufgenommene Fotos. */
export function getPhotosDir(): string {
  return photosDir
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

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const { salt, hash } = await readAdmin()
  const expected = Buffer.from(hash, 'hex')
  const actual = hashPassword(password, salt)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function setAdminPassword(password: string): Promise<void> {
  await seedAdmin(password)
}
