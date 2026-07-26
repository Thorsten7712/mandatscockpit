import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { toolTextResult, truncate } from '../shared.ts'

export async function search(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) return toolTextResult('Fehler: query ist erforderlich.', true)
  const limit = Math.min(Math.max(typeof args.limit === 'number' ? Math.floor(args.limit) : 10, 1), 50)
  const like = `%${query}%`

  const { data: placements } = await supabase.from('todo_placements').select('todo_id').eq('user_id', userId)
  const placedTodoIds = (placements ?? []).map((p) => p.todo_id as string)
  const { data: shares } = await supabase.from('antrag_shares').select('antrag_id').eq('user_id', userId)
  const sharedAntragIds = (shares ?? []).map((s) => s.antrag_id as string)

  // Bewusst KEIN .or('titel.ilike.X,beschreibung.ilike.Y') mit eingesetztem
  // Suchbegriff: Kommas/Klammern im Suchbegriff würden das PostgREST-Filterformat
  // brechen (gleiches Problem wie Gremiennamen in list_sessions/CalendarView.tsx) -
  // stattdessen je Spalte eine eigene Abfrage und in JS per Map mergen.
  const todoById = new Map<string, string>()
  const addTodos = (rows: { id: string; titel: string }[] | null) => (rows ?? []).forEach((t) => todoById.set(t.id, t.titel))
  addTodos((await supabase.from('todos').select('id, titel').eq('user_id', userId).ilike('titel', like).limit(limit)).data)
  addTodos((await supabase.from('todos').select('id, titel').eq('user_id', userId).ilike('beschreibung', like).limit(limit)).data)
  if (placedTodoIds.length > 0) {
    addTodos((await supabase.from('todos').select('id, titel').in('id', placedTodoIds).ilike('titel', like).limit(limit)).data)
    addTodos((await supabase.from('todos').select('id, titel').in('id', placedTodoIds).ilike('beschreibung', like).limit(limit)).data)
  }

  const antragById = new Map<string, string>()
  const addAntraege = (rows: { id: string; titel: string }[] | null) => (rows ?? []).forEach((a) => antragById.set(a.id, a.titel))
  addAntraege((await supabase.from('antraege').select('id, titel').eq('user_id', userId).ilike('titel', like).limit(limit)).data)
  addAntraege((await supabase.from('antraege').select('id, titel').eq('user_id', userId).ilike('inhalt', like).limit(limit)).data)
  if (sharedAntragIds.length > 0) {
    addAntraege((await supabase.from('antraege').select('id, titel').in('id', sharedAntragIds).ilike('titel', like).limit(limit)).data)
    addAntraege((await supabase.from('antraege').select('id, titel').in('id', sharedAntragIds).ilike('inhalt', like).limit(limit)).data)
  }

  interface NoteHit {
    id: string
    inhalt: string | null
    session_id: string | null
    event_id: string | null
    todo_id: string | null
    antrag_id: string | null
  }
  const noteById = new Map<string, NoteHit>()
  const addNotes = (rows: NoteHit[] | null) => (rows ?? []).forEach((n) => noteById.set(n.id, n))
  addNotes(
    (
      await supabase
        .from('summaries')
        .select('id, inhalt, session_id, event_id, todo_id, antrag_id')
        .eq('user_id', userId)
        .ilike('inhalt', like)
        .limit(limit)
    ).data,
  )
  if (placedTodoIds.length > 0) {
    addNotes(
      (
        await supabase
          .from('summaries')
          .select('id, inhalt, session_id, event_id, todo_id, antrag_id')
          .in('todo_id', placedTodoIds)
          .ilike('inhalt', like)
          .limit(limit)
      ).data,
    )
  }

  const abschnitte: string[] = []
  if (todoById.size > 0) {
    abschnitte.push(`ToDos:\n${Array.from(todoById.entries()).map(([id, titel]) => `- ${titel} — id: ${id}`).join('\n')}`)
  }
  if (antragById.size > 0) {
    abschnitte.push(`Anträge:\n${Array.from(antragById.entries()).map(([id, titel]) => `- ${titel} — id: ${id}`).join('\n')}`)
  }
  if (noteById.size > 0) {
    abschnitte.push(
      `Notizen:\n${Array.from(noteById.values())
        .map((n) => `- ${truncate(n.inhalt ?? '', 200)} — id des Ziels: ${n.session_id ?? n.event_id ?? n.todo_id ?? n.antrag_id}`)
        .join('\n')}`,
    )
  }

  if (abschnitte.length === 0) return toolTextResult(`Keine Treffer für "${query}".`)
  return toolTextResult(abschnitte.join('\n\n'))
}
