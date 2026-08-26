import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { toolTextResult } from '../shared.ts'
import { todoIstZugreifbar } from './todos.ts'

/** Verknüpfen/Lösen darf, wer die Karte verwalten darf (eigen/platziert) ODER das
 *  Dokument besitzt - gleiche Bedingung wie die RLS-Policies todo_dokumente_insert/
 *  _delete in 0037_todo_dokumente.sql (Service-Role-Client umgeht RLS, daher hier
 *  manuell nachgebildet). */
async function darfVerknuepfen(supabase: SupabaseClient, userId: string, todoId: string, dokumentId: string): Promise<boolean> {
  if (await todoIstZugreifbar(supabase, userId, todoId)) return true
  const { data: dok } = await supabase.from('dokumente').select('user_id').eq('id', dokumentId).maybeSingle()
  return dok?.user_id === userId
}

export async function linkTodoDocument(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const todoId = typeof args.todo_id === 'string' ? args.todo_id.trim() : ''
  const dokumentId = typeof args.dokument_id === 'string' ? args.dokument_id.trim() : ''
  if (!todoId || !dokumentId) return toolTextResult('Fehler: todo_id und dokument_id sind erforderlich.', true)

  const { data: todo } = await supabase.from('todos').select('titel').eq('id', todoId).maybeSingle()
  if (!todo) return toolTextResult(`Fehler: ToDo ${todoId} wurde nicht gefunden.`, true)
  const { data: dok } = await supabase.from('dokumente').select('titel').eq('id', dokumentId).maybeSingle()
  if (!dok) return toolTextResult(`Fehler: Dokument ${dokumentId} wurde nicht gefunden.`, true)

  if (!(await darfVerknuepfen(supabase, userId, todoId, dokumentId))) {
    return toolTextResult('Fehler: dafür muss die Karte oder das Dokument dem Nutzer gehören (bzw. die Karte mit ihm geteilt sein).', true)
  }

  // unique(todo_id, dokument_id) - erneutes Verknüpfen ist idempotent statt
  // ein Duplikat- bzw. Konflikt-Fehler.
  const { error } = await supabase
    .from('todo_dokumente')
    .upsert({ todo_id: todoId, dokument_id: dokumentId }, { onConflict: 'todo_id,dokument_id', ignoreDuplicates: true })
  if (error) return toolTextResult(`Fehler beim Verknüpfen: ${error.message}`, true)

  return toolTextResult(`ToDo "${todo.titel}" wurde mit Dokument "${dok.titel}" verknüpft.`)
}

export async function unlinkTodoDocument(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const todoId = typeof args.todo_id === 'string' ? args.todo_id.trim() : ''
  const dokumentId = typeof args.dokument_id === 'string' ? args.dokument_id.trim() : ''
  if (!todoId || !dokumentId) return toolTextResult('Fehler: todo_id und dokument_id sind erforderlich.', true)

  if (!(await darfVerknuepfen(supabase, userId, todoId, dokumentId))) {
    return toolTextResult('Fehler: dafür muss die Karte oder das Dokument dem Nutzer gehören (bzw. die Karte mit ihm geteilt sein).', true)
  }

  const { error } = await supabase.from('todo_dokumente').delete().eq('todo_id', todoId).eq('dokument_id', dokumentId)
  if (error) return toolTextResult(`Fehler beim Lösen der Verknüpfung: ${error.message}`, true)

  return toolTextResult('Verknüpfung wurde entfernt.')
}
