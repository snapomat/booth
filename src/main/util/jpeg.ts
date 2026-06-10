const JPEG_SOI = Buffer.from([0xff, 0xd8])
const JPEG_EOI = Buffer.from([0xff, 0xd9])

/** Begrenzt den internen Puffer, falls nie ein vollständiger Frame kommt. */
const MAX_BUFFER = 16 * 1024 * 1024

/**
 * Zerlegt einen kontinuierlichen MJPEG-Strom (z. B. von `gphoto2 --capture-movie
 * --stdout`) in einzelne JPEG-Frames. Stateful: Chunks reinschieben, vollständige
 * Frames kommen zurück.
 */
export class JpegFrameSplitter {
  private buffer = Buffer.alloc(0)

  /** Schiebt einen Chunk hinein und liefert alle dadurch vollständigen Frames. */
  push(chunk: Buffer): Buffer[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const frames: Buffer[] = []
    for (;;) {
      const start = this.buffer.indexOf(JPEG_SOI)
      if (start < 0) {
        // Kein Frame-Start in Sicht – Puffer nicht unbegrenzt wachsen lassen.
        if (this.buffer.length > MAX_BUFFER) this.buffer = Buffer.alloc(0)
        break
      }
      const end = this.buffer.indexOf(JPEG_EOI, start + 2)
      if (end < 0) {
        // Frame noch unvollständig: führenden Müll verwerfen, Rest behalten.
        if (start > 0) this.buffer = this.buffer.subarray(start)
        if (this.buffer.length > MAX_BUFFER) this.buffer = Buffer.alloc(0)
        break
      }
      frames.push(this.buffer.subarray(start, end + 2))
      this.buffer = this.buffer.subarray(end + 2)
    }
    return frames
  }

  /** Setzt den Puffer zurück (z. B. beim Neustart des Liveviews). */
  reset(): void {
    this.buffer = Buffer.alloc(0)
  }
}
