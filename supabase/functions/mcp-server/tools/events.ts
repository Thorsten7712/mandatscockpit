import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { formatDateTime, parseLimit, parseZeitraum, sortAscending, toolTextResult, zeitraumLabel } from '../shared.ts'

export async function createEvent(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const titel = typeof args.titel === 'string' ? args.titel.trim() : ''
  const start = typeof args.start === 'string' ? args.start : ''
  if (!titel || !start || Number.isNaN(new Date(start).getTime())) {
    return toolTextResult('Fehler: titel und ein gültiges start-Datum (ISO-8601) sind erforderlich.', true)
  }
  const ende = typeof args.ende === 'string' && args.ende ? args.ende : null
  if (ende && Number.isNaN(new Date(ende).getTime())) {
    return toolTextResult('Fehler: ende ist kein gültiges ISO-8601-Datum.', true)
  }

  const { data: event, error } = await supabase
    .from('events')
    .insert({ user_id: userId, titel, start, ende, herkunft: 'privat', erstellt_von: userId })
    .select('id')
    .single()
  if (error || !event) return toolTextResult(`Fehler beim Anlegen des Termins: ${error?.message}`, true)

  return toolTextResult(`Termin "${titel}" am ${formatDateTime(start)} wurde angelegt (id: ${event.id}).`)
}

export async function listEvents(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const zeitraum = parseZeitraum(args.zeitraum)
  const limit = parseLimit(args.limit)
  const jetzt = new Date().toISOString()

  // events gehören immer genau einem Nutzer (RLS events_select_own) - der
  // Service-Role-Client umgeht RLS, daher hier manuell auf user_id filtern.
  let query = supabase.from('events').select('id, titel, start, ende, ort, status, herkunft').eq('user_id', userId)
  if (zeitraum === 'zukunft') query = query.gte('start', jetzt)
  else if (zeitraum === 'vergangenheit') query = query.lt('start', jetzt)

  const { data, error } = await query.order('start', { ascending: sortAscending(zeitraum) }).limit(limit)
  if (error) return toolTextResult(`Fehler beim Laden der Termine: ${error.message}`, true)
  if (!data || data.length === 0) {
    return toolTextResult(`Keine ${zeitraumLabel(zeitraum)} Termine gefunden.`.replace('  ', ' '))
  }

  const lines = data.map((e) => {
    const status = e.status === 'abgesagt' ? ' [ABGESAGT]' : ''
    const ort = e.ort ? `, ${e.ort}` : ''
    const herkunft = e.herkunft === 'fraktionsbuero' ? ' (vom Fraktionsbüro eingetragen)' : ''
    return `- ${e.titel} am ${formatDateTime(e.start)}${ort}${herkunft} — id: ${e.id}${status}`
  })
  return toolTextResult(lines.join('\n'))
}
