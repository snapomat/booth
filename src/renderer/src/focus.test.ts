import { describe, it, expect } from 'vitest'
import { focusScore } from './focus'

/** Baut RGBA-Daten aus einer Graustufen-Matrix (0–255). */
function rgbaFrom(gray: number[][]): { data: number[]; w: number; h: number } {
  const h = gray.length
  const w = gray[0].length
  const data: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = gray[y][x]
      data.push(v, v, v, 255)
    }
  }
  return { data, w, h }
}

describe('focusScore', () => {
  it('ist 0 bei gleichförmiger Fläche (keine Kanten)', () => {
    const flat = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 128))
    const { data, w, h } = rgbaFrom(flat)
    expect(focusScore(data, w, h)).toBe(0)
  })

  it('ist höher bei einer scharfen Kante als bei einer weichen', () => {
    const size = 8
    // Harte Kante: linke Hälfte schwarz, rechte weiß.
    const hard = Array.from({ length: size }, () =>
      Array.from({ length: size }, (_, x) => (x < size / 2 ? 0 : 255))
    )
    // Weicher Verlauf über die Breite.
    const soft = Array.from({ length: size }, () =>
      Array.from({ length: size }, (_, x) => Math.round((x / (size - 1)) * 255))
    )
    const a = rgbaFrom(hard)
    const b = rgbaFrom(soft)
    expect(focusScore(a.data, a.w, a.h)).toBeGreaterThan(focusScore(b.data, b.w, b.h))
  })

  it('liefert 0 für zu kleine Bilder', () => {
    expect(focusScore([0, 0, 0, 255], 1, 1)).toBe(0)
  })
})
