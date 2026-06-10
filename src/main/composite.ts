import sharp from 'sharp'

// Native sharp-Speicher begrenzen (Dauerläufer-Box: kein wachsender Cache).
sharp.cache(false)
sharp.concurrency(1)

// Druckformat 6×4 Zoll bei 300 dpi (Postkarte, passt zur Canon SELPHY CP1500).
const PRINT_WIDTH = 1800
const PRINT_HEIGHT = 1200

// Bildschirm-Vorschau für den 1024×768-Kiosk (4:3). Das Landscape-Foto (3:2)
// wird durch die Breite begrenzt → 1024 px reichen, mehr zeigt der Schirm nie.
const PREVIEW_WIDTH = 1024

export interface ComposeResult {
  /** Druckfertiger JPEG-Buffer (volle Auflösung). */
  jpeg: Buffer
  /** Data-URL der bildschirmgerechten Vorschau (1024 px breit). */
  dataUrl: string
}

/** Bringt das Foto auf das Druckformat und erzeugt eine bildschirmgerechte Vorschau. */
export async function composePrint(original: Buffer): Promise<ComposeResult> {
  const jpeg = await sharp(original)
    .resize(PRINT_WIDTH, PRINT_HEIGHT, { fit: 'cover' })
    .jpeg({ quality: 92 })
    .toBuffer()
  const preview = await sharp(jpeg).resize({ width: PREVIEW_WIDTH }).jpeg({ quality: 82 }).toBuffer()
  return { jpeg, dataUrl: `data:image/jpeg;base64,${preview.toString('base64')}` }
}
