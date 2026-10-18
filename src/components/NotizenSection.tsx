import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { SessionRow, SummaryRow, TodoRow } from '../lib/types'
import { TodoDetailModal } from './TodoDetailModal'
import { formatDate } from '../lib/format'

interface KartenItem {
  todoId: string
  todo?: TodoRow
  /** Zeitpunkt der neuesten Notiz an der Karte. */
  erstellt: string
  sessionId: string | null
  notizAnzahl: number
}

// ToDo-Karten mit Notizen als chronologische, nach Gremium filterbare Liste.
// Hieß bis 0061 "Meine Dokumente" und enthielt zusätzlich die eigenen Anträge;
// das Antragswesen ist entfallen. Notizen direkt an Sitzungen gibt es seit
// 0055 nicht mehr, Datei-Uploads seit 0052 nicht.
export function NotizenSection() {
  const [notizen, setNotizen] = useState<SummaryRow[]>([])
  const [todoById, setTodoById] = useState<Map<string, TodoRow>>(new Map())
  const [sessionById, setSessionById] = useState<Map<string, SessionRow>>(new Map())
  const [gremiumFilter, setGremiumFilter] = useState<string | null>(null)
  const [openTodoId, setOpenTodoId] = useState<string | null>(null)

  async function loadNotizen() {
    const { data } = await supabase.from('summaries').select('*').order('erstellt_am', { ascending: false })
    setNotizen(data ?? [])
  }

  useEffect(() => {
    loadNotizen()
  }, [])

  // Die referenzierten ToDo-Karten nachladen (Titel, Erledigt-Status,
  // Sitzungsbezug - nur die tatsächlich verlinkten, gleiches Muster wie
  // eventById/sessionById in TodoBoard).
  useEffect(() => {
    const todoIds = Array.from(new Set(notizen.map((d) => d.todo_id)))
    if (todoIds.length === 0) {
      setTodoById(new Map())
      return
    }
    supabase
      .from('todos')
      .select('*')
      .in('id', todoIds)
      .then(({ data }) => setTodoById(new Map((data ?? []).map((t: TodoRow) => [t.id, t]))))
  }, [notizen])

  useEffect(() => {
    const sessionIds = Array.from(
      new Set(
        Array.from(todoById.values())
          .filter((t) => t.session_id)
          .map((t) => t.session_id as string),
      ),
    )
    if (sessionIds.length === 0) {
      setSessionById(new Map())
      return
    }
    supabase
      .from('sessions')
      .select('*')
      .in('id', sessionIds)
      .then(({ data }) => setSessionById(new Map((data ?? []).map((s: SessionRow) => [s.id, s]))))
  }, [todoById])

  // Mehrere Notizen derselben Karte zu einer Zeile gruppiert - notizen kommt
  // bereits absteigend sortiert, die erste je todo_id ist die neueste.
  const notizenByTodo = new Map<string, SummaryRow[]>()
  for (const d of notizen) {
    const list = notizenByTodo.get(d.todo_id) ?? []
    list.push(d)
    notizenByTodo.set(d.todo_id, list)
  }
  const items: KartenItem[] = Array.from(notizenByTodo.entries()).map(([todoId, liste]) => {
    const todo = todoById.get(todoId)
    return {
      todoId,
      todo,
      erstellt: liste[0].erstellt_am,
      sessionId: todo?.session_id ?? null,
      notizAnzahl: liste.length,
    }
  })

  // Ein Chip pro Gremium (nicht pro Sitzung - ein Gremium tagt mehrfach im
  // Jahr). `gremium` statt `titel`, weil `titel` das rohe SUMMARY-Feld aus dem
  // ICS-Import ist; `gremium` ist die bereinigte Form (extractGremium() in
  // scripts/import-ics.mjs).
  const gremiumOf = (item: KartenItem) => (item.sessionId ? sessionById.get(item.sessionId)?.gremium : null)
  const vorkommendeGremien = Array.from(new Set(items.map(gremiumOf).filter((g): g is string => Boolean(g)))).sort(
    (a, b) => a.localeCompare(b, 'de'),
  )
  const sichtbar = gremiumFilter ? items.filter((item) => gremiumOf(item) === gremiumFilter) : items

  const chip = (aktiv: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${
      aktiv ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`

  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-slate-900">Meine Notizen</h2>

      {vorkommendeGremien.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setGremiumFilter(null)} className={chip(gremiumFilter === null)}>
            Alle
          </button>
          {vorkommendeGremien.map((g) => (
            <button key={g} type="button" onClick={() => setGremiumFilter(g)} className={chip(gremiumFilter === g)}>
              {g}
            </button>
          ))}
        </div>
      )}

      <ul className="max-h-104 space-y-2 overflow-y-auto pr-1">
        {sichtbar.map((item) => {
          const { todo } = item
          const session = item.sessionId ? sessionById.get(item.sessionId) : undefined
          return (
            <li key={item.todoId}>
              <div
                onClick={() => setOpenTodoId(item.todoId)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xs transition-shadow duration-150 hover:shadow-md"
              >
                <span
                  className={`shrink-0 rounded-sm px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${todo?.erledigt ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}
                >
                  {todo?.erledigt ? 'Erledigt' : 'ToDo'}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm font-medium ${todo?.erledigt ? 'text-slate-400 line-through' : 'text-slate-900'}`}
                  >
                    {todo?.titel ?? 'ToDo-Karte'}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <span className="text-slate-600">
                      {item.notizAnzahl} {item.notizAnzahl === 1 ? 'Notiz' : 'Notizen'}
                    </span>
                    {session ? (
                      <span className="truncate">🗳️ {session.titel} · {formatDate(session.datum)}</span>
                    ) : (
                      <span className="italic text-slate-400">Ohne Sitzungsbezug</span>
                    )}
                  </span>
                </span>
              </div>
            </li>
          )
        })}
        {sichtbar.length === 0 && (
          <li className="rounded-xl border-2 border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            {items.length === 0
              ? 'Noch keine Notizen. Notizen schreibst du an einer ToDo-Karte.'
              : 'Keine Notizen für diese Auswahl.'}
          </li>
        )}
      </ul>

      {openTodoId && (
        <TodoDetailModal id={openTodoId} onClose={() => setOpenTodoId(null)} onChanged={loadNotizen} />
      )}
    </section>
  )
}
