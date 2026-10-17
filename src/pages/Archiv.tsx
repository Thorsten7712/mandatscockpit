import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Archive, CheckSquare, FileText, Gavel, History, Plus } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { ladeTermineMitNotizen } from '../lib/notizFlags'
import type { AntragRow, CalendarSource, DokumentRow, Ebene, SessionRow, TodoRow } from '../lib/types'
import { TerminDetailModal } from '../components/TerminDetailModal'
import { TodoDetailModal } from '../components/TodoDetailModal'
import { AntragDetailModal } from '../components/AntragDetailModal'
import { DokumentDetailModal } from '../components/DokumentDetailModal'
import { fileNameFromPath } from '../lib/dateien'
import { formatDate, formatDateTime, formatDayMonth, formatTime, startOfTodayIso } from '../lib/format'
import { EBENE_COLOR, EBENE_LABEL, sourceColorById, tagColor } from '../lib/sourceColors'
import { archivGrund, ladeSitzungenJeDokument, type SitzungenJeDokument } from '../lib/dokumenteArchiv'
import { alleZeilen } from '../lib/alleZeilen'
import { ANTRAG_STATUS_ABGESCHLOSSEN, antragBadgeClasses, antragStatusLabel } from '../lib/antragStatus'

type Tab = 'sitzungen' | 'aufgaben' | 'dokumente' | 'antraege'

// Gleiche Liste wie in Settings.tsx (Kalenderquellen-Formular) und
// TerminDetailPanel.tsx (Sitzung bearbeiten) - bewusst dupliziert, siehe
// CLAUDE.md.
const EBENEN: { value: Ebene; label: string }[] = [
  { value: 'kommune', label: 'Kommune' },
  { value: 'kreis', label: 'Kreis' },
  { value: 'land', label: 'Land' },
  { value: 'bund', label: 'Bund' },
]

export default function Archiv() {
  const [tab, setTab] = useState<Tab>('sitzungen')

  const [userId, setUserId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [notizenIds, setNotizenIds] = useState<Set<string>>(new Set())
  const [meineGremien, setMeineGremien] = useState<string[] | null>(null)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)

  const [showNewSession, setShowNewSession] = useState(false)
  const [newTitel, setNewTitel] = useState('')
  const [newGremium, setNewGremium] = useState('')
  const [newEbene, setNewEbene] = useState<Ebene>('kommune')
  const [newDatum, setNewDatum] = useState('')
  const [newOrt, setNewOrt] = useState('')
  const [newSourceId, setNewSourceId] = useState('')
  const [newSaving, setNewSaving] = useState(false)
  const [newError, setNewError] = useState<string | null>(null)

  const [completedTodos, setCompletedTodos] = useState<TodoRow[]>([])
  const [openTodoId, setOpenTodoId] = useState<string | null>(null)


  // Archivierte Dokumente aus dem Dokumenten-Hub (Dokumente.tsx), siehe
  // src/lib/dokumenteArchiv.ts für die Archiv-Regel.
  const [hubDokumente, setHubDokumente] = useState<DokumentRow[]>([])
  const [hubSitzungen, setHubSitzungen] = useState<SitzungenJeDokument>(new Map())
  const [openHubDoc, setOpenHubDoc] = useState<DokumentRow | null>(null)

  const [entschiedeneAntraege, setEntschiedeneAntraege] = useState<AntragRow[]>([])
  const [openAntragId, setOpenAntragId] = useState<string | null>(null)

  async function loadEntschiedeneAntraege() {
    const { data } = await supabase
      .from('antraege')
      .select('*')
      .in('status', ANTRAG_STATUS_ABGESCHLOSSEN)
      .order('created_at', { ascending: false })
    const rows = data ?? []
    setEntschiedeneAntraege(rows)

  }

  // Sitzungen aus "sitzung"-Quellen (gremienweise gefiltert) und aus
  // "termin"-Quellen (reiner Terminkalender, ungefiltert) getrennt laden und
  // mergen - zwei .in()-Abfragen statt eines rohen .or()-Strings, damit
  // Gremiennamen mit Kommas/Klammern nicht das PostgREST-Filter-Format
  // brechen (siehe CLAUDE.md). currentSources wird explizit übergeben statt
  // aus dem sources-State gelesen, da loadSessions() beim initialen Laden
  // vor dem sources-State-Update aufgerufen wird (React-State ist erst nach
  // dem Re-Render aktuell).
  async function loadSessions(currentSources: CalendarSource[]) {
    const { data: mine } = await supabase.auth.getUser()
    if (!mine.user) return
    setUserId(mine.user.id)
    const { data: gremienRows } = await supabase
      .from('user_gremien')
      .select('gremium')
      .eq('user_id', mine.user.id)
    const gremien = (gremienRows ?? []).map((g) => g.gremium)
    setMeineGremien(gremien)
    const terminSourceIds = currentSources.filter((s) => s.art === 'termin').map((s) => s.id)

    // Seitenweise (src/lib/alleZeilen.ts): vergangene Sitzungen wachsen jeden
    // Tag, allein die Fraktions-Terminquelle bringt über 400 Einträge mit.
    const stichtag = startOfTodayIso()
    const [byGremium, byTerminSource] = await Promise.all([
      gremien.length > 0
        ? alleZeilen<SessionRow>((von, bis) =>
            supabase.from('sessions').select('*').in('gremium', gremien).lt('datum', stichtag).order('id').range(von, bis),
          )
        : Promise.resolve({ zeilen: [] as SessionRow[] }),
      terminSourceIds.length > 0
        ? alleZeilen<SessionRow>((von, bis) =>
            supabase.from('sessions').select('*').in('source_id', terminSourceIds).lt('datum', stichtag).order('id').range(von, bis),
          )
        : Promise.resolve({ zeilen: [] as SessionRow[] }),
    ])
    const byId = new Map<string, SessionRow>()
    ;[...byGremium.zeilen, ...byTerminSource.zeilen].forEach((s) => byId.set(s.id, s))
    setSessions(Array.from(byId.values()).sort((a, b) => b.datum.localeCompare(a.datum)))
  }

  // Manuell nachgetragene Sitzung (supabase/migrations/0028, source_id-Wahl
  // seit 0029) - für Gremien ohne ICS-Feed bzw. um vergangene, nie
  // importierte Sitzungen zu erfassen, damit sich dort im Anschluss
  // Dokumente/Notizen verknüpfen lassen. Öffnet danach direkt die
  // Detailansicht, statt nur die Liste zu aktualisieren.
  async function handleCreateSession(e: FormEvent) {
    e.preventDefault()
    if (!userId || !newDatum) return
    setNewSaving(true)
    setNewError(null)
    const source = sources.find((s) => s.id === newSourceId)
    const { data, error } = await supabase
      .from('sessions')
      .insert({
        titel: newTitel,
        gremium: newGremium || null,
        ebene: source?.ebene ?? newEbene,
        datum: new Date(newDatum).toISOString(),
        ort: newOrt || null,
        source_id: newSourceId || null,
        erstellt_von: userId,
      })
      .select('id')
      .single()
    if (error || !data) {
      setNewError(error?.message ?? 'Sitzung konnte nicht angelegt werden.')
      setNewSaving(false)
      return
    }
    // Neues Gremium automatisch zu "Meine Gremien" hinzufügen, sonst würde
    // die eben angelegte Sitzung durch den .in('gremium', gremien)-Filter
    // oben sofort wieder aus der Liste herausfallen.
    if (newGremium && !(meineGremien ?? []).includes(newGremium)) {
      await supabase.from('user_gremien').insert({ user_id: userId, gremium: newGremium })
    }
    setNewTitel('')
    setNewGremium('')
    setNewEbene('kommune')
    setNewDatum('')
    setNewOrt('')
    setNewSourceId('')
    setShowNewSession(false)
    setNewSaving(false)
    await loadSessions(sources)
    setSelectedSession(data.id)
  }

  async function loadNotizenFlags() {
    setNotizenIds(await ladeTermineMitNotizen())
  }


  async function loadCompletedTodos() {
    const { data } = await supabase
      .from('todos')
      .select('*')
      .eq('erledigt', true)
      .order('erledigt_am', { ascending: false })
    setCompletedTodos(data ?? [])
  }

  // Top-Level-Dokumente des Dokumenten-Hubs samt Datum der verknüpften
  // Sitzungen; welche davon archiviert sind, entscheidet archivGrund() beim
  // Rendern (src/lib/dokumenteArchiv.ts). Bewusst nicht server-seitig
  // gefiltert: die Archiv-Regel hängt an sessions.datum, nicht an einer
  // Spalte von dokumente, und ist in PostgREST nicht in einer Abfrage
  // ausdrückbar.
  async function loadHubDokumente() {
    // Seitenweise, siehe src/lib/alleZeilen.ts - sonst fehlten ab 1.000
    // Dokumenten die ältesten, also gerade das, was ins Archiv gehört.
    const { zeilen: rows } = await alleZeilen<DokumentRow>((von, bis) =>
      supabase
        .from('dokumente')
        .select('*')
        .is('parent_id', null)
        .order('erstellt_am', { ascending: false })
        .order('id')
        .range(von, bis),
    )
    const { sitzungen } = await ladeSitzungenJeDokument(supabase, rows.map((r) => r.id))
    setHubSitzungen(sitzungen)
    setHubDokumente(rows)
  }

  useEffect(() => {
    loadNotizenFlags()
    loadCompletedTodos()
    loadHubDokumente()
    loadEntschiedeneAntraege()
    supabase
      .from('calendar_sources')
      .select('*')
      .then(({ data }) => {
        const rows = data ?? []
        setSources(rows)
        loadSessions(rows)
      })
  }, [])

  const sourceById = new Map(sources.map((s) => [s.id, s]))

  // Der Dokumente-Reiter zeigt die archivierten Dokumente aus dem
  // Dokumenten-Hub. Die früher hier mitgezeigten Datei-Uploads an Sitzungen
  // und Aufgaben gibt es seit 0052/0055 nicht mehr.
  const archivierteHubDokumente = hubDokumente
    .map((d) => ({ dokument: d, grund: archivGrund(d, hubSitzungen) }))
    .filter((e): e is { dokument: DokumentRow; grund: NonNullable<ReturnType<typeof archivGrund>> } => e.grund !== null)

  const archivDokumente = archivierteHubDokumente
    .map(({ dokument, grund }) => ({ id: dokument.id, datum: dokument.erstellt_am, row: dokument, grund }))
    .sort((a, b) => Date.parse(b.datum) - Date.parse(a.datum))

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="h-1.5 bg-topbar" aria-hidden="true" />
      <header className="bg-linear-to-r from-primary to-primary-hover text-white shadow-md">
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
          <section className="mc-animate-fade max-w-2xl">
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => setShowNewSession((v) => !v)}
                className="mc-btn-ghost text-xs!"
              >
                <Plus size={14} /> Sitzung nachtragen
              </button>
            </div>
            {showNewSession && (
              <form onSubmit={handleCreateSession} className="mc-card mb-4 space-y-2 p-4">
                <input
                  type="text"
                  placeholder="Titel (z. B. Bauausschuss – Sitzung)"
                  value={newTitel}
                  onChange={(e) => setNewTitel(e.target.value)}
                  className="mc-input w-full"
                  required
                />
                <div>
                  <label className="mb-1 block text-xs text-slate-500" htmlFor="new-session-source">
                    Kalenderquelle (optional – für einheitliche Farbe/Bezeichnung wie importierte
                    Sitzungen derselben Quelle)
                  </label>
                  <select
                    id="new-session-source"
                    value={newSourceId}
                    onChange={(e) => {
                      const id = e.target.value
                      setNewSourceId(id)
                      const source = sources.find((s) => s.id === id)
                      if (source) setNewEbene(source.ebene)
                    }}
                    className="mc-input w-full"
                  >
                    <option value="">Keine – eigenständige Sitzung</option>
                    {sources
                      .filter((s) => s.art === 'sitzung')
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Gremium"
                    value={newGremium}
                    onChange={(e) => setNewGremium(e.target.value)}
                    className="mc-input flex-1"
                  />
                  <select
                    value={newEbene}
                    onChange={(e) => setNewEbene(e.target.value as Ebene)}
                    disabled={!!newSourceId}
                    className="mc-input flex-1 disabled:opacity-60"
                  >
                    {EBENEN.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <input
                    type="datetime-local"
                    value={newDatum}
                    onChange={(e) => setNewDatum(e.target.value)}
                    className="mc-input flex-1"
                    required
                  />
                  <input
                    type="text"
                    placeholder="Ort (optional)"
                    value={newOrt}
                    onChange={(e) => setNewOrt(e.target.value)}
                    className="mc-input flex-1"
                  />
                </div>
                {newError && <p className="text-red-600 text-sm">{newError}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={newSaving} className="mc-btn-primary">
                    {newSaving ? 'Speichern...' : 'Anlegen'}
                  </button>
                  <button type="button" onClick={() => setShowNewSession(false)} className="mc-btn-ghost">
                    Abbrechen
                  </button>
                </div>
              </form>
            )}
            <ul className="max-h-128 space-y-2 overflow-y-auto pr-1">
              {sessions.map((s) => {
                const { day, month } = formatDayMonth(s.datum)
                const source = s.source_id ? sourceById.get(s.source_id) : undefined
                const farbe = sourceColorById(source?.farbe)
                const abgesagt = s.status === 'abgesagt'
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedSession(s.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xs transition-shadow duration-150 hover:shadow-md ${abgesagt ? 'opacity-60' : ''}`}
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
                            <span className="shrink-0" title="Aufgaben mit Notizen">
                              📝
                            </span>
                          )}
                          <span
                            className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide no-underline ${farbe.chip}`}
                          >
                            {EBENE_LABEL[source?.ebene ?? s.ebene ?? ''] ?? 'Sitzung'}
                          </span>
                          {abgesagt && (
                            <span className="shrink-0 rounded-sm bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-500 no-underline">
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
          </section>
        )}

        {selectedSession && (
          <TerminDetailModal kind="session" id={selectedSession} onClose={() => setSelectedSession(null)} />
        )}

        {tab === 'aufgaben' && (
          <section className="mc-animate-fade max-w-2xl">
            <ul className="space-y-2">
              {completedTodos.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setOpenTodoId(t.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xs transition-shadow duration-150 hover:shadow-md"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-400 line-through">
                        {t.titel}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-slate-500">
                        {t.zustaendig && (
                          <span className="rounded-sm bg-slate-100 px-1.5 py-0.5">👤 {t.zustaendig}</span>
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
              {archivDokumente.map((eintrag) => (
                  <li key={`hub-${eintrag.id}`}>
                    <button
                      type="button"
                      onClick={() => setOpenHubDoc(eintrag.row)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xs transition-shadow duration-150 hover:shadow-md"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-slate-900">{eintrag.row.titel}</span>
                          {eintrag.row.ebene && (
                            <span
                              className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${EBENE_COLOR[eintrag.row.ebene].chip}`}
                            >
                              {EBENE_LABEL[eintrag.row.ebene]}
                            </span>
                          )}
                          {eintrag.row.tags.map((t) => (
                            <span
                              key={t}
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${tagColor(t).chip}`}
                            >
                              {t}
                            </span>
                          ))}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-slate-100 px-1.5 py-0.5 font-medium">
                            <Archive className="h-3 w-3" />
                            {eintrag.grund === 'sitzung'
                              ? (hubSitzungen.get(eintrag.row.id) ?? [])
                                  .map((si) => si.titel)
                                  .join(', ') || 'Vergangene Sitzung'
                              : 'Von Hand archiviert'}
                          </span>
                          {eintrag.row.datei_url && (
                            <span className="truncate">📎 {fileNameFromPath(eintrag.row.datei_url)}</span>
                          )}
                          <span className="shrink-0">{formatDateTime(eintrag.row.erstellt_am)}</span>
                        </span>
                      </span>
                    </button>
                  </li>
              ))}
              {archivDokumente.length === 0 && (
                <li className="mc-card p-6 text-center text-sm text-slate-400">
                  Noch keine archivierten Dokumente. Dokumente aus dem Dokumenten-Hub landen hier, sobald ihre
                  verknüpfte Sitzung vorbei ist oder sie von Hand archiviert werden.
                </li>
              )}
            </ul>
          </section>
        )}

        {tab === 'antraege' && (
          <section className="mc-animate-fade max-w-2xl">
            <ul className="space-y-2">
              {entschiedeneAntraege.map((a) => {
                return (
                  <li key={a.id}>
                    <div
                      onClick={() => setOpenAntragId(a.id)}
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
      {openHubDoc && (
        <DokumentDetailModal
          document={openHubDoc}
          onClose={() => {
            setOpenHubDoc(null)
            loadHubDokumente()
          }}
          onDeleted={() => {
            setOpenHubDoc(null)
            loadHubDokumente()
          }}
        />
      )}
    </div>
  )
}
