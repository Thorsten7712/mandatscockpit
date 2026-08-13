import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { fileNameFromPath, formatDateTime, guessContentType, parseLimit, toolTextResult, truncate } from '../shared.ts'

interface NoteListRow {
  id: string
  session_id: string | null
  event_id: string | null
  todo_id: string | null
  antrag_id: string | null
  inhalt: string | null
  datei_url: string | null
  erstellt_am: string
  user_id: string
}

export async function listNotes(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const sessionId = typeof args.session_id === 'string' && args.session_id.trim() ? args.session_id.trim() : null
  const eventId = typeof args.event_id === 'string' && args.event_id.trim() ? args.event_id.trim() : null
  const todoId = typeof args.todo_id === 'string' && args.todo_id.trim() ? args.todo_id.trim() : null
  const limit = parseLimit(args.limit)

  const gesetzteFilter = [sessionId, eventId, todoId].filter(Boolean)
  if (gesetzteFilter.length > 1) {
    return toolTextResult('Fehler: bitte höchstens einen der Filter session_id, event_id, todo_id setzen.', true)
  }

  // Sichtbarkeit wie in der Web-UI: eigene Notizen (summaries_manage_own) plus
  // Notizen anderer auf ToDo-Karten, auf denen der Nutzer eine Platzierung hat
  // (summaries_select_via_todo_placement). Anträge bleiben außen vor, solange es
  // keine Antrags-Tools gibt.
  const { data: placements } = await supabase.from('todo_placements').select('todo_id').eq('user_id', userId)
  const placedTodoIds = (placements ?? []).map((p) => p.todo_id as string)

  const baseQuery = () => {
    let q = supabase
      .from('summaries')
      .select('id, session_id, event_id, todo_id, antrag_id, inhalt, datei_url, erstellt_am, user_id')
    if (sessionId) q = q.eq('session_id', sessionId)
    if (eventId) q = q.eq('event_id', eventId)
    if (todoId) q = q.eq('todo_id', todoId)
    return q.order('erstellt_am', { ascending: false }).limit(limit)
  }
  const [own, viaTodo] = await Promise.all([
    baseQuery().eq('user_id', userId),
    placedTodoIds.length > 0 ? baseQuery().in('todo_id', placedTodoIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (own.error) return toolTextResult(`Fehler beim Laden der Notizen: ${own.error.message}`, true)
  if (viaTodo.error) return toolTextResult(`Fehler beim Laden der Notizen: ${viaTodo.error.message}`, true)

  const byId = new Map<string, NoteListRow>()
  ;[...(own.data ?? []), ...(viaTodo.data ?? [])].forEach((n) => byId.set(n.id, n as NoteListRow))
  const rows = Array.from(byId.values())
    .sort((a, b) => b.erstellt_am.localeCompare(a.erstellt_am))
    .slice(0, limit)

  if (rows.length === 0) return toolTextResult('Keine Notizen/Dokumente gefunden.')

  // Titel der verknüpften Objekte in je einer Sammelabfrage nachladen.
  const idsOf = (key: 'session_id' | 'event_id' | 'todo_id') =>
    Array.from(new Set(rows.map((r) => r[key]).filter((v): v is string => Boolean(v))))
  const [sessions, events, todos] = await Promise.all([
    idsOf('session_id').length > 0
      ? supabase.from('sessions').select('id, titel').in('id', idsOf('session_id'))
      : Promise.resolve({ data: [] }),
    idsOf('event_id').length > 0
      ? supabase.from('events').select('id, titel').in('id', idsOf('event_id'))
      : Promise.resolve({ data: [] }),
    idsOf('todo_id').length > 0
      ? supabase.from('todos').select('id, titel').in('id', idsOf('todo_id'))
      : Promise.resolve({ data: [] }),
  ])
  const titelById = new Map<string, string>()
  ;[...(sessions.data ?? []), ...(events.data ?? []), ...(todos.data ?? [])].forEach((r) =>
    titelById.set(r.id as string, r.titel as string),
  )

  // Bei einem gesetzten Filter ist der Kontext eng - dann den vollen Text zeigen,
  // sonst kürzen, damit eine breite Liste die Antwort nicht sprengt.
  const maxLen = gesetzteFilter.length === 1 ? 4000 : 500

  const lines = rows.map((n) => {
    let ziel = 'ohne Zuordnung'
    if (n.session_id) ziel = `Sitzung "${titelById.get(n.session_id) ?? n.session_id}"`
    else if (n.event_id) ziel = `Termin "${titelById.get(n.event_id) ?? n.event_id}"`
    else if (n.todo_id) ziel = `ToDo "${titelById.get(n.todo_id) ?? n.todo_id}"`
    else if (n.antrag_id) ziel = 'Antrag'
    const teile: string[] = []
    if (n.inhalt) teile.push(truncate(n.inhalt, maxLen))
    if (n.datei_url) teile.push(`[Datei: ${fileNameFromPath(n.datei_url)}]`)
    if (n.user_id !== userId) teile.push('(von einer geteilten Karte)')
    return `- ${formatDateTime(n.erstellt_am)} · ${ziel}: ${teile.join(' ')}`
  })
  return toolTextResult(lines.join('\n\n'))
}

interface NoteTargetConfig {
  /** Name des Arguments, das die UUID des Ziels trägt (session_id/event_id/todo_id/antrag_id). */
  idArgName: string
  /** Tabelle des Ziels. */
  table: 'sessions' | 'events' | 'todos' | 'antraege'
  /** Spalte in summaries, die auf das Ziel zeigt. */
  idColumn: 'session_id' | 'event_id' | 'todo_id' | 'antrag_id'
  /** events/todos/antraege gehören einem Nutzer (RLS events_select_own/
   *  todos_select_own_or_placed/antraege_select_own_or_shared) - Service-Role-Client umgeht RLS,
   *  daher hier manuell auf user_id prüfen. sessions gehören dagegen keinem einzelnen Nutzer und
   *  werden nicht ownership-geprüft (Sichtbarkeit hängt an der Kalenderquelle, siehe
   *  sessions_select_visible_source - hier bewusst nicht nachgebildet, da eine Notiz am fremden
   *  Sitzungs-Datensatz nur im eigenen summaries-Bestand landet). */
  ownerScoped: boolean
  /** Zusätzlicher Zugriffsweg neben user_id = userId (Teilen), z. B. todo_placements für ToDos
   *  oder antrag_shares für Anträge - Tabelle hat eine Spalte namens idColumn mit der Ziel-id und
   *  eine Spalte user_id. */
  sharedVia?: { table: string; idColumn: string }
  /** Für Fehlermeldungen/Bestätigungstext, z. B. "Sitzung", "Termin", "ToDo", "Antrag". */
  label: string
}

async function createNote(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
  target: NoteTargetConfig,
) {
  const targetId = typeof args[target.idArgName] === 'string' ? (args[target.idArgName] as string).trim() : ''
  const inhalt = typeof args.inhalt === 'string' && args.inhalt.trim() ? args.inhalt.trim() : null
  const dateiname = typeof args.dateiname === 'string' ? args.dateiname.trim() : ''
  const dateiBase64 = typeof args.datei_base64 === 'string' ? args.datei_base64.trim() : ''
  // Alternative zu dateiname+datei_base64 für größere Dateien: ein per
  // start_file_upload/append_file_chunk/finish_file_upload bereits
  // hochgeladener Storage-Pfad (siehe tools/uploads.ts) - direkte
  // Base64-Übergabe scheitert bei größeren Dateien an der Zeichenlänge,
  // die der aufrufende MCP-Client in einem einzelnen Tool-Aufruf generieren
  // kann.
  const dateiPfad = typeof args.datei_pfad === 'string' ? args.datei_pfad.trim() : ''
  const hasFile = Boolean((dateiname && dateiBase64) || dateiPfad)

  if (!targetId) return toolTextResult(`Fehler: ${target.idArgName} ist erforderlich.`, true)
  if (!inhalt && !hasFile) {
    return toolTextResult('Fehler: entweder inhalt, dateiname+datei_base64 oder datei_pfad sind erforderlich.', true)
  }
  if ((dateiname && !dateiBase64) || (!dateiname && dateiBase64)) {
    return toolTextResult('Fehler: dateiname und datei_base64 müssen zusammen angegeben werden.', true)
  }
  if (dateiPfad && (dateiname || dateiBase64)) {
    return toolTextResult('Fehler: datei_pfad kann nicht zusammen mit dateiname/datei_base64 angegeben werden.', true)
  }
  if (dateiPfad && !dateiPfad.startsWith(`${userId}/`)) {
    return toolTextResult('Fehler: datei_pfad gehört nicht zu diesem Konto.', true)
  }

  // Immer dieselbe, konstante Spaltenliste abfragen (nicht abhängig von
  // ownerScoped) - sessions hat z. B. gar keine user_id-Spalte, und ein
  // laufzeitabhängiger Select-String verwirrt außerdem supabase-js' Typinferenz.
  const { data: targetRow, error: targetError } = await supabase
    .from(target.table)
    .select('id, titel')
    .eq('id', targetId)
    .maybeSingle()
  if (targetError) return toolTextResult(`Fehler beim Prüfen (${target.label}): ${targetError.message}`, true)
  if (!targetRow) return toolTextResult(`${target.label} mit id ${targetId} wurde nicht gefunden.`, true)

  if (target.ownerScoped) {
    const { data: ownerRow } = await supabase.from(target.table).select('user_id').eq('id', targetId).maybeSingle()
    let erlaubt = ownerRow?.user_id === userId
    if (!erlaubt && target.sharedVia) {
      const { data: shareRow } = await supabase
        .from(target.sharedVia.table)
        .select('id')
        .eq(target.sharedVia.idColumn, targetId)
        .eq('user_id', userId)
        .maybeSingle()
      erlaubt = Boolean(shareRow)
    }
    if (!erlaubt) {
      return toolTextResult(`${target.label} mit id ${targetId} gehört nicht zu diesem Konto (auch nicht per Teilen).`, true)
    }
  }

  let dateiUrl: string | null = null
  if (dateiPfad) {
    dateiUrl = dateiPfad
  } else if (dateiname && dateiBase64) {
    let bytes: Uint8Array
    try {
      bytes = Uint8Array.from(atob(dateiBase64), (c) => c.charCodeAt(0))
    } catch {
      return toolTextResult('Fehler: datei_base64 ist kein gültiges Base64.', true)
    }
    const path = `${userId}/${Date.now()}-${dateiname}`
    const { error: uploadError } = await supabase.storage
      .from('zusammenfassungen')
      .upload(path, bytes, { contentType: guessContentType(dateiname) })
    if (uploadError) return toolTextResult(`Fehler beim Hochladen der Datei: ${uploadError.message}`, true)
    dateiUrl = path
  }

  const { data: note, error } = await supabase
    .from('summaries')
    .insert({ user_id: userId, [target.idColumn]: targetId, inhalt, datei_url: dateiUrl })
    .select('id')
    .single()
  if (error || !note) return toolTextResult(`Fehler beim Speichern der Notiz: ${error?.message}`, true)

  const dateiLabel = dateiname || (dateiUrl ? fileNameFromPath(dateiUrl) : '')
  const parts = [inhalt ? 'Text' : null, dateiUrl ? `Datei "${dateiLabel}"` : null].filter(Boolean)
  return toolTextResult(
    `Notiz (${parts.join(' + ')}) zu ${target.label} "${targetRow.titel}" wurde gespeichert (id: ${note.id}).`,
  )
}

export function createSessionNote(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  return createNote(supabase, userId, args, {
    idArgName: 'session_id',
    table: 'sessions',
    idColumn: 'session_id',
    ownerScoped: false,
    label: 'Sitzung',
  })
}

export function createEventNote(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  return createNote(supabase, userId, args, {
    idArgName: 'event_id',
    table: 'events',
    idColumn: 'event_id',
    ownerScoped: true,
    label: 'Termin',
  })
}

export function createTodoNote(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  return createNote(supabase, userId, args, {
    idArgName: 'todo_id',
    table: 'todos',
    idColumn: 'todo_id',
    ownerScoped: true,
    sharedVia: { table: 'todo_placements', idColumn: 'todo_id' },
    label: 'ToDo',
  })
}

export function createAntragNote(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  return createNote(supabase, userId, args, {
    idArgName: 'antrag_id',
    table: 'antraege',
    idColumn: 'antrag_id',
    ownerScoped: true,
    sharedVia: { table: 'antrag_shares', idColumn: 'antrag_id' },
    label: 'Antrag',
  })
}
