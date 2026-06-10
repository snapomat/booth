import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync, appendFileSync, statSync, renameSync, existsSync } from 'node:fs'

const MAX_LOG_BYTES = 5 * 1024 * 1024

let logFile: string | null = null

function ensureLogFile(): string | null {
  if (logFile) return logFile
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    logFile = join(dir, 'snapomat.log')
    return logFile
  } catch {
    return null
  }
}

function rotateIfNeeded(file: string): void {
  try {
    if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) {
      renameSync(file, `${file}.1`)
    }
  } catch {
    /* Logging darf nie den Betrieb stören */
  }
}

type Level = 'INFO' | 'WARN' | 'ERROR'

function write(level: Level, scope: string, message: string, err?: unknown): void {
  const stamp = new Date().toISOString()
  const detail = err instanceof Error ? ` | ${err.stack ?? err.message}` : err ? ` | ${String(err)}` : ''
  const line = `${stamp} [${level}] (${scope}) ${message}${detail}`
  // Konsole
  if (level === 'ERROR') console.error(line)
  else if (level === 'WARN') console.warn(line)
  else console.log(line)
  // Datei – Fehler hier dürfen niemals propagieren
  const file = ensureLogFile()
  if (!file) return
  try {
    rotateIfNeeded(file)
    appendFileSync(file, line + '\n')
  } catch {
    /* ignorieren */
  }
}

/** Erzeugt einen scope-gebundenen Logger. */
export function createLogger(scope: string): {
  info: (message: string, err?: unknown) => void
  warn: (message: string, err?: unknown) => void
  error: (message: string, err?: unknown) => void
} {
  return {
    info: (m, e) => write('INFO', scope, m, e),
    warn: (m, e) => write('WARN', scope, m, e),
    error: (m, e) => write('ERROR', scope, m, e)
  }
}

export function logPath(): string | null {
  return ensureLogFile()
}
