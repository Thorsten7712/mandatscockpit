import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { formatDateTime, parseLimit, parseZeitraum, sortAscending, toolTextResult, zeitraumLabel } from '../shared.ts'

interface SessionListRow {
  id: string
  titel: string
  gremium: string | null
  datum: string
  ort: string | null
  status: string
}

export async function listSessions(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const zeitraum = parseZeitraum(args.zeitraum)
  const gremium = typeof args.gremium === 'string' ? args.gremium.trim() : ''
  const nurMeineGremien = args.nur_meine_gremien === true
  const limit = parseLimit(args.limit)
  const jetzt = new Date().toISOString()

  // supabase läuft hier mit dem Service-Role-Key (siehe index.ts-Kopfkommentar),
  // RLS greift also nicht automatisch - die Sichtbarkeitsregel aus
  // "sessions_select_visible_source"/"calendar_sources_select_shared_or_own"
  // (supabase/migrations/0018_calendar_sources_privat.sql) muss hier manuell
  // nachgebildet werden, sonst würde dieses Tool private Kalenderquellen
  // anderer Mitglieder mit auflisten.
  const { data: visibleSources } = await supabase
    .from('calendar_sources')
    .select('id, art')
    .or(`verwaltet_von.is.null,verwaltet_von.eq.${userId}`)
  const visibleSourceIds = (visibleSources ?? []).map((s) => s.id as string)
  const terminSourceIds = (visibleSources ?? []).filter((s) => s.art === 'termin').map((s) => s.id as string)

  const baseQuery = () => {
    let q = supabase.from('sessions').select('id, titel, gremium, datum, ort, status')
    if (zeitraum === 'zukunft') q = q.gte('datum', jetzt)
    else if (zeitraum === 'vergangenheit') q = q.lt('datum', jetzt)
    q =
      visibleSourceIds.length > 0
        ? q.or(`source_id.is.null,source_id.in.(${visibleSourceIds.join(',')})`)
        : q.is('source_id', null)
    if (gremium) q = q.ilike('gremium', `%${gremium}%`)
    return q.order('datum', { ascending: sortAscending(zeitraum) }).limit(limit)
  }

  let rows: SessionListRow[]
  if (nurMeineGremien) {
    // Gleiche Vereinigungs-Semantik wie CalendarView.tsx/Archiv.tsx: Sitzungen der
    // eigenen Gremien PLUS alles aus reinen Terminkalender-Quellen (art='termin',
    // dort gibt es keine Gremien-Zuordnung). Bewusst zwei .in()-Abfragen statt
    // eines rohen .or()-Strings, weil Gremiennamen Kommas/Klammern enthalten und
    // damit das PostgREST-Filterformat brechen würden (siehe CLAUDE.md).
    const { data: gremienRows } = await supabase.from('user_gremien').select('gremium').eq('user_id', userId)
    const meineGremien = (gremienRows ?? []).map((g) => g.gremium as string)
    if (meineGremien.length === 0 && terminSourceIds.length === 0) {
      return toolTextResult(
        'Keine Gremien ausgewählt - unter Einstellungen -> Meine Gremien festlegen oder nur_meine_gremien weglassen.',
      )
    }
    const [byGremium, byTerminSource] = await Promise.all([
      meineGremien.length > 0 ? baseQuery().in('gremium', meineGremien) : Promise.resolve({ data: [], error: null }),
      terminSourceIds.length > 0
        ? baseQuery().in('source_id', terminSourceIds)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (byGremium.error) return toolTextResult(`Fehler beim Laden der Sitzungen: ${byGremium.error.message}`, true)
    if (byTerminSource.error) {
      return toolTextResult(`Fehler beim Laden der Sitzungen: ${byTerminSource.error.message}`, true)
    }
    const byId = new Map<string, SessionListRow>()
    ;[...(byGremium.data ?? []), ...(byTerminSource.data ?? [])].forEach((s) => byId.set(s.id, s as SessionListRow))
    rows = Array.from(byId.values())
      .sort((a, b) => (sortAscending(zeitraum) ? a.datum.localeCompare(b.datum) : b.datum.localeCompare(a.datum)))
      .slice(0, limit)
  } else {
    const { data, error } = await baseQuery()
    if (error) return toolTextResult(`Fehler beim Laden der Sitzungen: ${error.message}`, true)
    rows = (data ?? []) as SessionListRow[]
  }

  if (rows.length === 0) {
    const label = zeitraumLabel(zeitraum)
    return toolTextResult(
      gremium
        ? `Keine ${label} Sitzungen für "${gremium}" gefunden.`.replace('  ', ' ')
        : `Keine ${label} Sitzungen gefunden.`.replace('  ', ' '),
    )
  }

  const lines = rows.map((s) => {
    const status = s.status === 'abgesagt' ? ' [ABGESAGT]' : ''
    const ort = s.ort ? `, ${s.ort}` : ''
    return `- ${s.titel} (${s.gremium ?? 'ohne Gremium'}) am ${formatDateTime(s.datum)}${ort} — id: ${s.id}${status}`
  })
  return toolTextResult(lines.join('\n'))
}
