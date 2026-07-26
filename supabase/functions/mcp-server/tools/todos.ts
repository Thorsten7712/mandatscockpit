import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { formatDate, parseLimit, toolTextResult } from '../shared.ts'

export async function createTodo(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const titel = typeof args.titel === 'string' ? args.titel.trim() : ''
  const spalte = typeof args.spalte === 'string' ? args.spalte.trim() : ''
  if (!titel || !spalte) {
    return toolTextResult('Fehler: titel und spalte sind erforderlich.', true)
  }
  const faelligAm = typeof args.faellig_am === 'string' && args.faellig_am ? args.faellig_am : null
  const sessionId = typeof args.session_id === 'string' && args.session_id ? args.session_id : null

  const { data: columns, error: columnsError } = await supabase
    .from('todo_columns')
    .select('id, titel, reihenfolge')
    .eq('user_id', userId)
  if (columnsError) return toolTextResult(`Fehler beim Laden der Spalten: ${columnsError.message}`, true)

  let column = (columns ?? []).find((c) => c.titel.trim().toLowerCase() === spalte.toLowerCase())
  if (!column) {
    const maxOrder = (columns ?? []).reduce((max, c) => Math.max(max, c.reihenfolge), -1)
    const { data: created, error: createError } = await supabase
      .from('todo_columns')
      .insert({ user_id: userId, titel: spalte, reihenfolge: maxOrder + 1 })
      .select('id, titel, reihenfolge')
      .single()
    if (createError || !created) {
      return toolTextResult(`Fehler beim Anlegen der Spalte "${spalte}": ${createError?.message}`, true)
    }
    column = created
  }

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
  zustaendig: string | null
  erledigt: boolean
  erledigt_am: string | null
  user_id: string
}

export async function listTodos(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const status = args.status === 'erledigt' || args.status === 'alle' ? args.status : 'offen'
  const spalte = typeof args.spalte === 'string' ? args.spalte.trim().toLowerCase() : ''
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
    let q = supabase.from('todos').select('id, titel, faellig_am, zustaendig, erledigt, erledigt_am, user_id')
    if (status === 'offen') q = q.eq('erledigt', false)
    else if (status === 'erledigt') q = q.eq('erledigt', true)
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

  const lines = rows.map((t) => {
    const box = t.erledigt ? '[x]' : '[ ]'
    const details: string[] = []
    if (t.erledigt && t.erledigt_am) details.push(`erledigt am ${formatDate(t.erledigt_am.slice(0, 10))}`)
    else if (t.faellig_am) details.push(`fällig ${formatDate(t.faellig_am)}`)
    const spaltenTitel = columnTitleById.get(columnIdByTodo.get(t.id) ?? '')
    if (spaltenTitel) details.push(`Spalte: ${spaltenTitel}`)
    if (t.zustaendig) details.push(`zuständig: ${t.zustaendig}`)
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
  if (typeof args.zustaendig === 'string') updates.zustaendig = args.zustaendig.trim() || null

  const spalte = typeof args.spalte === 'string' ? args.spalte.trim() : ''
  let spaltenHinweis = ''
  if (spalte) {
    const { data: columns } = await supabase.from('todo_columns').select('id, titel, reihenfolge').eq('user_id', userId)
    let column = (columns ?? []).find((c) => c.titel.trim().toLowerCase() === spalte.toLowerCase())
    if (!column) {
      const maxOrder = (columns ?? []).reduce((max, c) => Math.max(max, c.reihenfolge), -1)
      const { data: created, error: createError } = await supabase
        .from('todo_columns')
        .insert({ user_id: userId, titel: spalte, reihenfolge: maxOrder + 1 })
        .select('id, titel, reihenfolge')
        .single()
      if (createError || !created) return toolTextResult(`Fehler beim Anlegen der Spalte "${spalte}": ${createError?.message}`, true)
      column = created
    }
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
