import { existsSync, mkdirSync } from 'node:fs'
import { readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { EventInfo, EventsState } from '@shared/types'
import { getDataDir, getPhotosDir, writeAtomic } from './config'
import { createLogger } from './util/logger'
import { normalizeEventName } from './util/event-name'

const log = createLogger('events')

interface EventStore {
  events: EventInfo[]
  activeId: string | null
}

// events.json liegt bei den Fotos (Desktop/Snapomat), self-contained.
const storeFile = join(getPhotosDir(), 'events.json')
// Frühere Ablagen – werden einmalig migriert (älteste zuerst geprüft).
const legacyStoreFiles = [
  join(getDataDir(), 'events.json'),
  join(getDataDir(), 'photos', 'events.json')
]

let store: EventStore | null = null

async function load(): Promise<EventStore> {
  if (store) return store
  // Einmalige Migration aus früheren Ablagen → Desktop/Snapomat/events.json.
  if (!existsSync(storeFile)) {
    const legacy = legacyStoreFiles.find((f) => existsSync(f))
    if (legacy) {
      try {
        await rename(legacy, storeFile)
        log.info(`events.json von ${legacy} nach ${storeFile} migriert`)
      } catch (err) {
        log.warn('Migration der events.json fehlgeschlagen', err)
      }
    }
  }
  try {
    const parsed = JSON.parse(await readFile(storeFile, 'utf8')) as EventStore
    store = {
      events: Array.isArray(parsed.events) ? parsed.events : [],
      activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null
    }
  } catch {
    store = { events: [], activeId: null }
  }
  // Immer ein aktives Event sicherstellen, damit Aufnahmen einen Ordner haben.
  if (!store.events.some((e) => e.id === store!.activeId)) {
    if (store.events.length > 0) {
      store.activeId = store.events[0].id
    } else {
      const seeded = makeEvent('Standard')
      store.events.push(seeded)
      store.activeId = seeded.id
      await persist()
    }
  }
  return store
}

function makeEvent(name: string): EventInfo {
  return { id: randomUUID(), name, createdAt: new Date().toISOString() }
}

async function persist(): Promise<void> {
  if (store) await writeAtomic(storeFile, JSON.stringify(store, null, 2))
}

/** Liefert alle Events (neueste zuerst) samt aktivem Event. */
export async function listEvents(): Promise<EventsState> {
  const s = await load()
  const events = [...s.events].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { events, activeId: s.activeId }
}

/** Das aktuell aktive Event (nie null, da on-demand ein Standard angelegt wird). */
export async function getActiveEvent(): Promise<EventInfo> {
  const s = await load()
  return s.events.find((e) => e.id === s.activeId) ?? s.events[0]
}

/** Foto-Ordner des aktiven Events (wird bei Bedarf angelegt). */
export async function getActiveEventDir(): Promise<string> {
  const active = await getActiveEvent()
  const dir = join(getPhotosDir(), active.id)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Legt ein Event an und macht es aktiv. */
export async function createEvent(rawName: string): Promise<EventInfo> {
  const s = await load()
  const ev = makeEvent(normalizeEventName(rawName))
  s.events.push(ev)
  s.activeId = ev.id
  await persist()
  return ev
}

/** Setzt das aktive Event. */
export async function setActiveEvent(id: string): Promise<void> {
  const s = await load()
  if (!s.events.some((e) => e.id === id)) throw new Error('Event nicht gefunden.')
  s.activeId = id
  await persist()
}

/** Löscht ein Event inkl. seiner Fotos. Das letzte Event bleibt erhalten. */
export async function deleteEvent(id: string): Promise<void> {
  const s = await load()
  if (s.events.length <= 1) throw new Error('Das letzte Event kann nicht gelöscht werden.')
  if (!s.events.some((e) => e.id === id)) return
  s.events = s.events.filter((e) => e.id !== id)
  if (s.activeId === id) s.activeId = s.events[0]?.id ?? null
  await persist()
  // Fotos des Events entfernen (best effort).
  await rm(join(getPhotosDir(), id), { recursive: true, force: true }).catch((err) =>
    log.warn(`Event-Ordner ${id} konnte nicht gelöscht werden`, err)
  )
}
