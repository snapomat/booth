import { z } from 'zod'
import { retry } from './util/async'
import { createLogger } from './util/logger'

const log = createLogger('ai-portraits')

// OpenAI Bild-Bearbeitung (z. B. gpt-image-1): Foto + Stil-Prompt → Variante.
const API_URL = 'https://api.openai.com/v1/images/edits'
// Landschaft 3:2-nah – passt zum späteren Druckformat (composePrint deckt auf 1800×1200).
const SIZE = '1536x1024'
const AI_TIMEOUT_MS = 90_000

const responseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string() })).min(1)
})

export interface StylizeOptions {
  apiKey: string
  model: string
  prompt: string
}

/** Effektiver API-Key: erst aus den Settings, sonst aus der Umgebung (Dev). */
export function resolveApiKey(settingsKey: string): string {
  return settingsKey.trim() || process.env['OPENAI_API_KEY'] || ''
}

/**
 * Stilisiert ein Foto über die OpenAI-Bild-API und liefert den Bild-Buffer der
 * Variante. Mit Timeout + einem Retry; wirft mit klarer Meldung bei Fehlern.
 */
export async function stylizePhoto(original: Buffer, opts: StylizeOptions): Promise<Buffer> {
  const { apiKey, model, prompt } = opts
  if (!apiKey) throw new Error('Kein OpenAI-API-Key hinterlegt.')
  if (!prompt.trim()) throw new Error('Kein AI-Stil-Prompt konfiguriert.')

  return retry(
    async () => {
      const form = new FormData()
      form.append('model', model)
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
