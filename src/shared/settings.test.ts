import { describe, it, expect } from 'vitest'
import { settingsSchema, defaultSettings } from './types'

describe('settingsSchema', () => {
  it('Defaults sind gültig', () => {
    expect(() => settingsSchema.parse(defaultSettings)).not.toThrow()
  })

  it('unbekannte Felder werden entfernt', () => {
    const parsed = settingsSchema.parse({ ...defaultSettings, bogus: 123 })
    expect('bogus' in parsed).toBe(false)
  })

  it('Werte außerhalb des Bereichs werden abgelehnt', () => {
    expect(() => settingsSchema.parse({ ...defaultSettings, reviewTimeoutSeconds: 9999 })).toThrow()
    expect(() => settingsSchema.parse({ ...defaultSettings, countdownSeconds: 0 })).toThrow()
    expect(() => settingsSchema.parse({ ...defaultSettings, backgroundOpacity: 2 })).toThrow()
  })

  it('partielles Parsen für gespeicherte Teil-Updates', () => {
    const parsed = settingsSchema.partial().parse({ countdownSeconds: 5 })
    expect(parsed.countdownSeconds).toBe(5)
  })

  it('alte Config ohne neue Felder + Defaults bleibt gültig', () => {
    // simuliert Migration: gespeicherte Datei ohne accentColor/backgroundDefault
    const old = { countdownSeconds: 4, printsPerCapture: 2 }
    expect(() => settingsSchema.parse({ ...defaultSettings, ...old })).not.toThrow()
  })
})
