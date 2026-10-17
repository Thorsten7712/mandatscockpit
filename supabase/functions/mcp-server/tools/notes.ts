import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { formatDateTime, parseLimit, toolTextResult, truncate } from '../shared.ts'

// Notizen gibt es seit 0055 nur noch an ToDo-Karten (summaries.todo_id) und
// an Dokumenten im Hub (dokumente.parent_id, create_document mit parent_id).
// Sitzungen und Termine haben keine eigenen mehr: was zu ihnen gehört, hängt
// an den verknüpften Karten und Dokumenten. list_notes nimmt deshalb weiter
// session_id/event_id an, liest dann aber die Notizen der dort verknüpften
// Karten.

/** Eigene Karten plus die per todo_placements geteilten - wie die RLS von
 *  todos. Erledigte eigene Karten haben oft keine Platzierung mehr, deshalb
 *  beides. Liefert bei einem Fehler dessen Meldung. */
async function sichtbareKarten(supabase: SupabaseClient, userId: string): Promise<string[] | string> {
  const [eigene, platziert] = await Promise.all([
    supabase.from('todos').select('id').eq('user_id', userId),
    supabase.from('todo_placements').select('todo_id').eq('user_id', userId),
  ])
  if (eigene.error) return eigene.error.message
  if (platziert.error) return platziert.error.message
  return Array.from(
    new Set([...(eigene.data ?? []).map((t) => t.id as string), ...(platziert.data ?? []).map((p) => p.todo_id as string)]),
  )
}

interface NoteListRow {
  id: string
  todo_id: string
  inhalt: string | null
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

  // Sichtbarkeit wie in der Web-UI: die Notizen aller Karten, die man selbst
  // angelegt hat oder die auf dem eigenen Board liegen. Der
  // Service-Role-Client umgeht RLS, daher hier explizit.
  let todoIds = await sichtbareKarten(supabase, userId)
  if (typeof todoIds === 'string') return toolTextResult(`Fehler beim Laden der Karten: ${todoIds}`, true)

  if (todoId) {
    if (!todoIds.includes(todoId)) {
      return toolTextResult(`ToDo mit id ${todoId} gehört nicht zu diesem Konto (auch nicht per Teilen).`, true)
    }
    todoIds = [todoId]
  } else if (sessionId || eventId) {
    const { data: verknuepft, error } = await supabase
      .from('todos')
      .select('id')
      .in('id', todoIds.length > 0 ? todoIds : ['00000000-0000-0000-0000-000000000000'])
      .eq(sessionId ? 'session_id' : 'event_id', (sessionId ?? eventId)!)
    if (error) return toolTextResult(`Fehler beim Laden der Karten: ${error.message}`, true)
    todoIds = (verknuepft ?? []).map((t) => t.id as string)
  }
  if (todoIds.length === 0) {
    return toolTextResult(
      sessionId || eventId
        ? 'Keine Notizen gefunden - mit diesem Termin ist keine ToDo-Karte mit Notizen verknüpft. Notizen an verknüpften Dokumenten liefert list_documents/get_document.'
        : 'Keine Notizen gefunden.',
    )
  }

  const { data, error } = await supabase
    .from('summaries')
    .select('id, todo_id, inhalt, erstellt_am, user_id')
    .in('todo_id', todoIds)
    .not('inhalt', 'is', null)
    .order('erstellt_am', { ascending: false })
    .limit(limit)
  if (error) return toolTextResult(`Fehler beim Laden der Notizen: ${error.message}`, true)
  const rows = (data ?? []) as NoteListRow[]
  if (rows.length === 0) return toolTextResult('Keine Notizen gefunden.')

  const kartenIds = Array.from(new Set(rows.map((r) => r.todo_id)))
  const autorIds = Array.from(new Set(rows.map((r) => r.user_id)))
  const [todos, profile] = await Promise.all([
    supabase.from('todos').select('id, titel').in('id', kartenIds),
    supabase.from('profiles').select('id, name').in('id', autorIds),
  ])
  const titelById = new Map((todos.data ?? []).map((t) => [t.id as string, t.titel as string]))
  const nameById = new Map((profile.data ?? []).map((p) => [p.id as string, p.name as string]))

  // Bei einem gesetzten Filter ist der Kontext eng - dann den vollen Text zeigen,
  // sonst kürzen, damit eine breite Liste die Antwort nicht sprengt.
  const maxLen = gesetzteFilter.length === 1 ? 4000 : 500
  const lines = rows.map((n) => {
    const von = n.user_id === userId ? '' : ` (von ${nameById.get(n.user_id) ?? 'einer Kollegin/einem Kollegen'})`
    return `- ${formatDateTime(n.erstellt_am)} · ToDo "${titelById.get(n.todo_id) ?? n.todo_id}"${von}: ${truncate(n.inhalt ?? '', maxLen)}`
  })
  return toolTextResult(lines.join('\n\n'))
}

export async function createTodoNote(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const todoId = typeof args.todo_id === 'string' ? args.todo_id.trim() : ''
  const inhalt = typeof args.inhalt === 'string' ? args.inhalt.trim() : ''
  if (!todoId) return toolTextResult('Fehler: todo_id ist erforderlich.', true)
  if (!inhalt) return toolTextResult('Fehler: inhalt ist erforderlich - Notizen sind reiner Text.', true)

  // Wie die Policy summaries_insert_todo (0055): eigene oder geteilte Karte.
  const { data: todo, error: todoError } = await supabase.from('todos').select('id, titel').eq('id', todoId).maybeSingle()
  if (todoError) return toolTextResult(`Fehler beim Prüfen der Karte: ${todoError.message}`, true)
  if (!todo) return toolTextResult(`ToDo mit id ${todoId} wurde nicht gefunden.`, true)
  const karten = await sichtbareKarten(supabase, userId)
  if (typeof karten === 'string') return toolTextResult(`Fehler beim Prüfen der Karte: ${karten}`, true)
  if (!karten.includes(todoId)) {
    return toolTextResult(`ToDo mit id ${todoId} gehört nicht zu diesem Konto (auch nicht per Teilen).`, true)
  }

  const { data: note, error } = await supabase
    .from('summaries')
    .insert({ user_id: userId, todo_id: todoId, inhalt })
    .select('id')
    .single()
  if (error || !note) return toolTextResult(`Fehler beim Speichern der Notiz: ${error?.message}`, true)
  return toolTextResult(`Notiz zu ToDo "${todo.titel}" wurde gespeichert (id: ${note.id}).`)
}
