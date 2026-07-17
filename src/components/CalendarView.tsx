import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { EventRow, SessionRow } from '../lib/types'

export function CalendarView() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [meineGremien, setMeineGremien] = useState<string[] | null>(null)

  useEffect(() => {
    const now = new Date().toISOString()
    supabase
      .from('events')
      .select('*')
      .gte('start', now)
      .order('start')
      .then(({ data }) => setEvents(data ?? []))
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
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
        .gte('datum', now)
        .order('datum')
      setSessions(sessionRows ?? [])
    })
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
