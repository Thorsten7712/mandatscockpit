import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
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
import type { TodoColumn, TodoRow } from '../lib/types'

function Card({ todo }: { todo: TodoRow }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: todo.id })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined
  const hasTermin = Boolean(todo.faellig_am || todo.event_id || todo.session_id)
  return (
    <Link
      to={`/todo/${todo.id}`}
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="block bg-white border rounded px-3 py-2 shadow-sm cursor-grab select-none hover:bg-slate-50"
    >
      <p>{todo.titel}</p>
      {(hasTermin || todo.zustaendig) && (
        <p className="text-xs text-slate-500 mt-1">
          {hasTermin && '📅'} {todo.zustaendig && `👤 ${todo.zustaendig}`}
        </p>
      )}
    </Link>
  )
}

function Column({
  column,
  todos,
  isEditing,
  editTitel,
  onStartEdit,
  onEditTitelChange,
  onSaveEdit,
  onCancelEdit,
  onMove,
  onDelete,
  canMoveLeft,
  canMoveRight,
  onAddCard,
}: {
  column: TodoColumn
  todos: TodoRow[]
  isEditing: boolean
  editTitel: string
  onStartEdit: () => void
  onEditTitelChange: (value: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onMove: (direction: 'left' | 'right') => void
  onDelete: () => void
  canMoveLeft: boolean
  canMoveRight: boolean
  onAddCard: (titel: string) => void
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
      <div className="flex items-center justify-between mb-2">
        {isEditing ? (
          <input
            type="text"
            value={editTitel}
            onChange={(e) => onEditTitelChange(e.target.value)}
            onBlur={onSaveEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveEdit()
              if (e.key === 'Escape') onCancelEdit()
            }}
            autoFocus
            className="font-medium border rounded px-1 py-0.5 w-full mr-2"
          />
        ) : (
          <h3 className="font-medium cursor-pointer" onClick={onStartEdit}>
            {column.titel}
          </h3>
        )}
        <div className="flex items-center gap-1 text-xs text-slate-400 flex-shrink-0">
          <button type="button" onClick={() => onMove('left')} disabled={!canMoveLeft} className="disabled:opacity-30">
            ◀
          </button>
          <button type="button" onClick={() => onMove('right')} disabled={!canMoveRight} className="disabled:opacity-30">
            ▶
          </button>
          <button type="button" onClick={onDelete} className="text-red-400">
            ✕
          </button>
        </div>
      </div>
      <div className="space-y-2 min-h-[40px]">
        {todos.map((t) => (
          <Card key={t.id} todo={t} />
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
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
  const [editTitel, setEditTitel] = useState('')
  const [newColumnTitel, setNewColumnTitel] = useState('')

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  async function load() {
    const { data: cols } = await supabase.from('todo_columns').select('*').order('reihenfolge')
    const { data: items } = await supabase.from('todos').select('*').order('position')
    setColumns(cols ?? [])
    setTodos(items ?? [])
  }

  useEffect(() => {
    load()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
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

  async function handleAddColumn(e: FormEvent) {
    e.preventDefault()
    if (!userId || !newColumnTitel.trim()) return
    const maxReihenfolge = Math.max(-1, ...columns.map((c) => c.reihenfolge))
    const { data } = await supabase
      .from('todo_columns')
      .insert({ user_id: userId, titel: newColumnTitel.trim(), reihenfolge: maxReihenfolge + 1 })
      .select()
      .single()
    if (data) setColumns((prev) => [...prev, data])
    setNewColumnTitel('')
  }

  function startEditColumn(col: TodoColumn) {
    setEditingColumnId(col.id)
    setEditTitel(col.titel)
  }

  async function saveEditColumn() {
    if (!editingColumnId) return
    const titel = editTitel.trim()
    if (titel) {
      await supabase.from('todo_columns').update({ titel }).eq('id', editingColumnId)
      setColumns((prev) => prev.map((c) => (c.id === editingColumnId ? { ...c, titel } : c)))
    }
    setEditingColumnId(null)
  }

  async function handleMoveColumn(col: TodoColumn, direction: 'left' | 'right') {
    const sorted = [...columns].sort((a, b) => a.reihenfolge - b.reihenfolge)
    const index = sorted.findIndex((c) => c.id === col.id)
    const swapIndex = direction === 'left' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= sorted.length) return
    const other = sorted[swapIndex]
    await supabase.from('todo_columns').update({ reihenfolge: other.reihenfolge }).eq('id', col.id)
    await supabase.from('todo_columns').update({ reihenfolge: col.reihenfolge }).eq('id', other.id)
    setColumns((prev) =>
      prev.map((c) => {
        if (c.id === col.id) return { ...c, reihenfolge: other.reihenfolge }
        if (c.id === other.id) return { ...c, reihenfolge: col.reihenfolge }
        return c
      }),
    )
  }

  async function handleDeleteColumn(col: TodoColumn) {
    const cardCount = todos.filter((t) => t.column_id === col.id).length
    const message =
      cardCount > 0
        ? `Spalte „${col.titel}" löschen? ${cardCount} Karte(n) darin werden mitgelöscht.`
        : `Spalte „${col.titel}" löschen?`
    if (!window.confirm(message)) return
    await supabase.from('todo_columns').delete().eq('id', col.id)
    setColumns((prev) => prev.filter((c) => c.id !== col.id))
    setTodos((prev) => prev.filter((t) => t.column_id !== col.id))
  }

  const sortedColumns = [...columns].sort((a, b) => a.reihenfolge - b.reihenfolge)

  if (columns.length === 0) {
    return <p className="text-slate-500 text-sm">Spalten werden geladen...</p>
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto items-start">
        {sortedColumns.map((col, i) => (
          <Column
            key={col.id}
            column={col}
            todos={todos.filter((t) => t.column_id === col.id)}
            isEditing={editingColumnId === col.id}
            editTitel={editTitel}
            onStartEdit={() => startEditColumn(col)}
            onEditTitelChange={setEditTitel}
            onSaveEdit={saveEditColumn}
            onCancelEdit={() => setEditingColumnId(null)}
            onMove={(direction) => handleMoveColumn(col, direction)}
            onDelete={() => handleDeleteColumn(col)}
            canMoveLeft={i > 0}
            canMoveRight={i < sortedColumns.length - 1}
            onAddCard={(titel) => handleAddCard(col.id, titel)}
          />
        ))}
        <form onSubmit={handleAddColumn} className="w-64 flex-shrink-0">
          <input
            type="text"
            placeholder="+ Spalte hinzufügen"
            value={newColumnTitel}
            onChange={(e) => setNewColumnTitel(e.target.value)}
            className="w-full text-sm border rounded px-2 py-1.5 bg-white"
          />
        </form>
      </div>
    </DndContext>
  )
}
