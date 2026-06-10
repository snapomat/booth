import { runCommand } from './util/exec'
import { retry } from './util/async'
import { createLogger } from './util/logger'

const log = createLogger('print')

/** Listet verfügbare CUPS-Drucker (`lpstat -e`). Leer bei Fehler. */
export async function listPrinters(): Promise<string[]> {
  try {
    const { stdout } = await runCommand('lpstat', ['-e'], { timeoutMs: 8000 })
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  } catch (err) {
    log.warn('Druckerliste konnte nicht gelesen werden', err)
    return []
  }
}

/**
 * Druckt eine Datei über CUPS (`lp`) – mit Timeout und Wiederholungen.
 * Wirft mit aussagekräftiger Meldung, wenn der Druck endgültig scheitert.
 */
export async function printFile(
  filePath: string,
  printerName: string,
  copies: number
): Promise<void> {
  const args = ['-d', printerName, '-n', String(Math.max(1, copies)), '-o', 'fit-to-page', filePath]
  await retry(
    async () => {
      await runCommand('lp', args, { timeoutMs: 30_000 })
    },
    {
      attempts: 3,
      delayMs: 1000,
      onRetry: (err, attempt, next) =>
        log.warn(`Druck-Versuch ${attempt} fehlgeschlagen, Retry in ${next}ms`, err)
    }
  )
}
