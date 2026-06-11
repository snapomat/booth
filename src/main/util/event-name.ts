/** Bereinigt/validiert einen Event-Namen (leer/zu lang abfangen). */
export function normalizeEventName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name.length === 0) throw new Error('Event-Name darf nicht leer sein.')
  if (name.length > 60) throw new Error('Event-Name ist zu lang (max. 60 Zeichen).')
  return name
}
