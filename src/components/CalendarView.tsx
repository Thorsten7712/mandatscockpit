import { Link } from 'react-router-dom'
import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { EventRow, SessionRow } from '../lib/types'
import { TerminDetailPanel } from './TerminDetailPanel'

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
}

export function CalendarView() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [meineGremien, setMeineGremien] = useState<string[] | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ kind: 'event' | 'session'; id: string } | null>(null)
  const [notizenIds, setNotizenIds] = useState<Set<string>>(new Set())

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
    })),
    ...sessions.map((s) => ({
      key: `sitzung-${s.id}`,
      kind: 'session' as const,
      id: s.id,
      titel: s.titel,
      start: s.datum,
      ort: s.ort,
      abgesagt: s.status === 'abgesagt',
    })),
  ].sort((a, b) => a.start.localeCompare(b.start))

  return (
    <section className="flex gap-6 items-start">
      <div className="flex-1 min-w-0 max-w-md">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Nächste Termine</h2>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="text-sm text-slate-600 underline"
          >
            {showAddForm ? 'Abbrechen' : '+ Termin'}
          </button>
        </div>

        {showAddForm && (
          <form onSubmit={handleAddEvent} className="space-y-2 bg-white border rounded p-3 mb-3">
            <input
              type="text"
              placeholder="Titel"
              value={newTitel}
              onChange={(e) => setNewTitel(e.target.value)}
              className="w-full border rounded px-2 py-1"
              required
            />
            <div className="flex gap-2">
              <input
                type="datetime-local"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                className="flex-1 border rounded px-2 py-1"
                required
              />
              <input
                type="datetime-local"
                value={newEnde}
                onChange={(e) => setNewEnde(e.target.value)}
                className="flex-1 border rounded px-2 py-1"
                placeholder="Ende (optional)"
              />
            </div>
            <input
              type="text"
              placeholder="Ort (optional)"
              value={newOrt}
              onChange={(e) => setNewOrt(e.target.value)}
              className="w-full border rounded px-2 py-1"
            />
            {eventError && <p className="text-red-600 text-sm">{eventError}</p>}
            <button
              type="submit"
              disabled={savingEvent || !userId}
              className="bg-slate-900 text-white rounded px-3 py-1 text-sm disabled:opacity-50"
            >
              {savingEvent ? 'Speichern...' : 'Termin hinzufügen'}
            </button>
          </form>
        )}

        <ul className="space-y-1 max-h-72 overflow-y-auto">
          {aggregated.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => setSelected({ kind: item.kind, id: item.id })}
                className={`w-full text-left border rounded px-3 py-2 flex items-center justify-between bg-white hover:bg-slate-50 ${item.abgesagt ? 'opacity-60' : ''} ${selected?.id === item.id ? 'ring-2 ring-slate-400' : ''}`}
              >
                <span className={item.abgesagt ? 'line-through' : ''}>
                  {notizenIds.has(item.id) && <span title="Enthält Notizen/Dokumente">📎 </span>}
                  {item.titel}
                  {item.kind === 'session' && <span className="text-xs text-slate-400"> · Sitzung</span>}
                  {item.abgesagt && <span className="text-xs text-red-500 no-underline"> · abgesagt</span>}
                </span>
                <span className="text-xs text-slate-500">
                  {new Date(item.start).toLocaleString('de-DE')}
                  {item.ort && ` · ${item.ort}`}
                </span>
              </button>
            </li>
          ))}
          {aggregated.length === 0 && meineGremien?.length === 0 && (
            <li className="text-slate-400 text-sm">
              Keine anstehenden Termine. Unter{' '}
              <Link to="/settings" className="underline">
                Einstellungen
              </Link>{' '}
              die Gremien anhaken, in denen du ein Mandat hast, um Sitzungstermine zu sehen.
            </li>
          )}
          {aggregated.length === 0 && meineGremien !== null && meineGremien.length > 0 && (
            <li className="text-slate-400 text-sm">Keine anstehenden Termine.</li>
          )}
        </ul>
      </div>

      <div className="flex-1 min-w-0 max-w-md">
        {selected ? (
          <div>
            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={() => {
                  setSelected(null)
                  loadNotizenFlags()
                }}
                className="text-sm text-slate-600 underline"
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
          <p className="text-slate-400 text-sm">Termin auswählen, um Details zu sehen.</p>
        )}
      </div>
    </section>
  )
}
