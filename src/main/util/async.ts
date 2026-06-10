/** Wartet die angegebene Zeit (ms). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface RetryOptions {
  /** Maximale Versuche insgesamt (inkl. erstem). */
  attempts: number
  /** Basis-Verzögerung zwischen Versuchen (ms). */
  delayMs: number
  /** Faktor für exponentielles Backoff (Default 2). */
  backoff?: number
  /** Obergrenze der Verzögerung (ms). */
  maxDelayMs?: number
  /** Callback bei jedem Fehlversuch (für Logging). */
  onRetry?: (error: unknown, attempt: number, nextDelayMs: number) => void
  /** Abbruchsignal – bricht weitere Versuche ab. */
  signal?: AbortSignal
}

/**
 * Führt `fn` aus und wiederholt bei Fehler mit exponentiellem Backoff.
 * Wirft den letzten Fehler, wenn alle Versuche scheitern.
 */
export async function retry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const { attempts, delayMs, backoff = 2, maxDelayMs = 30_000, onRetry, signal } = opts
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) throw new Error('abgebrochen')
    try {
      return await fn(attempt)
    } catch (err) {
      lastError = err
      if (attempt >= attempts) break
      const wait = Math.min(maxDelayMs, delayMs * backoff ** (attempt - 1))
      onRetry?.(err, attempt, wait)
      await sleep(wait)
    }
  }
  throw lastError
}

/** Wie `retry`, liefert aber `null` statt zu werfen, wenn alles scheitert. */
export async function retryOrNull<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions
): Promise<T | null> {
  try {
    return await retry(fn, opts)
  } catch {
    return null
  }
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Zeitüberschreitung nach ${ms} ms`)
    this.name = 'TimeoutError'
  }
}

/**
 * Versieht ein Promise mit einem Timeout. `onTimeout` wird aufgerufen, bevor
 * mit TimeoutError verworfen wird (z. B. um einen Prozess zu killen).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.()
      reject(new TimeoutError(ms))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}
