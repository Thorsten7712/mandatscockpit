import { useEffect, useState, type FormEvent } from 'react'
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { supabase } from '../lib/supabaseClient'
import type { TodoBoardSettings, TodoColumn, TodoRow } from '../lib/types'
import { TodoDetailModal } from './TodoDetailModal'
import { formatDate } from '../lib/format'

function Card({
  todo,
  settings,
  onOpen,
  terminLabel,
  istFertig,
}: {
  todo: TodoRow
  settings: TodoBoardSettings | null
  onOpen: () => void
  terminLabel: string | null
  istFertig: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: todo.id })
  // touchAction: 'none' ist auf Touch-Geräten (iPad) nötig, sonst interpretiert
  // Safari die Berührung sofort als Scroll-Geste, bevor der TouchSensor den
  // Drag erkennen kann - Karten ließen sich dann mit dem Finger nicht ziehen.
  const style = {
    touchAction: 'none',
    ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : {}),
  }
  const zeigeTermin = (settings?.zeige_termin ?? true) && Boolean(terminLabel)
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
      <p className={`text-sm font-medium ${istFertig ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
        {todo.titel}
      </p>
      {(zeigeTermin || zeigeZustaendig) && (
        <p className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-slate-500">
          {zeigeTermin && (
            <span className="max-w-[14rem] truncate rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
              📅 {terminLabel}
            </span>
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
  canAddCard,
  istFertig,
  terminLabels,
}: {
  column: TodoColumn
  todos: TodoRow[]
  settings: TodoBoardSettings | null
  onAddCard: (titel: string) => void
  onOpenTodo: (id: string) => void
  canAddCard: boolean
  istFertig: boolean
  terminLabels: Record<string, string | null>
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
    <div ref={setNodeRef} className="rounded-xl bg-slate-200/50 p-3">
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
          <Card
            key={t.id}
            todo={t}
            settings={settings}
            onOpen={() => onOpenTodo(t.id)}
            terminLabel={terminLabels[t.id] ?? null}
            istFertig={istFertig}
          />
        ))}
      </div>
      {canAddCard && (
        <form onSubmit={handleAddCard} className="mt-2">
          <input
            type="text"
            placeholder="+ Karte hinzufügen"
            value={newCardTitel}
            onChange={(e) => setNewCardTitel(e.target.value)}
            className="w-full rounded-lg border border-dashed border-slate-300 bg-transparent px-3 py-2 text-sm placeholder:text-slate-400 transition-colors hover:border-slate-400 focus:border-solid focus:bg-white"
          />
        </form>
      )}
    </div>
  )
}

export function TodoBoard() {
  const [userId, setUserId] = useState<string | null>(null)
  const [columns, setColumns] = useState<TodoColumn[]>([])
  const [todos, setTodos] = useState<TodoRow[]>([])
  const [settings, setSettings] = useState<TodoBoardSettings | null>(null)
  const [openTodoId, setOpenTodoId] = useState<string | null>(null)
  const [eventById, setEventById] = useState<Map<string, { titel: string; start: string }>>(new Map())
  const [sessionById, setSessionById] = useState<Map<string, { titel: string; datum: string }>>(new Map())

  // MouseSensor + TouchSensor statt PointerSensor: Auf iPad/Touch-Geräten
  // kollidiert ein reiner PointerSensor oft mit Safaris nativer Scroll-
  // Erkennung, wodurch sich Karten nicht per Finger ziehen lassen. Maus- und
  // Touch-Events feuern nie für dieselbe Interaktion, daher gibt es hier
  // keine Doppel-Aktivierung. delay+tolerance beim Touch (statt distance)
  // gibt Safari kurz Zeit, zwischen Scrollen und Ziehen zu unterscheiden.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

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

  // Für die Kartenanzeige ("Titel + Datum des Termins" statt nur "Termin")
  // werden die verknüpften Events/Sitzungen gezielt nachgeladen - nur die
  // tatsächlich referenzierten IDs, nicht alle.
  useEffect(() => {
    const eventIds = Array.from(new Set(todos.filter((t) => t.event_id).map((t) => t.event_id as string)))
    const sessionIds = Array.from(new Set(todos.filter((t) => t.session_id).map((t) => t.session_id as string)))

    if (eventIds.length === 0) {
      setEventById(new Map())
    } else {
      supabase
        .from('events')
        .select('id, titel, start')
        .in('id', eventIds)
        .then(({ data }) => setEventById(new Map((data ?? []).map((e) => [e.id, e]))))
    }

    if (sessionIds.length === 0) {
      setSessionById(new Map())
    } else {
      supabase
        .from('sessions')
        .select('id, titel, datum')
        .in('id', sessionIds)
        .then(({ data }) => setSessionById(new Map((data ?? []).map((s) => [s.id, s]))))
    }
  }, [todos])

  function terminLabelFor(todo: TodoRow): string | null {
    if (todo.event_id) {
      const e = eventById.get(todo.event_id)
      return e ? `${e.titel} · ${formatDate(e.start)}` : null
    }
    if (todo.session_id) {
      const s = sessionById.get(todo.session_id)
      return s ? `${s.titel} · ${formatDate(s.datum)}` : null
    }
    if (todo.faellig_am) {
      return `Fällig ${formatDate(todo.faellig_am)}`
    }
    return null
  }

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

  // Neue Karten entstehen nur in der Spalte "Neu" (Titel-Matching,
  // case-insensitive - greift nicht mehr, falls der Nutzer die Spalte
  // umbenennt; gleiches Muster wie der Auto-Move nach "Geplant" in
  // TodoDetailModal). Ohne passenden Namen fällt es auf die erste Spalte
  // zurück, damit Karten-Erfassung nie ganz verschwindet.
  const neuColumn = sortedColumns.find((c) => c.titel.trim().toLowerCase() === 'neu') ?? sortedColumns[0]
  const terminLabels: Record<string, string | null> = {}
  for (const t of todos) terminLabels[t.id] = terminLabelFor(t)

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        {/* Grid mit auto-fill statt horizontalem Scrollen: bei vielen
            Spalten brechen sie in weitere Zeilen um, bei wenigen teilen sie
            sich die Breite. Drag & Drop über Zeilen hinweg funktioniert,
            weil dnd-kit rein pointer-basiert droppt. */}
        <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(272px,1fr))]">
          {sortedColumns.map((col) => (
            <Column
              key={col.id}
              column={col}
              todos={todos.filter((t) => t.column_id === col.id)}
              settings={settings}
              onAddCard={(titel) => handleAddCard(col.id, titel)}
              onOpenTodo={setOpenTodoId}
              canAddCard={col.id === neuColumn.id}
              istFertig={col.titel.trim().toLowerCase() === 'fertig'}
              terminLabels={terminLabels}
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
