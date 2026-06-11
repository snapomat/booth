/**
 * Einfacher Fehlversuch-Begrenzer für die PIN-Prüfung. Nach `maxAttempts`
 * aufeinanderfolgenden Fehlversuchen wird für `lockMs` gesperrt; ein Erfolg
 * setzt den Zähler zurück. Die Uhr ist injizierbar (Tests).
 */
export class RateLimiter {
  private failures = 0
  private lockedUntil = 0

  constructor(
    private readonly maxAttempts: number,
    private readonly lockMs: number,
    private readonly now: () => number = Date.now
  ) {}

  /** Verbleibende Sperrzeit in ms (0 = nicht gesperrt). */
  retryAfterMs(): number {
    return Math.max(0, this.lockedUntil - this.now())
  }

  /** True, solange gesperrt. */
  isLocked(): boolean {
    return this.retryAfterMs() > 0
  }

  /** Fehlversuch verbuchen; bei Erreichen von `maxAttempts` wird gesperrt. */
  recordFailure(): void {
    this.failures++
    if (this.failures >= this.maxAttempts) {
      this.lockedUntil = this.now() + this.lockMs
      this.failures = 0
    }
  }

  /** Erfolg: Zähler und Sperre zurücksetzen. */
  reset(): void {
    this.failures = 0
    this.lockedUntil = 0
  }
}
