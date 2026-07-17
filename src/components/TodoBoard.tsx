import { useEffect, useState } from 'react'
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import { supabase } from '../lib/supabaseClient'
import type { TodoColumn, TodoRow } from '../lib/types'

function Card({ todo }: { todo: TodoRow }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: todo.id })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="bg-white border rounded px-3 py-2 shadow-sm cursor-grab select-none"
    >
      {todo.titel}
    </div>
  )
}

function Column({ column, todos }: { column: TodoColumn; todos: TodoRow[] }) {
  const { setNodeRef } = useDroppable({ id: column.id })
  return (
    <div ref={setNodeRef} className="bg-slate-100 rounded-lg p-3 w-64 flex-shrink-0">
      <h3 className="font-medium mb-2">{column.titel}</h3>
      <div className="space-y-2 min-h-[40px]">
        {todos.map((t) => (
          <Card key={t.id} todo={t} />
        ))}
      </div>
    </div>
  )
}

// Hinweis: Dies ist ein funktionierendes, aber bewusst schlankes Grundgerüst.
// Spalten-Verwaltung per UI (anlegen/umbenennen/sortieren) und Karten-Erstellung
// sind noch nicht gebaut – siehe CLAUDE.md, Abschnitt "Nächste Schritte".
export function TodoBoard() {
  const [columns, setColumns] = useState<TodoColumn[]>([])
  const [todos, setTodos] = useState<TodoRow[]>([])

  async function load() {
    const { data: cols } = await supabase.from('todo_columns').select('*').order('reihenfolge')
    const { data: items } = await supabase.from('todos').select('*').order('position')
    setColumns(cols ?? [])
    setTodos(items ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const todoId = active.id as string
    const newColumnId = over.id as string
    setTodos((prev) => prev.map((t) => (t.id === todoId ? { ...t, column_id: newColumnId } : t)))
    await supabase.from('todos').update({ column_id: newColumnId }).eq('id', todoId)
  }

  if (columns.length === 0) {
    return (
      <p className="text-slate-500 text-sm">
        Noch keine Spalten angelegt. Lege in der Tabelle <code>todo_columns</code> (z. B. im Supabase
        SQL-Editor) deine ersten Spalten an – etwa „Diese Woche", „Warte auf Rückmeldung", „Erledigt".
        Die Spalten-Verwaltung per UI folgt in einer der nächsten Ausbaustufen.
      </p>
    )
  }

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto">
        {columns.map((col) => (
          <Column key={col.id} column={col} todos={todos.filter((t) => t.column_id === col.id)} />
        ))}
      </div>
    </DndContext>
  )
}
