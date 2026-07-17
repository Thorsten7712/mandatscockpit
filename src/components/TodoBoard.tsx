import { useEffect, useState, type FormEvent } from 'react'
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { supabase } from '../lib/supabaseClient'
import type { TodoBoardSettings, TodoColumn, TodoRow } from '../lib/types'
import { TodoDetailModal } from './TodoDetailModal'

function Card({
  todo,
  settings,
  onOpen,
}: {
  todo: TodoRow
  settings: TodoBoardSettings | null
  onOpen: () => void
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: todo.id })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined
  const hasTermin = Boolean(todo.faellig_am || todo.event_id || todo.session_id)
  const zeigeTermin = (settings?.zeige_termin ?? true) && hasTermin
  const zeigeZustaendig = (settings?.zeige_zustaendig ?? true) && todo.zustaendig
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onOpen}
      className="bg-white border rounded px-3 py-2 shadow-sm cursor-grab select-none hover:bg-slate-50"
    >
      <p>{todo.titel}</p>
      {(zeigeTermin || zeigeZustaendig) && (
        <p className="text-xs text-slate-500 mt-1">
          {zeigeTermin && '📅'} {zeigeZustaendig && `👤 ${todo.zustaendig}`}
        </p>
      )}
    </div>
  )
}

function Column({
  column,
  todos,
  settings,
  onAddCard,
  onOpenTodo,
}: {
  column: TodoColumn
  todos: TodoRow[]
  settings: TodoBoardSettings | null
  onAddCard: (titel: string) => void
  onOpenTodo: (id: string) => void
}) {
  const { setNodeRef } = useDroppable({ id: column.id })
  const [newCardTitel, setNewCardTitel] = useState('')

  function handleAddCard(e: FormEvent) {
    e.preventDefault()
    if (!newCardTitel.trim()) return
    onAddCard(newCardTitel.trim())
    setNewCardTitel('')
  }

  return (
    <div ref={setNodeRef} className="bg-slate-100 rounded-lg p-3 w-64 flex-shrink-0">
      <h3 className="font-medium mb-2">{column.titel}</h3>
      <div className="space-y-2 min-h-[40px]">
        {todos.map((t) => (
          <Card key={t.id} todo={t} settings={settings} onOpen={() => onOpenTodo(t.id)} />
        ))}
      </div>
      <form onSubmit={handleAddCard} className="mt-2">
        <input
          type="text"
          placeholder="+ Karte hinzufügen"
          value={newCardTitel}
          onChange={(e) => setNewCardTitel(e.target.value)}
          className="w-full text-sm border rounded px-2 py-1 bg-white"
        />
      </form>
    </div>
  )
}

export function TodoBoard() {
  const [userId, setUserId] = useState<string | null>(null)
  const [columns, setColumns] = useState<TodoColumn[]>([])
  const [todos, setTodos] = useState<TodoRow[]>([])
  const [settings, setSettings] = useState<TodoBoardSettings | null>(null)
  const [openTodoId, setOpenTodoId] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  async function load() {
    const { data: cols } = await supabase.from('todo_columns').select('*').order('reihenfolge')
    const { data: items } = await supabase.from('todos').select('*').order('position')
    setColumns(cols ?? [])
    setTodos(items ?? [])
  }

  useEffect(() => {
    load()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      const { data: settingsRow } = await supabase
        .from('todo_board_settings')
        .select('*')
        .eq('user_id', data.user.id)
        .single()
      setSettings(settingsRow)
    })
  }, [])

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const todoId = active.id as string
    const newColumnId = over.id as string
    setTodos((prev) => prev.map((t) => (t.id === todoId ? { ...t, column_id: newColumnId } : t)))
    await supabase.from('todos').update({ column_id: newColumnId }).eq('id', todoId)
  }

  async function handleAddCard(columnId: string, titel: string) {
    if (!userId) return
    const maxPosition = Math.max(0, ...todos.filter((t) => t.column_id === columnId).map((t) => t.position))
    const { data } = await supabase
      .from('todos')
      .insert({ user_id: userId, column_id: columnId, titel, position: maxPosition + 1 })
      .select()
      .single()
    if (data) setTodos((prev) => [...prev, data])
  }

  const sortedColumns = [...columns].sort((a, b) => a.reihenfolge - b.reihenfolge)

  if (columns.length === 0) {
    return <p className="text-slate-500 text-sm">Spalten werden geladen...</p>
  }

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto items-start">
          {sortedColumns.map((col) => (
            <Column
              key={col.id}
              column={col}
              todos={todos.filter((t) => t.column_id === col.id)}
              settings={settings}
              onAddCard={(titel) => handleAddCard(col.id, titel)}
              onOpenTodo={setOpenTodoId}
            />
          ))}
        </div>
      </DndContext>
      {openTodoId && (
        <TodoDetailModal id={openTodoId} onClose={() => setOpenTodoId(null)} onChanged={load} />
      )}
    </>
  )
}
