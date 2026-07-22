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
import type { TodoBoardSettings, TodoColumn, TodoPlacement, TodoRow } from '../lib/types'
import { TodoDetailModal } from './TodoDetailModal'
import { formatDate } from '../lib/format'

const FUENF_TAGE_MS = 5 * 24 * 60 * 60 * 1000

// Erledigte Karten bleiben noch 5 Tage nach dem Abhaken auf dem Board
// sichtbar, danach nur noch im Archiv (siehe Archiv.tsx) - rein clientseitig
// gefiltert, kein Cronjob nötig.
function istAufBoardSichtbar(todo: TodoRow): boolean {
  if (!todo.erledigt || !todo.erledigt_am) return true
  return Date.now() - new Date(todo.erledigt_am).getTime() <= FUENF_TAGE_MS
}

function Card({
  todo,
  settings,
  onOpen,
  terminLabel,
  hatDokument,
}: {
  todo: TodoRow
  settings: TodoBoardSettings | null
  onOpen: () => void
  terminLabel: string | null
  hatDokument: boolean
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
      <p className={`text-sm font-medium ${todo.erledigt ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
        {todo.ebene && <span title="Für Kolleg*innen freigebbar/geteilt">🔗 </span>}
        {hatDokument && <span title="Enthält Dokumente">📎 </span>}
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
  entries,
  settings,
  onAddCard,
  onOpenTodo,
  canAddCard,
  terminLabels,
  dokumentIds,
}: {
  column: TodoColumn
  entries: TodoRow[]
  settings: TodoBoardSettings | null
  onAddCard: (titel: string) => void
  onOpenTodo: (id: string) => void
  canAddCard: boolean
  terminLabels: Record<string, string | null>
  dokumentIds: Set<string>
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
        {entries.length > 0 && (
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500 shadow-sm">
            {entries.length}
          </span>
        )}
      </div>
      <div className="min-h-[40px] space-y-2">
        {entries.map((t) => (
          <Card
            key={t.id}
            todo={t}
            settings={settings}
            onOpen={() => onOpenTodo(t.id)}
            terminLabel={terminLabels[t.id] ?? null}
            hatDokument={dokumentIds.has(t.id)}
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
  const [placements, setPlacements] = useState<TodoPlacement[]>([])
  const [settings, setSettings] = useState<TodoBoardSettings | null>(null)
  const [openTodoId, setOpenTodoId] = useState<string | null>(null)
  const [eventById, setEventById] = useState<Map<string, { titel: string; start: string }>>(new Map())
  const [sessionById, setSessionById] = useState<Map<string, { titel: string; datum: string }>>(new Map())
  const [dokumentIds, setDokumentIds] = useState<Set<string>>(new Set())

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

  // Lädt nur die EIGENE Board-Platzierung (todo_placements.user_id = self) -
  // RLS würde für den Karten-Ersteller zusätzlich fremde Platzierungen
  // durchlassen (siehe 0021_todo_erledigt_sharing.sql), die gehören aber
  // nicht auf dieses Board.
  async function load(uid: string) {
    const { data: cols } = await supabase.from('todo_columns').select('*').eq('user_id', uid).order('reihenfolge')
    const { data: myPlacements } = await supabase.from('todo_placements').select('*').eq('user_id', uid)
    setColumns(cols ?? [])
    setPlacements(myPlacements ?? [])
    const todoIds = (myPlacements ?? []).map((p) => p.todo_id)
    if (todoIds.length === 0) {
      setTodos([])
      return
    }
    const { data: items } = await supabase.from('todos').select('*').in('id', todoIds)
    setTodos(items ?? [])
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      await load(data.user.id)
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

    // 📎-Flag fürs "Enthält Dokumente" (siehe TodoDetailModal.tsx "Dokumente")
    // - nur für die aktuell sichtbaren Karten nachladen, kein Volltabellen-Join.
    const todoIds = todos.map((t) => t.id)
    if (todoIds.length === 0) {
      setDokumentIds(new Set())
    } else {
      supabase
        .from('summaries')
        .select('todo_id')
        .in('todo_id', todoIds)
        .then(({ data }) => setDokumentIds(new Set((data ?? []).map((d) => d.todo_id as string))))
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

  const sortedColumns = [...columns].sort((a, b) => a.reihenfolge - b.reihenfolge)
  const fertigColumn = sortedColumns.find((c) => c.titel.trim().toLowerCase() === 'fertig')
  const placementByTodoId = new Map(placements.map((p) => [p.todo_id, p]))

  // Virtuelles Gruppieren statt Platzierungs-Schreiben bei Erledigt-Toggle:
  // erledigt=true gruppiert eine Karte für JEDEN Betrachter in dessen eigene
  // Fertig-Spalte, ohne dass fremde todo_placements-Zeilen angefasst werden
  // müssten (dafür fehlt per RLS die Berechtigung - siehe Migration 0021).
  function displayColumnId(todo: TodoRow, placement: TodoPlacement): string {
    return todo.erledigt && fertigColumn ? fertigColumn.id : placement.column_id
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || !userId) return
    const todoId = active.id as string
    const newColumnId = over.id as string
    const targetColumn = columns.find((c) => c.id === newColumnId)
    const wirdErledigt = targetColumn?.titel.trim().toLowerCase() === 'fertig'
    const erledigtAm = wirdErledigt ? new Date().toISOString() : null

    setPlacements((prev) =>
      prev.map((p) => (p.todo_id === todoId && p.user_id === userId ? { ...p, column_id: newColumnId } : p)),
    )
    setTodos((prev) =>
      prev.map((t) => (t.id === todoId ? { ...t, erledigt: wirdErledigt, erledigt_am: erledigtAm } : t)),
    )

    await supabase.from('todo_placements').update({ column_id: newColumnId }).eq('todo_id', todoId).eq('user_id', userId)
    await supabase.from('todos').update({ erledigt: wirdErledigt, erledigt_am: erledigtAm }).eq('id', todoId)
  }

  async function handleAddCard(columnId: string, titel: string) {
    if (!userId) return
    const maxPosition = Math.max(0, ...placements.filter((p) => p.column_id === columnId).map((p) => p.position))
    const { data: newTodo, error: todoError } = await supabase
      .from('todos')
      .insert({ user_id: userId, titel })
      .select()
      .single()
    if (todoError || !newTodo) return
    const { data: placement } = await supabase
      .from('todo_placements')
      .insert({ todo_id: newTodo.id, user_id: userId, column_id: columnId, position: maxPosition + 1 })
      .select()
      .single()
    setTodos((prev) => [...prev, newTodo])
    if (placement) setPlacements((prev) => [...prev, placement])
  }

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

  const sichtbareTodos = todos.filter((t) => placementByTodoId.has(t.id) && istAufBoardSichtbar(t))
  const entriesByColumn = new Map<string, TodoRow[]>()
  for (const t of sichtbareTodos) {
    const placement = placementByTodoId.get(t.id)!
    const colId = displayColumnId(t, placement)
    const list = entriesByColumn.get(colId) ?? []
    list.push(t)
    entriesByColumn.set(colId, list)
  }
  for (const list of entriesByColumn.values()) {
    list.sort((a, b) => (placementByTodoId.get(a.id)?.position ?? 0) - (placementByTodoId.get(b.id)?.position ?? 0))
  }

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
              entries={entriesByColumn.get(col.id) ?? []}
              settings={settings}
              onAddCard={(titel) => handleAddCard(col.id, titel)}
              onOpenTodo={setOpenTodoId}
              canAddCard={col.id === neuColumn.id}
              terminLabels={terminLabels}
              dokumentIds={dokumentIds}
            />
          ))}
        </div>
      </DndContext>
      {openTodoId && userId && (
        <TodoDetailModal
          id={openTodoId}
          onClose={() => setOpenTodoId(null)}
          onChanged={() => load(userId)}
        />
      )}
    </>
  )
}
