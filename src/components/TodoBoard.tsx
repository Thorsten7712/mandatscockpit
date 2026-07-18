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
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: todo.id })
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
      className={`cursor-grab select-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition-shadow duration-150 hover:shadow-md active:cursor-grabbing ${isDragging ? 'z-10 shadow-lg ring-2 ring-primary/40' : ''}`}
    >
      <p className="text-sm font-medium text-slate-900">{todo.titel}</p>
      {(zeigeTermin || zeigeZustaendig) && (
        <p className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-slate-500">
          {zeigeTermin && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">📅 Termin</span>
          )}
          {zeigeZustaendig && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5">👤 {todo.zustaendig}</span>
          )}
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
    <div ref={setNodeRef} className="w-72 flex-shrink-0 rounded-xl bg-slate-200/50 p-3">
      <div className="mb-2.5 flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold text-slate-700">{column.titel}</h3>
        {todos.length > 0 && (
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500 shadow-sm">
            {todos.length}
          </span>
        )}
      </div>
      <div className="min-h-[40px] space-y-2">
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
          className="w-full rounded-lg border border-dashed border-slate-300 bg-transparent px-3 py-2 text-sm placeholder:text-slate-400 transition-colors hover:border-slate-400 focus:border-solid focus:bg-white"
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
        <div className="flex items-start gap-4 overflow-x-auto pb-2">
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
