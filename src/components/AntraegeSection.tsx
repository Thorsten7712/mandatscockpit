import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { AntragDeadlineSetting, AntragRow, Ebene, SessionRow, SummaryRow, TodoRow } from '../lib/types'
import { ANTRAG_STATUS_AKTIV, antragBadgeClasses, antragStatusLabel } from '../lib/antragStatus'
import { computeAntragDeadline } from '../lib/antragDeadline'
import { AntragDetailModal } from './AntragDetailModal'
import { TodoDetailModal } from './TodoDetailModal'
import { formatDate } from '../lib/format'

/** 'alle' = ungefiltert, 'eigene' = Anträge ohne Sitzungsbezug, sonst ein Gremiumsname. */
type GremiumFilter = 'alle' | 'eigene' | string

interface DokumentItem {
  key: string
  kind: 'antrag' | 'todo'
  erstellt: string
  sessionId: string | null
  antrag?: AntragRow
  todo?: TodoRow
  todoId?: string
  /** Wie viele Notizen an der Karte hängen. */
  notizAnzahl: number
}

// "Meine Dokumente" bündelt zwei Quellen zu einer chronologischen, nach
// Sitzung filterbaren Liste: eigene Anträge (mit Status-Workflow, siehe
// AntragDetailModal) und ToDo-Karten mit Notizen. Notizen direkt an Sitzungen
// gibt es seit 0055 nicht mehr, Datei-Uploads seit 0052 nicht. Die Antrag-Anlage bleibt bewusst
// leichtgewichtig: Titel + optionale Sitzung reichen, Status startet immer
// bei "Entwurf".
export function AntraegeSection() {
  const [userId, setUserId] = useState<string | null>(null)
  // Bezugszeitpunkt für "überfällig", einmal beim Öffnen festgehalten:
  // Date.now() direkt im Render wäre bei jedem Rendern ein anderer Wert.
  const [jetzt] = useState(() => Date.now())
  const [antraege, setAntraege] = useState<AntragRow[]>([])
  const [todoDocs, setTodoDocs] = useState<SummaryRow[]>([])
  const [todoById, setTodoById] = useState<Map<string, TodoRow>>(new Map())
  const [sessionById, setSessionById] = useState<Map<string, SessionRow>>(new Map())
  const [ownSessions, setOwnSessions] = useState<SessionRow[]>([])
  const [tageByEbene, setTageByEbene] = useState<Map<Ebene, number>>(new Map())

  const [gremiumFilter, setGremiumFilter] = useState<GremiumFilter>('alle')

  const [showAddForm, setShowAddForm] = useState(false)
  const [newTitel, setNewTitel] = useState('')
  const [newSessionId, setNewSessionId] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [openId, setOpenId] = useState<string | null>(null)
  const [openTodoId, setOpenTodoId] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('antraege').select('*').order('created_at', { ascending: false })
    setAntraege(data ?? [])
  }

  // Notizen an ToDo-Karten (siehe "Notizen" in TodoDetailModal.tsx).
  async function loadTodoDocs() {
    const { data } = await supabase
      .from('summaries')
      .select('*')
      .not('todo_id', 'is', null)
      .order('erstellt_am', { ascending: false })
    setTodoDocs(data ?? [])
  }

  useEffect(() => {
    load()
    loadTodoDocs()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      const { data: mine } = await supabase.from('user_gremien').select('gremium').eq('user_id', data.user.id)
      const gremien = (mine ?? []).map((g) => g.gremium)
      if (gremien.length > 0) {
        const { data: sessions } = await supabase.from('sessions').select('*').in('gremium', gremien).order('datum')
        setOwnSessions(sessions ?? [])
      }
      const { data: fristen } = await supabase
        .from('antrag_deadline_settings')
        .select('*')
        .eq('user_id', data.user.id)
      setTageByEbene(
        new Map(((fristen ?? []) as AntragDeadlineSetting[]).map((f) => [f.ebene, f.tage_vor_sitzung])),
      )
    })
  }, [])

  // Die referenzierten ToDo-Karten nachladen (Titel, Erledigt-Status,
  // eigener Sitzungsbezug - nur die tatsächlich verlinkten, gleiches Muster
  // wie eventById/sessionById in TodoBoard).
  useEffect(() => {
    const todoIds = Array.from(new Set(todoDocs.map((d) => d.todo_id as string)))
    if (todoIds.length === 0) {
      setTodoById(new Map())
    } else {
      supabase
        .from('todos')
        .select('*')
        .in('id', todoIds)
        .then(({ data }) => setTodoById(new Map((data ?? []).map((t: TodoRow) => [t.id, t]))))
    }
  }, [todoDocs])

  // Verknüpfte Sitzungen (aus Anträgen und verknüpften ToDo-Karten)
  // nachladen (gleiches Muster wie eventById/sessionById in TodoBoard).
  useEffect(() => {
    const sessionIds = Array.from(
      new Set([
        ...antraege.filter((a) => a.session_id).map((a) => a.session_id as string),
        ...Array.from(todoById.values())
          .filter((t) => t.session_id)
          .map((t) => t.session_id as string),
      ]),
    )
    if (sessionIds.length === 0) {
      setSessionById(new Map())
    } else {
      supabase
        .from('sessions')
        .select('*')
        .in('id', sessionIds)
        .then(({ data }) => setSessionById(new Map((data ?? []).map((s: SessionRow) => [s.id, s]))))
    }

  }, [antraege, todoById])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!userId || !newTitel.trim()) return
    setAdding(true)
    setAddError(null)

    const session = newSessionId ? ownSessions.find((s) => s.id === newSessionId) : undefined
    const { error } = await supabase.from('antraege').insert({
      user_id: userId,
      titel: newTitel.trim(),
      session_id: newSessionId || null,
      ausschuss: session?.gremium ?? null,
      ebene: session?.ebene ?? null,
    })
    if (error) {
      setAddError(error.message)
      setAdding(false)
      return
    }

    setNewTitel('')
    setNewSessionId('')
    setAdding(false)
    setShowAddForm(false)
    await load()
  }

  const aktive = antraege.filter((a) => ANTRAG_STATUS_AKTIV.includes(a.status))

  const antragItems: DokumentItem[] = aktive.map((a) => ({
    key: `antrag-${a.id}`,
    kind: 'antrag',
    erstellt: a.created_at,
    sessionId: a.session_id,
    antrag: a,
    notizAnzahl: 0,
  }))
  // Mehrere Notizen derselben ToDo-Karte zu einer Zeile gruppiert - todoDocs
  // kommt bereits absteigend sortiert, die erste je todo_id ist die neueste.
  const docsByTodo = new Map<string, SummaryRow[]>()
  for (const d of todoDocs) {
    const list = docsByTodo.get(d.todo_id as string) ?? []
    list.push(d)
    docsByTodo.set(d.todo_id as string, list)
  }
  const todoItems: DokumentItem[] = Array.from(docsByTodo.entries()).map(([todoId, docs]) => {
    const todo = todoById.get(todoId)
    return {
      key: `todo-${todoId}`,
      kind: 'todo',
      erstellt: docs[0].erstellt_am,
      sessionId: todo?.session_id ?? null,
      todo,
      todoId,
      notizAnzahl: docs.length,
    }
  })
  const alleItems = [...antragItems, ...todoItems].sort((a, b) =>
    b.erstellt.localeCompare(a.erstellt),
  )

  // Gremien-Filter: ein Chip pro Gremium (nicht pro einzelner Sitzung - ein
  // Gremium tagt mehrfach im Jahr, "ein Chip pro Sitzungstermin" erzeugte
  // dieselbe Bezeichnung ("Rat der Stadt Iserlohn") mehrfach hintereinander
  // und war dadurch nicht mehr sinnvoll unterscheidbar), plus "Eigene
  // Anträge" für Anträge ohne Sitzungsbezug - keine wirkungslosen Filter
  // anzeigen. `gremium` statt `titel`, weil `titel` das rohe SUMMARY-Feld
  // aus dem ICS-Import ist (z. B. "Wahlprüfungsausschusses" statt
  // "Wahlprüfungsausschuss") - `gremium` ist die bereits bereinigte Form
  // (siehe extractGremium() in scripts/import-ics.mjs).
  const gremiumOf = (item: DokumentItem) => (item.sessionId ? sessionById.get(item.sessionId)?.gremium : null)
  const vorkommendeGremien = Array.from(new Set(alleItems.map(gremiumOf).filter((g): g is string => Boolean(g)))).sort(
    (a, b) => a.localeCompare(b, 'de'),
  )
  const hatEigeneOhneSitzung = antragItems.some((i) => !i.sessionId)
  const sichtbar = alleItems.filter((item) => {
    if (gremiumFilter === 'alle') return true
    if (gremiumFilter === 'eigene') return item.kind === 'antrag' && !item.sessionId
    return gremiumOf(item) === gremiumFilter
  })
  const abgeschlosseneAnzahl = antraege.length - aktive.length

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-slate-900">Meine Dokumente</h2>
          {abgeschlosseneAnzahl > 0 && (
            <Link to="/archiv" className="text-xs font-medium text-primary underline">
              {abgeschlosseneAnzahl} entschiedene im Archiv
            </Link>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className={showAddForm ? 'mc-btn-ghost' : 'mc-btn-primary'}
        >
          {showAddForm ? 'Abbrechen' : '+ Antrag'}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleAdd} className="mc-card mc-animate-pop mb-3 space-y-2.5 p-4">
          <input
            type="text"
            placeholder="Titel"
            value={newTitel}
            onChange={(e) => setNewTitel(e.target.value)}
            className="mc-input w-full"
            required
          />
          <select
            value={newSessionId}
            onChange={(e) => setNewSessionId(e.target.value)}
            className="mc-input w-full"
          >
            <option value="">Vorgesehene Sitzung (optional)</option>
            {ownSessions.map((se) => (
              <option key={se.id} value={se.id}>
                {se.titel} ({formatDate(se.datum)})
              </option>
            ))}
          </select>
          {addError && <p className="text-sm text-red-600">{addError}</p>}
          <button type="submit" disabled={adding} className="mc-btn-primary">
            {adding ? 'Anlegen...' : 'Antrag anlegen'}
          </button>
        </form>
      )}

      {(vorkommendeGremien.length > 0 || hatEigeneOhneSitzung) && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setGremiumFilter('alle')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              gremiumFilter === 'alle' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Alle
          </button>
          {vorkommendeGremien.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGremiumFilter(g)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                gremiumFilter === g ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {g}
            </button>
          ))}
          {hatEigeneOhneSitzung && (
            <button
              type="button"
              onClick={() => setGremiumFilter('eigene')}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                gremiumFilter === 'eigene' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Eigene Anträge
            </button>
          )}
        </div>
      )}

      <ul className="max-h-104 space-y-2 overflow-y-auto pr-1">
        {sichtbar.map((item) => {
          const session = item.sessionId ? sessionById.get(item.sessionId) : undefined

          if (item.kind === 'antrag') {
            const a = item.antrag!
            const deadline = computeAntragDeadline(session, a.ebene, tageByEbene)
            const ueberfaellig = deadline ? deadline.getTime() < jetzt && a.status === 'entwurf' : false
            return (
              <li key={item.key}>
                <div
                  onClick={() => setOpenId(a.id)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xs transition-shadow duration-150 hover:shadow-md"
                >
                  <span
                    className={`shrink-0 rounded-sm px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${antragBadgeClasses(a.status, a.ergebnis)}`}
                  >
                    {antragStatusLabel(a.status, a.ergebnis)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{a.titel}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      {a.ausschuss && (
                        <span className="truncate rounded-sm bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                          {a.ausschuss}
                        </span>
                      )}
                      {session ? (
                        <span className="truncate">🗳️ {session.titel} · {formatDate(session.datum)}</span>
                      ) : (
                        <span className="italic text-slate-400">Ohne Sitzungsbezug</span>
                      )}
                      {deadline && (
                        <span className={ueberfaellig ? 'font-semibold text-red-600' : ''}>
                          Frist {formatDate(deadline.toISOString())}
                          {ueberfaellig && ' · überfällig'}
                        </span>
                      )}
                    </span>
                  </span>
                </div>
              </li>
            )
          }

          if (item.kind === 'todo') {
            const todo = item.todo
            return (
              <li key={item.key}>
                <div
                  onClick={() => item.todoId && setOpenTodoId(item.todoId)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xs transition-shadow duration-150 hover:shadow-md"
                >
                  <span
                    className={`shrink-0 rounded-sm px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${todo?.erledigt ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}
                  >
                    {todo?.erledigt ? 'Erledigt' : 'ToDo'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm font-medium ${todo?.erledigt ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
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
          }

          return null
        })}
        {sichtbar.length === 0 && (
          <li className="rounded-xl border-2 border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            {alleItems.length === 0
              ? 'Noch nichts da. Über „+ Antrag" oben einen Antrag anlegen, oder an einer ToDo-Karte eine Notiz schreiben.'
              : 'Keine Dokumente für diese Auswahl.'}
          </li>
        )}
      </ul>

      {openId && <AntragDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
      {openTodoId && (
        <TodoDetailModal id={openTodoId} onClose={() => setOpenTodoId(null)} onChanged={loadTodoDocs} />
      )}
    </section>
  )
}
