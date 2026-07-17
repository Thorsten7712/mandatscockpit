import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { EventRow, SessionRow } from '../lib/types'

export function CalendarView() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])

  useEffect(() => {
    supabase.from('events').select('*').order('start').then(({ data }) => setEvents(data ?? []))
    supabase.from('sessions').select('*').order('datum').then(({ data }) => setSessions(data ?? []))
  }, [])

  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-semibold mb-2">Eigene Termine</h2>
        <ul className="space-y-1">
          {events.map((e) => (
            <li key={e.id} className="border rounded px-3 py-2 flex justify-between bg-white">
              <span>{e.titel}</span>
              <span className="text-xs text-slate-500">
                {new Date(e.start).toLocaleString('de-DE')}
                {e.herkunft === 'fraktionsbuero' && ' · vom Fraktionsbüro'}
              </span>
            </li>
          ))}
          {events.length === 0 && <li className="text-slate-400 text-sm">Noch keine Termine.</li>}
        </ul>
      </section>
      <section>
        <h2 className="font-semibold mb-2">Sitzungstermine (importiert)</h2>
        <ul className="space-y-1">
          {sessions.map((s) => (
            <li key={s.id} className="border rounded px-3 py-2 flex justify-between bg-white">
              <span>{s.titel}</span>
              <span className="text-xs text-slate-500">{new Date(s.datum).toLocaleString('de-DE')}</span>
            </li>
          ))}
          {sessions.length === 0 && (
            <li className="text-slate-400 text-sm">
              Noch keine importierten Sitzungen (Phase 1: ICS-Import-Job fehlt noch – siehe CLAUDE.md).
            </li>
          )}
        </ul>
      </section>
    </div>
  )
}
