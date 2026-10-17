import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { formatDate, parseLimit, toolTextResult } from '../shared.ts'

// Feste Board-Spalten seit 0060 - frei konfigurierbar waren sie vorher. Die
// Datenbank lässt keine anderen Namen mehr zu (Constraint todo_columns_feste_spalten).
const SPALTEN = ['Neu', 'Geplant', 'Ergebnis erstellt', 'Fertig']

/** Sucht eine der vier festen Spalten des Nutzers (ohne Groß-/Kleinschreibung)
 *  oder liefert einen Fehlertext. */
async function festeSpalte(
  supabase: SupabaseClient,
  userId: string,
  name: string,
): Promise<{ id: string; titel: string } | string> {
  const gesucht = SPALTEN.find((s) => s.toLowerCase() === name.trim().toLowerCase())
  if (!gesucht) return `Fehler: Spalte "${name}" gibt es nicht. Feste Spalten: ${SPALTEN.join(', ')}.`
  const { data, error } = await supabase
    .from('todo_columns')
    .select('id, titel')
    .eq('user_id', userId)
    .eq('titel', gesucht)
    .maybeSingle()
  if (error) return `Fehler beim Laden der Spalten: ${error.message}`
  if (!data) return `Fehler: Spalte "${gesucht}" fehlt auf deinem Board.`
  return data
}

export async function createTodo(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const titel = typeof args.titel === 'string' ? args.titel.trim() : ''
  const spalte = typeof args.spalte === 'string' ? args.spalte.trim() : ''
  if (!titel || !spalte) {
    return toolTextResult('Fehler: titel und spalte sind erforderlich.', true)
  }
  const faelligAm = typeof args.faellig_am === 'string' && args.faellig_am ? args.faellig_am : null
  const sessionId = typeof args.session_id === 'string' && args.session_id ? args.session_id : null

  const column = await festeSpalte(supabase, userId, spalte)
  if (typeof column === 'string') return toolTextResult(column, true)

  // Board-Platzierung (Spalte/Position) lebt seit dem Erledigt/Teilen-Ausbau
  // in einer eigenen todo_placements-Zeile statt direkt auf todos, damit eine
  // Karte auf mehreren Boards unterschiedlich einsortiert sein kann (siehe
  // 0021_todo_erledigt_sharing.sql). Teilen selbst bleibt über MCP nicht
  // möglich, nur die eigene Platzierung wird hier angelegt.
  const { data: last } = await supabase
    .from('todo_placements')
    .select('position')
    .eq('column_id', column.id)
    .order('position', { ascending: false })
    .limit(1)
  const position = last && last.length > 0 ? last[0].position + 1 : 0

  const { data: todo, error: todoError } = await supabase
    .from('todos')
    .insert({
      user_id: userId,
      titel,
      faellig_am: faelligAm,
      session_id: sessionId,
    })
    .select('id')
    .single()
  if (todoError || !todo) return toolTextResult(`Fehler beim Anlegen des ToDos: ${todoError?.message}`, true)

  const { error: placementError } = await supabase
    .from('todo_placements')
    .insert({ todo_id: todo.id, user_id: userId, column_id: column.id, position })
  if (placementError) {
    return toolTextResult(`ToDo angelegt, aber Platzierung auf dem Board fehlgeschlagen: ${placementError.message}`, true)
  }

  return toolTextResult(`ToDo "${titel}" wurde in Spalte "${column.titel}" angelegt (id: ${todo.id}).`)
}

interface TodoListRow {
  id: string
  titel: string
  faellig_am: string | null
  zustaendig_user_id: string | null
  erledigt: boolean
  erledigt_am: string | null
  session_id: string | null
  user_id: string
}

export async function listTodos(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const status = args.status === 'erledigt' || args.status === 'alle' ? args.status : 'offen'
  const spalte = typeof args.spalte === 'string' ? args.spalte.trim().toLowerCase() : ''
  const sessionIdFilter = typeof args.session_id === 'string' && args.session_id.trim() ? args.session_id.trim() : ''
  const limit = parseLimit(args.limit)

  // Die Platzierungen des Nutzers liefern beides: die Menge der für ihn sichtbaren
  // Karten (eigene UND mit ihm geteilte, vgl. todos_select_own_or_placed - der
  // Service-Role-Client umgeht RLS) und die Board-Spalte je Karte.
  const { data: placements } = await supabase
    .from('todo_placements')
    .select('todo_id, column_id')
    .eq('user_id', userId)
  const columnIdByTodo = new Map((placements ?? []).map((p) => [p.todo_id as string, p.column_id as string]))
  const placedTodoIds = (placements ?? []).map((p) => p.todo_id as string)

  const { data: columns } = await supabase.from('todo_columns').select('id, titel').eq('user_id', userId)
  const columnTitleById = new Map((columns ?? []).map((c) => [c.id as string, c.titel as string]))

  const baseQuery = () => {
    let q = supabase.from('todos').select('id, titel, faellig_am, zustaendig_user_id, erledigt, erledigt_am, session_id, user_id')
    if (status === 'offen') q = q.eq('erledigt', false)
    else if (status === 'erledigt') q = q.eq('erledigt', true)
    if (sessionIdFilter) q = q.eq('session_id', sessionIdFilter)
    return q
  }
  const [own, placed] = await Promise.all([
    baseQuery().eq('user_id', userId),
    placedTodoIds.length > 0 ? baseQuery().in('id', placedTodoIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (own.error) return toolTextResult(`Fehler beim Laden der ToDos: ${own.error.message}`, true)
  if (placed.error) return toolTextResult(`Fehler beim Laden der ToDos: ${placed.error.message}`, true)

  const byId = new Map<string, TodoListRow>()
  ;[...(own.data ?? []), ...(placed.data ?? [])].forEach((t) => byId.set(t.id, t as TodoListRow))
  let rows = Array.from(byId.values())

  if (spalte) {
    rows = rows.filter((t) => {
      const titel = columnTitleById.get(columnIdByTodo.get(t.id) ?? '')
      return titel ? titel.toLowerCase().includes(spalte) : false
    })
  }

  rows.sort((a, b) =>
    status === 'erledigt'
      ? (b.erledigt_am ?? '').localeCompare(a.erledigt_am ?? '')
      : // Karten ohne Fälligkeit ans Ende statt an den Anfang sortieren.
        (a.faellig_am ?? '9999-12-31').localeCompare(b.faellig_am ?? '9999-12-31'),
  )
  rows = rows.slice(0, limit)

  if (rows.length === 0) {
    const was = status === 'erledigt' ? 'erledigten' : status === 'alle' ? '' : 'offenen'
    return toolTextResult(
      (spalte ? `Keine ${was} ToDos in einer Spalte mit "${spalte}" gefunden.` : `Keine ${was} ToDos gefunden.`)
        .replace('  ', ' '),
    )
  }

  const sessionIds = Array.from(new Set(rows.map((t) => t.session_id).filter((v): v is string => Boolean(v))))
  const sessionTitelById = new Map<string, string>()
  if (sessionIds.length > 0) {
    const { data: sessionRows } = await supabase.from('sessions').select('id, titel').in('id', sessionIds)
    for (const s of sessionRows ?? []) sessionTitelById.set(s.id as string, s.titel as string)
  }

  // Verknüpfte Dokumente (n:m über todo_dokumente, siehe 0037_todo_dokumente.sql) -
  // je Karte eine Liste von Dokumenttiteln, gleiches Batch-Lookup-Muster wie sessionTitelById.
  const rowIds = rows.map((t) => t.id)
  const { data: linkRows } = await supabase.from('todo_dokumente').select('todo_id, dokument_id').in('todo_id', rowIds)
  const dokumentIdsByTodo = new Map<string, string[]>()
  for (const l of linkRows ?? []) {
    const list = dokumentIdsByTodo.get(l.todo_id as string) ?? []
    list.push(l.dokument_id as string)
    dokumentIdsByTodo.set(l.todo_id as string, list)
  }
  const allDokumentIds = Array.from(new Set((linkRows ?? []).map((l) => l.dokument_id as string)))
  const dokumentTitelById = new Map<string, string>()
  if (allDokumentIds.length > 0) {
    const { data: dokRows } = await supabase.from('dokumente').select('id, titel').in('id', allDokumentIds)
    for (const d of dokRows ?? []) dokumentTitelById.set(d.id as string, d.titel as string)
  }

  const zustaendigIds = Array.from(new Set(rows.map((t) => t.zustaendig_user_id).filter((v): v is string => Boolean(v))))
  const nameById = new Map<string, string>()
  if (zustaendigIds.length > 0) {
    const { data: profs } = await supabase.from('profiles').select('id, name').in('id', zustaendigIds)
    for (const p of profs ?? []) nameById.set(p.id as string, p.name as string)
  }

  const lines = rows.map((t) => {
    const box = t.erledigt ? '[x]' : '[ ]'
    const details: string[] = []
    if (t.erledigt && t.erledigt_am) details.push(`erledigt am ${formatDate(t.erledigt_am.slice(0, 10))}`)
    else if (t.faellig_am) details.push(`fällig ${formatDate(t.faellig_am)}`)
    const spaltenTitel = columnTitleById.get(columnIdByTodo.get(t.id) ?? '')
    if (spaltenTitel) details.push(`Spalte: ${spaltenTitel}`)
    if (t.zustaendig_user_id) {
      details.push(t.zustaendig_user_id === userId ? 'zuständig: ich' : `zuständig: ${nameById.get(t.zustaendig_user_id) ?? 'unbekannt'}`)
    }
    if (t.session_id) details.push(`Sitzung: ${sessionTitelById.get(t.session_id) ?? t.session_id}`)
    const dokTitel = (dokumentIdsByTodo.get(t.id) ?? []).map((did) => dokumentTitelById.get(did) ?? did)
    if (dokTitel.length > 0) details.push(`Dokumente: ${dokTitel.join(', ')}`)
    if (t.user_id !== userId) details.push('geteilt')
    const suffix = details.length > 0 ? ` — ${details.join(' · ')}` : ''
    return `- ${box} ${t.titel}${suffix} — id: ${t.id}`
  })
  return toolTextResult(lines.join('\n'))
}

/** Prüft, ob eine ToDo-Karte dem Nutzer gehört oder mit ihm geteilt ist (RLS
 *  todos_update_own_or_placed - Service-Role-Client umgeht RLS, daher hier manuell). */
export async function todoIstZugreifbar(supabase: SupabaseClient, userId: string, todoId: string): Promise<boolean> {
  const { data: todo } = await supabase.from('todos').select('user_id').eq('id', todoId).maybeSingle()
  if (!todo) return false
  if (todo.user_id === userId) return true
  const { data: placement } = await supabase
    .from('todo_placements')
    .select('id')
    .eq('todo_id', todoId)
    .eq('user_id', userId)
    .maybeSingle()
  return Boolean(placement)
}

/** Löst einen Namen für update_todo(zustaendig) zur Person auf (0056). Zur
 *  Auswahl stehen - wie in der Web-UI für Nicht-Ersteller - nur Personen, die
 *  die Karte schon haben (Ersteller*in und Platzierte); Teilen mit neuen
 *  Kolleg*innen läuft über die Web-Oberfläche, weil nur dort share-todo
 *  Partei und Ebene prüft. "ich" meint den Aufrufer, leer heißt niemand.
 *  Liefert die id, '' für niemand oder ein Fehlerergebnis. */
async function zustaendigAufloesen(
  supabase: SupabaseClient,
  userId: string,
  todoId: string,
  eingabe: string,
): Promise<string | ReturnType<typeof toolTextResult>> {
  if (!eingabe) return ''
  const { data: todo } = await supabase.from('todos').select('user_id').eq('id', todoId).single()
  const { data: platziert } = await supabase.from('todo_placements').select('user_id').eq('todo_id', todoId)
  const ids = Array.from(new Set([todo?.user_id as string, ...(platziert ?? []).map((p) => p.user_id as string)]))
  if (['ich', 'mich', 'mir'].includes(eingabe.toLowerCase())) {
    return ids.includes(userId) ? userId : toolTextResult('Fehler: Die Karte liegt nicht auf deinem Board.', true)
  }
  const { data: profs } = await supabase.from('profiles').select('id, name').in('id', ids)
  const treffer = (profs ?? []).filter((p) => (p.name as string).toLowerCase().includes(eingabe.toLowerCase()))
  if (treffer.length === 1) return treffer[0].id as string
  const namen = (profs ?? []).map((p) => p.name).join(', ')
  if (treffer.length === 0) {
    return toolTextResult(
      `Fehler: "${eingabe}" hat die Karte nicht. Zuweisbar sind: ${namen}. Mit anderen Kolleg*innen die Karte zuerst in der Web-Oberfläche teilen.`,
      true,
    )
  }
  return toolTextResult(`Fehler: "${eingabe}" ist nicht eindeutig (${treffer.map((p) => p.name).join(', ')}).`, true)
}

export async function completeTodo(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const todoId = typeof args.todo_id === 'string' ? args.todo_id.trim() : ''
  if (!todoId) return toolTextResult('Fehler: todo_id ist erforderlich.', true)
  const erledigt = args.erledigt === false ? false : true

  if (!(await todoIstZugreifbar(supabase, userId, todoId))) {
    return toolTextResult(`ToDo mit id ${todoId} wurde nicht gefunden (oder gehört nicht zu diesem Konto).`, true)
  }

  const { data: current } = await supabase.from('todos').select('erledigt, erledigt_am, titel').eq('id', todoId).single()
  // erledigt_am nur beim Übergang false->true neu setzen (gleiche Logik wie
  // TodoDetailModal.tsx), damit ein erneutes Abhaken einen bereits gesetzten
  // Zeitpunkt nicht verändert.
  const wurdeGesetzt = erledigt && !current?.erledigt
  const erledigtAm = erledigt ? (wurdeGesetzt ? new Date().toISOString() : current?.erledigt_am ?? null) : null

  const { error } = await supabase.from('todos').update({ erledigt, erledigt_am: erledigtAm }).eq('id', todoId)
  if (error) return toolTextResult(`Fehler beim Aktualisieren: ${error.message}`, true)

  return toolTextResult(
    `ToDo "${current?.titel ?? todoId}" wurde als ${erledigt ? 'erledigt' : 'offen'} markiert.`,
  )
}

export async function updateTodo(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const todoId = typeof args.todo_id === 'string' ? args.todo_id.trim() : ''
  if (!todoId) return toolTextResult('Fehler: todo_id ist erforderlich.', true)

  if (!(await todoIstZugreifbar(supabase, userId, todoId))) {
    return toolTextResult(`ToDo mit id ${todoId} wurde nicht gefunden (oder gehört nicht zu diesem Konto).`, true)
  }

  const updates: Record<string, unknown> = {}
  if (typeof args.titel === 'string' && args.titel.trim()) updates.titel = args.titel.trim()
  if (typeof args.beschreibung === 'string') updates.beschreibung = args.beschreibung.trim() || null
  if (typeof args.faellig_am === 'string') updates.faellig_am = args.faellig_am.trim() || null
  if (typeof args.zustaendig === 'string') {
    const zustaendig = await zustaendigAufloesen(supabase, userId, todoId, args.zustaendig.trim())
    if (typeof zustaendig === 'object') return zustaendig
    updates.zustaendig_user_id = zustaendig === '' ? null : zustaendig
  }
  if (typeof args.session_id === 'string') {
    const neueSessionId = args.session_id.trim() || null
    if (neueSessionId) {
      const { data: session } = await supabase.from('sessions').select('id').eq('id', neueSessionId).maybeSingle()
      if (!session) return toolTextResult(`Fehler: Sitzung ${neueSessionId} wurde nicht gefunden.`, true)
    }
    updates.session_id = neueSessionId
  }

  const spalte = typeof args.spalte === 'string' ? args.spalte.trim() : ''
  let spaltenHinweis = ''
  if (spalte) {
    const column = await festeSpalte(supabase, userId, spalte)
    if (typeof column === 'string') return toolTextResult(column, true)
    const { data: last } = await supabase
      .from('todo_placements')
      .select('position')
      .eq('column_id', column.id)
      .order('position', { ascending: false })
      .limit(1)
    const position = last && last.length > 0 ? last[0].position + 1 : 0
    // Eigene Platzierung des Nutzers verschieben (nicht die anderer Personen auf
    // geteilten Karten - jede Person hat ein eigenes Board, siehe todo_placements).
    const { error: placementError } = await supabase
      .from('todo_placements')
      .upsert({ todo_id: todoId, user_id: userId, column_id: column.id, position }, { onConflict: 'todo_id,user_id' })
    if (placementError) return toolTextResult(`Fehler beim Verschieben auf die Spalte: ${placementError.message}`, true)
    spaltenHinweis = ` und in Spalte "${column.titel}" verschoben`
  }

  if (Object.keys(updates).length === 0 && !spalte) {
    return toolTextResult('Fehler: mindestens ein zu änderndes Feld (oder spalte) angeben.', true)
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase.from('todos').update(updates).eq('id', todoId)
    if (error) return toolTextResult(`Fehler beim Aktualisieren: ${error.message}`, true)
  }

  return toolTextResult(`ToDo aktualisiert${spaltenHinweis}.`)
}
