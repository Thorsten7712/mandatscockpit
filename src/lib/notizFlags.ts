import { supabase } from './supabaseClient'

/**
 * Ids der Sitzungen und Termine, an denen eine Aufgabe mit Notizen hängt -
 * für das 📝 in Kalender und Archiv. Seit 0055 haben Sitzungen und Termine
 * keine eigenen Notizen mehr; was zu ihnen gehört, steht an den verknüpften
 * Aufgaben (und Dokumenten - die tragen aber fast alle Drucksachen, ein
 * Zeichen dafür sagte nichts).
 */
export async function ladeTermineMitNotizen(): Promise<Set<string>> {
  const { data } = await supabase
    .from('summaries')
    .select('todos!inner(session_id, event_id)')
    .not('todo_id', 'is', null)
  const ids = new Set<string>()
  // Viele-zu-eins-Einbettung: PostgREST liefert ein Objekt, die generischen
  // Typen von supabase-js rechnen ohne Schema mit einem Array.
  for (const zeile of (data ?? []) as unknown as { todos: { session_id: string | null; event_id: string | null } | null }[]) {
    if (zeile.todos?.session_id) ids.add(zeile.todos.session_id)
    if (zeile.todos?.event_id) ids.add(zeile.todos.event_id)
  }
  return ids
}
