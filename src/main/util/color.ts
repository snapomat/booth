/** Standard-Akzent (Messing-Gold), Fallback für graustufige Bilder. */
export const DEFAULT_ACCENT = '#e8a23c'

/** HSL → Hex (h in Grad, s/l in 0–1). */
export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x]
  const hex = (v: number): string =>
    Math.max(0, Math.min(255, Math.round((v + m) * 255)))
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * Leitet aus rohen RGB-Pixeln eine satte, mittelhelle Akzentfarbe ab. Statt der
 * (oft neutralen) Dominanten wird der nach Sättigung gewichtete Durchschnitts-
 * Farbton der bunten Bildbereiche genommen – dunkler Text bleibt lesbar.
 */
export function accentFromPixels(data: Uint8Array | Buffer, channels = 3): string {
  let sumSin = 0
  let sumCos = 0
  let wSat = 0
  let wTot = 0
  for (let i = 0; i + 2 < data.length; i += channels) {
    const r = data[i] / 255
    const g = data[i + 1] / 255
    const b = data[i + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const d = max - min
    if (d === 0) continue
    const sat = d / max
    const w = sat * max // bunte, nicht zu dunkle Pixel bevorzugen
    let h = max === r ? (((g - b) / d) % 6 + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
    const rad = (h * Math.PI) / 180
    sumSin += Math.sin(rad) * w
    sumCos += Math.cos(rad) * w
    wSat += sat * w
    wTot += w
  }
  if (wTot < 1e-3) return DEFAULT_ACCENT
  let hue = (Math.atan2(sumSin, sumCos) * 180) / Math.PI
  if (hue < 0) hue += 360
  const sat = Math.min(0.85, Math.max(0.55, wSat / wTot))
  return hslToHex(hue, sat, 0.58)
}
