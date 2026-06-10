import { describe, it, expect } from 'vitest'
import { hslToHex, accentFromPixels, DEFAULT_ACCENT } from './color'

describe('hslToHex', () => {
  it('reine Grundfarben', () => {
    expect(hslToHex(0, 1, 0.5)).toBe('#ff0000')
    expect(hslToHex(120, 1, 0.5)).toBe('#00ff00')
    expect(hslToHex(240, 1, 0.5)).toBe('#0000ff')
  })
  it('liefert immer ein gültiges Hex', () => {
    expect(hslToHex(200, 0.7, 0.58)).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('accentFromPixels', () => {
  it('graustufiges Bild → Standard-Akzent', () => {
    const grey = Buffer.alloc(300, 128) // alle Kanäle gleich
    expect(accentFromPixels(grey, 3)).toBe(DEFAULT_ACCENT)
  })

  it('rotes Bild → rötlicher, gültiger Akzent', () => {
    const red = Buffer.from(Array.from({ length: 100 }, () => [255, 20, 20]).flat())
    const hex = accentFromPixels(red, 3)
    expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
  })

  it('respektiert die Kanalanzahl (RGBA)', () => {
    const rgba = Buffer.from(Array.from({ length: 50 }, () => [20, 20, 255, 255]).flat())
    const hex = accentFromPixels(rgba, 4)
    const b = parseInt(hex.slice(5, 7), 16)
    const r = parseInt(hex.slice(1, 3), 16)
    expect(b).toBeGreaterThan(r) // blau dominiert
  })
})
