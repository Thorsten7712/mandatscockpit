import { Link } from 'react-router-dom'
import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { CalendarSource, Ebene, EventRow, SessionRow } from '../lib/types'
import { TerminDetailPanel } from './TerminDetailPanel'
import { formatDayMonth, formatTime } from '../lib/format'
import { EBENE_LABEL, THEME_COLOR, sourceColorById } from '../lib/sourceColors'

// Cutoff für "zukünftige Termine" ist der Beginn des heutigen Tages (lokale
// Zeit), nicht der exakte aktuelle Zeitpunkt - sonst fallen bereits
// vergangene Termine von heute komplett raus, auch wenn heute später noch
// welche anstehen.
function startOfTodayIso(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

interface AggregatedItem {
  key: string
  kind: 'event' | 'session'
  id: string
  titel: string
  start: string
  ort: string | null
  abgesagt: boolean
  /** Kalenderquelle der Sitzung (null bei eigenen Terminen) */
  source_id: string | null
}

type TerminFilter = 'alle' | 'eigene' | Ebene

export function CalendarView() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [meineGremien, setMeineGremien] = useState<string[] | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ kind: 'event' | 'session'; id: string } | null>(null)
  const [notizenIds, setNotizenIds] = useState<Set<string>>(new Set())
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [filter, setFilter] = useState<TerminFilter>('alle')

  const [showAddForm, setShowAddForm] = useState(false)
  const [newTitel, setNewTitel] = useState('')
  const [newStart, setNewStart] = useState('')
  const [newEnde, setNewEnde] = useState('')
  const [newOrt, setNewOrt] = useState('')
  const [savingEvent, setSavingEvent] = useState(false)
  const [eventError, setEventError] = useState<string | null>(null)

  async function loadEvents() {
    const { data } = await supabase.from('events').select('*').gte('start', startOfTodayIso()).order('start')
    setEvents(data ?? [])
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

  useEffect(() => {
    loadEvents()
    loadNotizenFlags()
    // Quellen für Farbe + Ebene-Badge der Sitzungen in der Terminliste
    supabase
      .from('calendar_sources')
      .select('*')
      .then(({ data }) => setSources(data ?? []))
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      const { data: mine } = await supabase.from('user_gremien').select('gremium').eq('user_id', data.user.id)
      const gremien = (mine ?? []).map((g) => g.gremium)
      setMeineGremien(gremien)
      if (gremien.length === 0) {
        setSessions([])
        return
      }
      const { data: sessionRows } = await supabase
        .from('sessions')
        .select('*')
        .in('gremium', gremien)
        .gte('datum', startOfTodayIso())
        .order('datum')
      setSessions(sessionRows ?? [])
    })
  }, [])

  async function handleAddEvent(e: FormEvent) {
    e.preventDefault()
    if (!userId) return
    setSavingEvent(true)
    setEventError(null)
    const { error } = await supabase.from('events').insert({
      user_id: userId,
      erstellt_von: userId,
      titel: newTitel,
      start: new Date(newStart).toISOString(),
      ende: newEnde ? new Date(newEnde).toISOString() : null,
      ort: newOrt || null,
    })
    if (error) {
      setEventError(error.message)
    } else {
      setNewTitel('')
      setNewStart('')
      setNewEnde('')
      setNewOrt('')
      setShowAddForm(false)
      await loadEvents()
    }
    setSavingEvent(false)
  }

  const aggregated: AggregatedItem[] = [
    ...events.map((e) => ({
      key: `termin-${e.id}`,
      kind: 'event' as const,
      id: e.id,
      titel: e.titel,
      start: e.start,
      ort: e.ort,
      abgesagt: e.status === 'abgesagt',
      source_id: null,
    })),
    ...sessions.map((s) => ({
      key: `sitzung-${s.id}`,
      kind: 'session' as const,
      id: s.id,
      titel: s.titel,
      start: s.datum,
      ort: s.ort,
      abgesagt: s.status === 'abgesagt',
      source_id: s.source_id,
    })),
  ].sort((a, b) => a.start.localeCompare(b.start))

  const sourceById = new Map(sources.map((s) => [s.id, s]))

  // Filter-Chips: "Alle" immer, "Eigene Termine" nur wenn welche existieren,
  // je eine Ebene nur wenn sie unter den aktuellen Sitzungen vorkommt -
  // keine leeren/wirkungslosen Filter anzeigen.
  const ebenenPresent = new Set(
    sessions
      .map((s) => sourceById.get(s.source_id ?? '')?.ebene)
      .filter((e): e is Ebene => Boolean(e)),
  )
  const EBENEN_ORDER: Ebene[] = ['kommune', 'kreis', 'land', 'bund']
  const filterOptions: { value: TerminFilter; label: string }[] = [
    { value: 'alle', label: 'Alle' },
    ...(events.length > 0 ? [{ value: 'eigene' as TerminFilter, label: 'Eigene Termine' }] : []),
    ...EBENEN_ORDER.filter((e) => ebenenPresent.has(e)).map((e) => ({
      value: e as TerminFilter,
      label: EBENE_LABEL[e],
    })),
  ]

  const filtered = aggregated.filter((item) => {
    if (filter === 'alle') return true
    if (filter === 'eigene') return item.kind === 'event'
    if (item.kind !== 'session') return false
    return sourceById.get(item.source_id ?? '')?.ebene === filter
  })

  return (
    <section className="flex items-start gap-6">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Nächste Termine</h2>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className={showAddForm ? 'mc-btn-ghost' : 'mc-btn-primary'}
          >
            {showAddForm ? 'Abbrechen' : '+ Termin'}
          </button>
        </div>

        {filterOptions.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {filterOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFilter(opt.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  filter === opt.value
                    ? 'bg-primary text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {showAddForm && (
          <form onSubmit={handleAddEvent} className="mc-card mc-animate-pop mb-3 space-y-2.5 p-4">
            <input
              type="text"
              placeholder="Titel"
              value={newTitel}
              onChange={(e) => setNewTitel(e.target.value)}
              className="mc-input w-full"
              required
            />
            <div className="flex gap-2">
              <input
                type="datetime-local"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                className="mc-input flex-1"
                required
              />
              <input
                type="datetime-local"
                value={newEnde}
                onChange={(e) => setNewEnde(e.target.value)}
                className="mc-input flex-1"
                placeholder="Ende (optional)"
              />
            </div>
            <input
              type="text"
              placeholder="Ort (optional)"
              value={newOrt}
              onChange={(e) => setNewOrt(e.target.value)}
              className="mc-input w-full"
            />
            {eventError && <p className="text-sm text-red-600">{eventError}</p>}
            <button type="submit" disabled={savingEvent || !userId} className="mc-btn-primary">
              {savingEvent ? 'Speichern...' : 'Termin hinzufügen'}
            </button>
          </form>
        )}

        <ul className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
          {filtered.map((item) => {
            const { day, month } = formatDayMonth(item.start)
            const isSelected = selected?.id === item.id
            // Sitzungen tragen die Farbe ihrer Kalenderquelle (Ebene auf
            // einen Blick), eigene Termine die Theme-Primärfarbe.
            const source = item.source_id ? sourceById.get(item.source_id) : undefined
            const farbe = item.kind === 'session' ? sourceColorById(source?.farbe) : THEME_COLOR
            const badgeText =
              item.kind === 'session' ? (source ? (EBENE_LABEL[source.ebene] ?? 'Sitzung') : 'Sitzung') : null
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => setSelected({ kind: item.kind, id: item.id })}
                  className={`flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition-[box-shadow,border-color] duration-150 hover:shadow-md ${item.abgesagt ? 'opacity-60' : ''} ${isSelected ? 'border-transparent ring-2 ring-primary' : 'border-slate-200'}`}
                >
                  <span
                    className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg ${item.abgesagt ? 'bg-red-50 text-red-400' : farbe.chip}`}
                  >
                    <span className="text-base font-bold leading-none">{day}</span>
                    <span className="text-[10px] font-semibold uppercase leading-tight">{month}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`flex items-center gap-1.5 text-sm font-medium text-slate-900 ${item.abgesagt ? 'line-through' : ''}`}
                    >
                      <span className="truncate">{item.titel}</span>
                      {notizenIds.has(item.id) && (
                        <span className="shrink-0" title="Enthält Notizen/Dokumente">
                          📎
                        </span>
                      )}
                      {badgeText && (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide no-underline ${farbe.chip}`}
                        >
                          {badgeText}
                        </span>
                      )}
                      {item.abgesagt && (
                        <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-500 no-underline">
                          Abgesagt
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {formatTime(item.start)} Uhr
                      {item.ort && ` · ${item.ort}`}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
          {aggregated.length === 0 && meineGremien?.length === 0 && (
            <li className="mc-card p-6 text-center text-sm text-slate-400">
              Keine anstehenden Termine. Unter{' '}
              <Link to="/settings" className="font-medium text-primary underline">
                Einstellungen
              </Link>{' '}
              die Gremien anhaken, in denen du ein Mandat hast, um Sitzungstermine zu sehen.
            </li>
          )}
          {aggregated.length === 0 && meineGremien !== null && meineGremien.length > 0 && (
            <li className="mc-card p-6 text-center text-sm text-slate-400">Keine anstehenden Termine.</li>
          )}
          {aggregated.length > 0 && filtered.length === 0 && (
            <li className="mc-card p-6 text-center text-sm text-slate-400">Keine Termine für diesen Filter.</li>
          )}
        </ul>
      </div>

      <div className="min-w-0 flex-1">
        {selected ? (
          <div className="mc-card mc-animate-slide p-5" key={`${selected.kind}-${selected.id}`}>
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setSelected(null)
                  loadNotizenFlags()
                }}
                className="mc-btn-ghost"
              >
                Schließen
              </button>
            </div>
            <TerminDetailPanel
              kind={selected.kind}
              id={selected.id}
              onDeleted={() => {
                setSelected(null)
                loadEvents()
                loadNotizenFlags()
              }}
            />
          </div>
        ) : (
          <div className="flex min-h-[10rem] items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-6 text-center">
            <p className="text-sm text-slate-400">
              Termin auswählen, um Details,
              <br />
              Notizen &amp; Dokumente zu sehen.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
