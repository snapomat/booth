import { describe, it, expect } from 'vitest'
import { retry, withTimeout, TimeoutError, sleep } from './async'

describe('retry', () => {
  it('Erfolg beim ersten Versuch', async () => {
    let n = 0
    const r = await retry(async () => {
      n++
      return 'ok'
    }, { attempts: 3, delayMs: 1 })
    expect(r).toBe('ok')
    expect(n).toBe(1)
  })

  it('wiederholt bis zum Erfolg', async () => {
    let n = 0
    const r = await retry(async () => {
      n++
      if (n < 3) throw new Error('noch nicht')
      return n
    }, { attempts: 5, delayMs: 1 })
    expect(r).toBe(3)
    expect(n).toBe(3)
  })

  it('wirft nach allen Versuchen', async () => {
    let n = 0
    await expect(
      retry(async () => {
        n++
        throw new Error('boom')
      }, { attempts: 3, delayMs: 1 })
    ).rejects.toThrow('boom')
    expect(n).toBe(3)
  })

  it('ruft onRetry pro Fehlversuch', async () => {
    const attempts: number[] = []
    await retry(async () => {
      if (attempts.length < 2) throw new Error('e')
      return 1
    }, { attempts: 5, delayMs: 1, onRetry: (_e, a) => attempts.push(a) })
    expect(attempts).toEqual([1, 2])
  })
})

describe('withTimeout', () => {
  it('löst vor dem Timeout auf', async () => {
    expect(await withTimeout(Promise.resolve('ok'), 50)).toBe('ok')
  })

  it('wirft TimeoutError und ruft onTimeout', async () => {
    let killed = false
    await expect(
      withTimeout(sleep(1000), 10, () => {
        killed = true
      })
    ).rejects.toBeInstanceOf(TimeoutError)
    expect(killed).toBe(true)
  })
})
