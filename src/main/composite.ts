import sharp from 'sharp'

// Druckformat 6×4 Zoll bei 300 dpi (Postkarte, passt zur Canon SELPHY CP1500).
const PRINT_WIDTH = 1800
const PRINT_HEIGHT = 1200

export interface ComposeResult {
  /** Druckfertiger JPEG-Buffer. */
  jpeg: Buffer
  /** Data-URL für die Vorschau im Renderer. */
  dataUrl: string
}

/** Bringt das aufgenommene Foto auf das Druckformat. */
export async function composePrint(original: Buffer): Promise<ComposeResult> {
  const jpeg = await sharp(original)
    .resize(PRINT_WIDTH, PRINT_HEIGHT, { fit: 'cover' })
    .jpeg({ quality: 92 })
    .toBuffer()
  return { jpeg, dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}` }
}
