import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { toolTextResult } from '../shared.ts'

const DATUM_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export async function uploadPresseschau(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const inhalt = typeof args.inhalt === 'string' ? args.inhalt.trim() : ''
  if (!inhalt) return toolTextResult('Fehler: inhalt ist erforderlich.', true)

  // datum ist bewusst PFLICHT (kein "Standard: heute" mehr) - ein stiller
  // Default auf die Server-"heute" hatte dazu geführt, dass mehrere Uploads
  // am selben realen Kalendertag (z. B. beim Testen, oder wenn die
  // Presseschau sich inhaltlich auf ein anderes Datum bezieht) unbemerkt
  // denselben Datensatz überschrieben haben, statt als navigierbare,
  // separate Tage im Dashboard zu erscheinen (siehe docs/CHANGELOG.md).
  const datum = typeof args.datum === 'string' ? args.datum.trim() : ''
  if (!datum) return toolTextResult('Fehler: datum ist erforderlich (Format YYYY-MM-DD).', true)
  if (!DATUM_PATTERN.test(datum)) return toolTextResult('Fehler: datum muss im Format YYYY-MM-DD angegeben werden.', true)

  const titel = typeof args.titel === 'string' && args.titel.trim() ? args.titel.trim() : null
  const quelle = typeof args.quelle === 'string' && args.quelle.trim() ? args.quelle.trim() : null

  // Upsert auf (user_id, datum) - ein erneuter Upload für denselben Tag
  // korrigiert/ersetzt den bisherigen Eintrag statt ein Duplikat anzulegen.
  const { data: row, error } = await supabase
    .from('presseschauen')
    .upsert({ user_id: userId, datum, titel, quelle, inhalt }, { onConflict: 'user_id,datum' })
    .select('id')
    .single()
  if (error || !row) return toolTextResult(`Fehler beim Speichern der Presseschau: ${error?.message}`, true)

  return toolTextResult(
    `Presseschau für ${datum} wurde gespeichert (id: ${row.id}). Sichtbar im Dashboard, sobald "Presseschau" in den eigenen Einstellungen aktiviert ist.`,
  )
}
