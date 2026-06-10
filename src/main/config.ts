import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { defaultSettings, settingsSchema, type Settings } from '@shared/types'

const dataDir = join(app.getPath('userData'), 'data')
const photosDir = join(dataDir, 'photos')
const settingsFile = join(dataDir, 'settings.json')
const adminFile = join(dataDir, 'admin.json')

mkdirSync(photosDir, { recursive: true })

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
  } catch {
    cached = { ...defaultSettings }
  }
  return cached
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  const next = settingsSchema.parse({ ...(await getSettings()), ...partial })
  cached = next
  await writeFile(settingsFile, JSON.stringify(next, null, 2), 'utf8')
  return next
}

interface AdminRecord {
  salt: string
  hash: string
}

function hashPassword(password: string, salt: string): Buffer {
  return scryptSync(password, salt, 64)
}

async function readAdmin(): Promise<AdminRecord> {
  try {
    return JSON.parse(await readFile(adminFile, 'utf8')) as AdminRecord
  } catch {
    // Erst-Setup: Standardpasswort "admin" — beim ersten Login ändern!
    return seedAdmin('admin')
  }
}

async function seedAdmin(password: string): Promise<AdminRecord> {
  const salt = randomBytes(16).toString('hex')
  const record: AdminRecord = { salt, hash: hashPassword(password, salt).toString('hex') }
  await writeFile(adminFile, JSON.stringify(record), 'utf8')
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
