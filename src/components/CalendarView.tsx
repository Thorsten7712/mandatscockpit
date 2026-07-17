import { Link } from 'react-router-dom'
import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { EventRow, SessionRow } from '../lib/types'

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

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
  titel: string
  start: string
  ort: string | null
  kind: 'termin' | 'sitzung'
}

export function CalendarView() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [meineGremien, setMeineGremien] = useState<string[] | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  const [newTitel, setNewTitel] = useState('')
  const [newStart, setNewStart] = useState('')
  const [newEnde, setNewEnde] = useState('')
  const [newOrt, setNewOrt] = useState('')
  const [savingEvent, setSavingEvent] = useState(false)
  const [eventError, setEventError] = useState<string | null>(null)

  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [editTitel, setEditTitel] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnde, setEditEnde] = useState('')
  const [editOrt, setEditOrt] = useState('')
  const [editEventSaving, setEditEventSaving] = useState(false)
  const [editEventError, setEditEventError] = useState<string | null>(null)

  async function loadEvents() {
    const { data } = await supabase.from('events').select('*').gte('start', startOfTodayIso()).order('start')
    setEvents(data ?? [])
  }

  useEffect(() => {
    loadEvents()
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
      await loadEvents()
    }
    setSavingEvent(false)
  }

  function startEditEvent(e: EventRow) {
    setEditingEventId(e.id)
    setEditTitel(e.titel)
    setEditStart(toDatetimeLocalValue(e.start))
    setEditEnde(e.ende ? toDatetimeLocalValue(e.ende) : '')
    setEditOrt(e.ort ?? '')
    setEditEventError(null)
  }

  function cancelEditEvent() {
    setEditingEventId(null)
    setEditEventError(null)
  }

  async function handleSaveEditEvent(e: FormEvent) {
    e.preventDefault()
    if (!editingEventId) return
    setEditEventSaving(true)
    setEditEventError(null)
    const { error } = await supabase
      .from('events')
      .update({
        titel: editTitel,
        start: new Date(editStart).toISOString(),
        ende: editEnde ? new Date(editEnde).toISOString() : null,
        ort: editOrt || null,
      })
      .eq('id', editingEventId)
    if (error) {
      setEditEventError(error.message)
    } else {
      setEditingEventId(null)
      await loadEvents()
    }
    setEditEventSaving(false)
  }

  async function handleDeleteEvent(id: string) {
    await supabase.from('events').delete().eq('id', id)
    await loadEvents()
  }

  const aggregated: AggregatedItem[] = [
    ...events.map((e) => ({ key: `termin-${e.id}`, titel: e.titel, start: e.start, ort: e.ort, kind: 'termin' as const })),
    ...sessions.map((s) => ({ key: `sitzung-${s.id}`, titel: s.titel, start: s.datum, ort: s.ort, kind: 'sitzung' as const })),
  ].sort((a, b) => a.start.localeCompare(b.start))

  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-semibold mb-2">Nächste Termine</h2>
        <ul className="space-y-1">
          {aggregated.map((item) => (
            <li key={item.key} className="border rounded px-3 py-2 flex items-center justify-between bg-white">
              <span>
                {item.titel}
                {item.kind === 'sitzung' && <span className="text-xs text-slate-400"> · Sitzung</span>}
              </span>
              <span className="text-xs text-slate-500">
                {new Date(item.start).toLocaleString('de-DE')}
                {item.ort && ` · ${item.ort}`}
              </span>
            </li>
          ))}
          {aggregated.length === 0 && <li className="text-slate-400 text-sm">Keine anstehenden Termine.</li>}
        </ul>
      </section>
      <section>
        <h2 className="font-semibold mb-2">Eigene Termine</h2>
        <ul className="space-y-1 mb-3">
          {events.map((e) => {
            if (editingEventId === e.id) {
              return (
                <li key={e.id} className="border rounded px-3 py-2 bg-white">
                  <form onSubmit={handleSaveEditEvent} className="space-y-2">
                    <input
                      type="text"
                      value={editTitel}
                      onChange={(ev) => setEditTitel(ev.target.value)}
                      className="w-full border rounded px-2 py-1"
                      required
                    />
                    <div className="flex gap-2">
                      <input
                        type="datetime-local"
                        value={editStart}
                        onChange={(ev) => setEditStart(ev.target.value)}
                        className="flex-1 border rounded px-2 py-1"
                        required
                      />
                      <input
                        type="datetime-local"
                        value={editEnde}
                        onChange={(ev) => setEditEnde(ev.target.value)}
                        className="flex-1 border rounded px-2 py-1"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Ort (optional)"
                      value={editOrt}
                      onChange={(ev) => setEditOrt(ev.target.value)}
                      className="w-full border rounded px-2 py-1"
                    />
                    {editEventError && <p className="text-red-600 text-sm">{editEventError}</p>}
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={editEventSaving}
                        className="bg-slate-900 text-white rounded px-3 py-1 text-sm disabled:opacity-50"
                      >
                        {editEventSaving ? 'Speichern...' : 'Speichern'}
                      </button>
                      <button type="button" onClick={cancelEditEvent} className="text-sm text-slate-600 underline">
                        Abbrechen
                      </button>
                    </div>
                  </form>
                </li>
              )
            }
            return (
              <li key={e.id} className="border rounded px-3 py-2 flex items-center justify-between bg-white">
                <span>{e.titel}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">
                    {new Date(e.start).toLocaleString('de-DE')}
                    {e.ort && ` · ${e.ort}`}
                    {e.herkunft === 'fraktionsbuero' && ' · vom Fraktionsbüro'}
                  </span>
                  <button
                    type="button"
                    onClick={() => startEditEvent(e)}
                    className="text-xs text-slate-600 underline"
                  >
                    Bearbeiten
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteEvent(e.id)}
                    className="text-xs text-red-500 underline"
                  >
                    Löschen
                  </button>
                </div>
              </li>
            )
          })}
          {events.length === 0 && <li className="text-slate-400 text-sm">Noch keine Termine.</li>}
        </ul>
        <form onSubmit={handleAddEvent} className="space-y-2 bg-white border rounded p-3">
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
      </section>
      <section>
        <h2 className="font-semibold mb-2">Sitzungstermine (importiert)</h2>
        <ul className="space-y-1">
          {sessions.map((s) => (
            <li key={s.id} className="border rounded px-3 py-2 flex justify-between bg-white">
              <span>{s.titel}</span>
              <span className="text-xs text-slate-500">
                {new Date(s.datum).toLocaleString('de-DE')}
                {s.ort && ` · ${s.ort}`}
              </span>
            </li>
          ))}
          {sessions.length === 0 && meineGremien?.length === 0 && (
            <li className="text-slate-400 text-sm">
              Noch keine Gremien ausgewählt. Unter{' '}
              <Link to="/settings" className="underline">
                Einstellungen
              </Link>{' '}
              die Gremien anhaken, in denen du ein Mandat hast.
            </li>
          )}
          {sessions.length === 0 && meineGremien !== null && meineGremien.length > 0 && (
            <li className="text-slate-400 text-sm">
              Keine importierten Sitzungen für deine Gremien gefunden. Der ICS-Import-Job läuft täglich
              04:00 UTC (siehe README.md Abschnitt 7) – oder unter Actions → „ICS-Kalenderquellen
              importieren" manuell auslösen.
            </li>
          )}
        </ul>
      </section>
    </div>
  )
}
