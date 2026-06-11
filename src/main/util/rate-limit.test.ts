import { describe, it, expect } from 'vitest'
import { RateLimiter } from './rate-limit'

describe('RateLimiter', () => {
  it('sperrt erst nach maxAttempts Fehlversuchen', () => {
    const now = 0
    const rl = new RateLimiter(3, 1000, () => now)
    rl.recordFailure()
    rl.recordFailure()
    expect(rl.isLocked()).toBe(false)
    rl.recordFailure()
    expect(rl.isLocked()).toBe(true)
  })

  it('gibt die Sperre nach Ablauf der Zeit wieder frei', () => {
    let now = 0
    const rl = new RateLimiter(2, 1000, () => now)
    rl.recordFailure()
    rl.recordFailure()
    expect(rl.retryAfterMs()).toBe(1000)
    now = 999
    expect(rl.isLocked()).toBe(true)
    now = 1000
    expect(rl.isLocked()).toBe(false)
  })

  it('reset löscht Zähler und Sperre', () => {
    const now = 0
    const rl = new RateLimiter(2, 1000, () => now)
    rl.recordFailure()
    rl.recordFailure()
    expect(rl.isLocked()).toBe(true)
    rl.reset()
    expect(rl.isLocked()).toBe(false)
  })

  it('zählt nach einer Sperre wieder von vorn', () => {
    let now = 0
    const rl = new RateLimiter(2, 100, () => now)
    rl.recordFailure()
    rl.recordFailure() // sperrt, Zähler zurück auf 0
    now = 100
    rl.recordFailure()
    expect(rl.isLocked()).toBe(false) // erst ein neuer Fehlversuch
    rl.recordFailure()
    expect(rl.isLocked()).toBe(true)
  })
})
