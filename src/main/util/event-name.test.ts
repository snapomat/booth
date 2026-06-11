import { describe, it, expect } from 'vitest'
import { normalizeEventName, slugifyEventName } from './event-name'

describe('normalizeEventName', () => {
  it('trimmt und normalisiert Whitespace', () => {
    expect(normalizeEventName('  Hochzeit   Müller  ')).toBe('Hochzeit Müller')
  })

  it('lehnt leere Namen ab', () => {
    expect(() => normalizeEventName('   ')).toThrow()
    expect(() => normalizeEventName('')).toThrow()
  })

  it('lehnt zu lange Namen ab', () => {
    expect(() => normalizeEventName('x'.repeat(61))).toThrow()
    expect(normalizeEventName('x'.repeat(60))).toHaveLength(60)
  })
})

describe('slugifyEventName', () => {
  it('macht aus Namen einen ordner-tauglichen Slug', () => {
    expect(slugifyEventName('Hochzeit Müller')).toBe('hochzeit-mueller')
    expect(slugifyEventName('Sommerfest 2026!')).toBe('sommerfest-2026')
    expect(slugifyEventName('  Straße  ')).toBe('strasse')
  })

  it('liefert nie einen leeren Slug', () => {
    expect(slugifyEventName('—')).toBe('event')
    expect(slugifyEventName('')).toBe('event')
  })

  it('erfüllt das folderPath-Muster der Gallery', () => {
    const pattern = /^[a-z0-9][a-z0-9-]{0,63}$/
    for (const n of ['Hochzeit Müller', 'A', 'Tom & Jerry', '2026 Gala'])
      expect(pattern.test(slugifyEventName(n))).toBe(true)
  })
})
