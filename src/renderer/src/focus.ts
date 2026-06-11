/**
 * Schätzt die Bildschärfe als Varianz des Laplace-Operators auf der Luma.
 * Höher = schärfer (mehr Kantenenergie). Erwartet RGBA-Pixeldaten (z. B. aus
 * `CanvasRenderingContext2D.getImageData`). Reine Funktion → testbar.
 */
export function focusScore(rgba: Uint8ClampedArray | number[], width: number, height: number): number {
  if (width < 3 || height < 3) return 0
  // RGBA → Luma (Graustufen).
  const luma = new Float64Array(width * height)
  for (let i = 0, p = 0; p < width * height; i += 4, p++) {
    luma[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
  }
  // Laplace (4er-Nachbarschaft) über das Innere; Mittel + Varianz der Antwort.
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      const lap =
        4 * luma[idx] - luma[idx - 1] - luma[idx + 1] - luma[idx - width] - luma[idx + width]
      sum += lap
      sumSq += lap * lap
      n++
    }
  }
  if (n === 0) return 0
  const mean = sum / n
  return sumSq / n - mean * mean
}
