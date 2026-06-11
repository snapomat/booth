/** Bereinigt/validiert einen Event-Namen (leer/zu lang abfangen). */
export function normalizeEventName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name.length === 0) throw new Error('Event-Name darf nicht leer sein.')
  if (name.length > 60) throw new Error('Event-Name ist zu lang (max. 60 Zeichen).')
  return name
}

/**
 * Erzeugt aus einem Event-Namen einen ordner-/URL-tauglichen Slug
 * (Kleinbuchstaben, a–z/0–9/-, Umlaute transliteriert). Dient als lokaler
 * Ordnername und als Galerie-`folderPath`. Nie leer (Fallback „event").
 */
export function slugifyEventName(name: string): string {
  const slug = name
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // übrige diakritische Zeichen entfernen
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  return slug || 'event'
}
