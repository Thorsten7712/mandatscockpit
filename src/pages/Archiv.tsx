import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckSquare, FileText, Gavel, History } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type { AntragRow, CalendarSource, SessionRow, SummaryRow, TodoRow } from '../lib/types'
import { TerminDetailPanel } from '../components/TerminDetailPanel'
import { TodoDetailModal } from '../components/TodoDetailModal'
import { AntragDetailModal } from '../components/AntragDetailModal'
import { DocumentPreviewModal, fileNameFromPath } from '../components/DocumentPreviewModal'
import { formatDate, formatDateTime, formatDayMonth, formatTime, startOfTodayIso } from '../lib/format'
import { EBENE_LABEL, sourceColorById } from '../lib/sourceColors'
import { ANTRAG_STATUS_ABGESCHLOSSEN, ANTRAG_STATUS_BADGE, ANTRAG_STATUS_LABEL } from '../lib/antragStatus'

type Tab = 'sitzungen' | 'aufgaben' | 'dokumente' | 'antraege'

export default function Archiv() {
  const [tab, setTab] = useState<Tab>('sitzungen')

  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [notizenIds, setNotizenIds] = useState<Set<string>>(new Set())
  const [meineGremien, setMeineGremien] = useState<string[] | null>(null)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)

  const [completedTodos, setCompletedTodos] = useState<TodoRow[]>([])
  const [openTodoId, setOpenTodoId] = useState<string | null>(null)

  const [documents, setDocuments] = useState<SummaryRow[]>([])
  const [docLabels, setDocLabels] = useState<Map<string, string>>(new Map())
  const [previewDoc, setPreviewDoc] = useState<{ path: string; name: string } | null>(null)

  const [entschiedeneAntraege, setEntschiedeneAntraege] = useState<AntragRow[]>([])
  const [antragDocsById, setAntragDocsById] = useState<Map<string, SummaryRow>>(new Map())
  const [openAntragId, setOpenAntragId] = useState<string | null>(null)

  async function loadEntschiedeneAntraege() {
    const { data } = await supabase
      .from('antraege')
      .select('*')
      .in('status', ANTRAG_STATUS_ABGESCHLOSSEN)
      .order('created_at', { ascending: false })
    const rows = data ?? []
    setEntschiedeneAntraege(rows)

    const antragIds = rows.map((a) => a.id)
    if (antragIds.length === 0) {
      setAntragDocsById(new Map())
    } else {
      const { data: docs } = await supabase.from('summaries').select('*').in('antrag_id', antragIds).order('erstellt_am')
      const byId = new Map<string, SummaryRow>()
      for (const d of docs ?? []) {
        if (!byId.has(d.antrag_id as string)) byId.set(d.antrag_id as string, d)
      }
      setAntragDocsById(byId)
    }
  }

  async function loadSessions() {
    const { data: mine } = await supabase.auth.getUser()
    if (!mine.user) return
    const { data: gremienRows } = await supabase
      .from('user_gremien')
      .select('gremium')
      .eq('user_id', mine.user.id)
    const gremien = (gremienRows ?? []).map((g) => g.gremium)
    setMeineGremien(gremien)
    if (gremien.length === 0) {
      setSessions([])
      return
    }
    const { data } = await supabase
      .from('sessions')
      .select('*')
      .in('gremium', gremien)
      .lt('datum', startOfTodayIso())
      .order('datum', { ascending: false })
    setSessions(data ?? [])
  }

  async function loadNotizenFlags() {
    const { data } = await supabase.from('summaries').select('event_id, session_id')
    const ids = new Set<string>()
    ;(data ?? []).forEach((s) => {
      if (s.event_id) ids.add(s.event_id)
      if (s.session_id) ids.add(s.session_id)
    })
    setNotizenIds(ids)
  }

  async function loadCompletedTodos() {
    const { data } = await supabase
      .from('todos')
      .select('*')
      .eq('erledigt', true)
      .order('erledigt_am', { ascending: false })
    setCompletedTodos(data ?? [])
  }

  // Übersicht aller hochgeladenen Dokumente (summaries mit datei_url),
  // absteigend nach Datum. "Verknüpft mit"-Label kommt aus einer gezielten
  // Nachladung der referenzierten Sitzungen/Termine/Aufgaben (nur die
  // tatsächlich vorkommenden IDs, kein Volltabellen-Join nötig).
  async function loadDocuments() {
    const { data } = await supabase
      .from('summaries')
      .select('*')
      .not('datei_url', 'is', null)
      .order('erstellt_am', { ascending: false })
    const rows = data ?? []
    setDocuments(rows)

    const sessionIds = Array.from(new Set(rows.filter((r) => r.session_id).map((r) => r.session_id as string)))
    const eventIds = Array.from(new Set(rows.filter((r) => r.event_id).map((r) => r.event_id as string)))
    const todoIds = Array.from(new Set(rows.filter((r) => r.todo_id).map((r) => r.todo_id as string)))

    const labels = new Map<string, string>()
    if (sessionIds.length > 0) {
      const { data: s } = await supabase.from('sessions').select('id, titel').in('id', sessionIds)
      const byId = new Map((s ?? []).map((x) => [x.id, x.titel]))
      rows.forEach((r) => {
        if (r.session_id && byId.has(r.session_id)) labels.set(r.id, `Sitzung: ${byId.get(r.session_id)}`)
      })
    }
    if (eventIds.length > 0) {
      const { data: e } = await supabase.from('events').select('id, titel').in('id', eventIds)
      const byId = new Map((e ?? []).map((x) => [x.id, x.titel]))
      rows.forEach((r) => {
        if (r.event_id && byId.has(r.event_id)) labels.set(r.id, `Termin: ${byId.get(r.event_id)}`)
      })
    }
    if (todoIds.length > 0) {
      const { data: t } = await supabase.from('todos').select('id, titel').in('id', todoIds)
      const byId = new Map((t ?? []).map((x) => [x.id, x.titel]))
      rows.forEach((r) => {
        if (r.todo_id && byId.has(r.todo_id)) labels.set(r.id, `Aufgabe: ${byId.get(r.todo_id)}`)
      })
    }
    setDocLabels(labels)
  }

  useEffect(() => {
    loadSessions()
    loadNotizenFlags()
    loadCompletedTodos()
    loadDocuments()
    loadEntschiedeneAntraege()
    supabase
      .from('calendar_sources')
      .select('*')
      .then(({ data }) => setSources(data ?? []))
  }, [])

  const sourceById = new Map(sources.map((s) => [s.id, s]))

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="h-1.5 bg-topbar" aria-hidden="true" />
      <header className="bg-gradient-to-r from-primary to-primary-hover text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <h1 className="text-lg font-bold">Archiv</h1>
          <Link to="/" className="mc-btn px-3 py-1.5 text-sm text-white/90 hover:bg-white/15 hover:text-white">
            Zurück zum Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex gap-2">
          <button
            type="button"
            onClick={() => setTab('sitzungen')}
            className={tab === 'sitzungen' ? 'mc-btn-primary' : 'mc-btn-ghost'}
          >
            <History size={16} /> Vergangene Sitzungen
          </button>
          <button
            type="button"
            onClick={() => setTab('aufgaben')}
            className={tab === 'aufgaben' ? 'mc-btn-primary' : 'mc-btn-ghost'}
          >
            <CheckSquare size={16} /> Erledigte Aufgaben
          </button>
          <button
            type="button"
            onClick={() => setTab('dokumente')}
            className={tab === 'dokumente' ? 'mc-btn-primary' : 'mc-btn-ghost'}
          >
            <FileText size={16} /> Dokumente
          </button>
          <button
            type="button"
            onClick={() => setTab('antraege')}
            className={tab === 'antraege' ? 'mc-btn-primary' : 'mc-btn-ghost'}
          >
            <Gavel size={16} /> Anträge
          </button>
        </div>

        {tab === 'sitzungen' && (
          <section className="mc-animate-fade flex items-start gap-6">
            <div className="min-w-0 flex-1">
              <ul className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
                {sessions.map((s) => {
                  const { day, month } = formatDayMonth(s.datum)
                  const source = s.source_id ? sourceById.get(s.source_id) : undefined
                  const farbe = sourceColorById(source?.farbe)
                  const abgesagt = s.status === 'abgesagt'
                  const isSelected = selectedSession === s.id
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedSession(s.id)}
                        className={`flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition-[box-shadow,border-color] duration-150 hover:shadow-md ${abgesagt ? 'opacity-60' : ''} ${isSelected ? 'border-transparent ring-2 ring-primary' : 'border-slate-200'}`}
                      >
                        <span
                          className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg ${abgesagt ? 'bg-red-50 text-red-400' : farbe.chip}`}
                        >
                          <span className="text-base font-bold leading-none">{day}</span>
                          <span className="text-[10px] font-semibold uppercase leading-tight">{month}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`flex items-center gap-1.5 text-sm font-medium text-slate-900 ${abgesagt ? 'line-through' : ''}`}
                          >
                            <span className="truncate">{s.titel}</span>
                            {notizenIds.has(s.id) && (
                              <span className="shrink-0" title="Enthält Notizen/Dokumente">
                                📎
                              </span>
                            )}
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide no-underline ${farbe.chip}`}
                            >
                              {source ? (EBENE_LABEL[source.ebene] ?? 'Sitzung') : 'Sitzung'}
                            </span>
                            {abgesagt && (
                              <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-500 no-underline">
                                Abgesagt
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-slate-500">
                            {formatTime(s.datum)} Uhr
                            {s.ort && ` · ${s.ort}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
                {sessions.length === 0 && meineGremien?.length === 0 && (
                  <li className="mc-card p-6 text-center text-sm text-slate-400">
                    Keine Gremien ausgewählt. Unter{' '}
                    <Link to="/settings" className="font-medium text-primary underline">
                      Einstellungen
                    </Link>{' '}
                    die Gremien anhaken, in denen du ein Mandat hast.
                  </li>
                )}
                {sessions.length === 0 && meineGremien !== null && meineGremien.length > 0 && (
                  <li className="mc-card p-6 text-center text-sm text-slate-400">
                    Keine vergangenen Sitzungen.
                  </li>
                )}
              </ul>
            </div>

            <div className="min-w-0 flex-1">
              {selectedSession ? (
                <div className="mc-card mc-animate-slide p-5" key={selectedSession}>
                  <div className="mb-3 flex justify-end">
                    <button type="button" onClick={() => setSelectedSession(null)} className="mc-btn-ghost">
                      Schließen
                    </button>
                  </div>
                  <TerminDetailPanel kind="session" id={selectedSession} />
                </div>
              ) : (
                <div className="flex min-h-[10rem] items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-6 text-center">
                  <p className="text-sm text-slate-400">
                    Sitzung auswählen, um Details,
                    <br />
                    Notizen &amp; Dokumente zu sehen.
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {tab === 'aufgaben' && (
          <section className="mc-animate-fade max-w-2xl">
            <ul className="space-y-2">
              {completedTodos.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setOpenTodoId(t.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-shadow duration-150 hover:shadow-md"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-400 line-through">
                        {t.titel}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-slate-500">
                        {t.zustaendig && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5">👤 {t.zustaendig}</span>
                        )}
                        {t.erledigt_am && <span>Erledigt am {formatDate(t.erledigt_am)}</span>}
                        <span>Erstellt am {formatDate(t.created_at)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {completedTodos.length === 0 && (
                <li className="mc-card p-6 text-center text-sm text-slate-400">
                  Noch keine erledigten Aufgaben. Karten landen hier, sobald du sie als „Erledigt" markierst
                  oder auf eine Spalte namens „Fertig" ziehst.
                </li>
              )}
            </ul>
          </section>
        )}

        {tab === 'dokumente' && (
          <section className="mc-animate-fade max-w-2xl">
            <ul className="space-y-2">
              {documents.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewDoc({ path: d.datei_url!, name: fileNameFromPath(d.datei_url!) })
                    }
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-shadow duration-150 hover:shadow-md"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        📎 {fileNameFromPath(d.datei_url!)}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        {docLabels.get(d.id) && (
                          <span className="truncate rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                            {docLabels.get(d.id)}
                          </span>
                        )}
                        <span className="shrink-0">{formatDateTime(d.erstellt_am)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {documents.length === 0 && (
                <li className="mc-card p-6 text-center text-sm text-slate-400">
                  Noch keine Dokumente hochgeladen.
                </li>
              )}
            </ul>
          </section>
        )}

        {tab === 'antraege' && (
          <section className="mc-animate-fade max-w-2xl">
            <ul className="space-y-2">
              {entschiedeneAntraege.map((a) => {
                const doc = antragDocsById.get(a.id)
                return (
                  <li key={a.id}>
                    <div
                      onClick={() => setOpenAntragId(a.id)}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-shadow duration-150 hover:shadow-md"
                    >
                      <span
                        className={`shrink-0 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${ANTRAG_STATUS_BADGE[a.status]}`}
                      >
                        {ANTRAG_STATUS_LABEL[a.status]}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">{a.titel}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          {a.ausschuss && (
                            <span className="truncate rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                              {a.ausschuss}
                            </span>
                          )}
                          {doc?.datei_url ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setPreviewDoc({ path: doc.datei_url!, name: fileNameFromPath(doc.datei_url!) })
                              }}
                              className="mc-btn-ghost !px-1.5 !py-0.5 !text-xs"
                            >
                              📎 {fileNameFromPath(doc.datei_url)}
                            </button>
                          ) : (
                            <span className="italic text-slate-400">Kein Dokument hochgeladen</span>
                          )}
                          {a.eingereicht_am && <span>Eingereicht {formatDate(a.eingereicht_am)}</span>}
                        </span>
                      </span>
                    </div>
                  </li>
                )
              })}
              {entschiedeneAntraege.length === 0 && (
                <li className="mc-card p-6 text-center text-sm text-slate-400">
                  Noch keine entschiedenen Anträge. Landen hier, sobald ein Antrag als beschlossen, abgelehnt oder
                  zurückgezogen markiert wird.
                </li>
              )}
            </ul>
          </section>
        )}
      </div>

      {openTodoId && (
        <TodoDetailModal id={openTodoId} onClose={() => setOpenTodoId(null)} onChanged={loadCompletedTodos} />
      )}
      {openAntragId && (
        <AntragDetailModal
          id={openAntragId}
          onClose={() => setOpenAntragId(null)}
          onChanged={loadEntschiedeneAntraege}
        />
      )}
      {previewDoc && (
        <DocumentPreviewModal
          path={previewDoc.path}
          fileName={previewDoc.name}
          onClose={() => setPreviewDoc(null)}
        />
      )}
    </div>
  )
}
