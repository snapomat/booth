import { z } from 'zod'
import { retry } from './util/async'
import { createLogger } from './util/logger'

const log = createLogger('ai-portraits')

// OpenAI Bild-Bearbeitung (gpt-image-1): Foto + Stil-Prompt → stilisierte Variante.
const API_URL = 'https://api.openai.com/v1/images/edits'
const MODEL = 'gpt-image-1'
// Landschaft 3:2-nah – passt zum späteren Druckformat (composePrint deckt auf 1800×1200).
const SIZE = '1536x1024'
const AI_TIMEOUT_MS = 90_000

const responseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string() })).min(1)
})

/** True, wenn ein API-Key hinterlegt ist (Key kommt aus der Umgebung, nie aus Settings). */
export function isAiConfigured(): boolean {
  return !!process.env['OPENAI_API_KEY']
}

/**
 * Stilisiert ein Foto über die OpenAI-Bild-API und liefert den JPEG/PNG-Buffer
 * der Variante. Mit Timeout + einem Retry; wirft mit klarer Meldung bei Fehlern.
 */
export async function stylizePhoto(original: Buffer, prompt: string): Promise<Buffer> {
  const apiKey = process.env['OPENAI_API_KEY']
  if (!apiKey) throw new Error('OPENAI_API_KEY ist nicht gesetzt.')
  if (!prompt.trim()) throw new Error('Kein AI-Stil-Prompt konfiguriert.')

  return retry(
    async () => {
      const form = new FormData()
      form.append('model', MODEL)
      form.append('image', new Blob([new Uint8Array(original)], { type: 'image/jpeg' }), 'photo.jpg')
      form.append('prompt', prompt)
      form.append('size', SIZE)
      form.append('n', '1')

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(AI_TIMEOUT_MS)
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`OpenAI-Fehler ${res.status}: ${detail.slice(0, 300)}`)
      }
      const { data } = responseSchema.parse(await res.json())
      return Buffer.from(data[0].b64_json, 'base64')
    },
    {
      attempts: 2,
      delayMs: 1500,
      onRetry: (err, attempt, next) =>
        log.warn(`AI-Stilisierung Versuch ${attempt} fehlgeschlagen, Retry in ${next}ms`, err)
    }
  )
}
