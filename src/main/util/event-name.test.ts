import { describe, it, expect } from 'vitest'
import { normalizeEventName } from './event-name'

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
