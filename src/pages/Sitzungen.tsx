import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { SessionRow } from '../lib/types'
import { TerminDetailModal } from '../components/TerminDetailModal'
import { formatDate, formatTime, startOfTodayIso } from '../lib/format'

type SitzungZeile = Pick<SessionRow, 'id' | 'titel' | 'gremium' | 'datum' | 'ort' | 'status'>

/**
 * Kommende Sitzungen der eigenen Gremien (user_gremien). Ein Klick öffnet die
 * Sitzung im Leser (TerminDetailModal), dort liegen Tagesordnung und Vorlagen.
 */
export default function Sitzungen() {
  const [sitzungen, setSitzungen] = useState<SitzungZeile[] | null>(null)
  const [ohneGremien, setOhneGremien] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [offen, setOffen] = useState<string | null>(null)

  useEffect(() => {
    async function laden() {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) return
      const { data: mine, error: gremienFehler } = await supabase
        .from('user_gremien')
        .select('gremium')
        .eq('user_id', auth.user.id)
      if (gremienFehler) {
        setFehler(gremienFehler.message)
        return
      }
      const gremien = (mine ?? []).map((g) => g.gremium)
      if (gremien.length === 0) {
        setOhneGremien(true)
        setSitzungen([])
        return
      }
      const { data, error } = await supabase
        .from('sessions')
        .select('id, titel, gremium, datum, ort, status')
        .in('gremium', gremien)
        .gte('datum', startOfTodayIso())
        .order('datum')
      if (error) setFehler(error.message)
      setSitzungen(data ?? [])
    }
    laden()
  }, [])

  return (
    <div className="flex flex-col gap-5">
      <h1 className="mc-page-title">Sitzungen</h1>
      {fehler && <p className="text-sm text-red-600">Sitzungen konnten nicht geladen werden: {fehler}</p>}
      {sitzungen === null && !fehler && <p className="text-sm text-slate-500">Lade …</p>}
      {ohneGremien && (
        <p className="text-sm text-slate-600">
          Du hast noch keine Gremien ausgewählt.{' '}
          <Link to="/settings" className="font-medium text-primary underline">
            Gremien wählen
          </Link>
        </p>
      )}
      {sitzungen && sitzungen.length === 0 && !ohneGremien && (
        <p className="text-sm text-slate-500">Keine kommenden Sitzungen in deinen Gremien.</p>
      )}
      {sitzungen && sitzungen.length > 0 && (
        <ul className="mc-card divide-y divide-slate-100 overflow-hidden">
          {sitzungen.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setOffen(s.id)}
                className="flex w-full flex-wrap items-center gap-x-5 gap-y-1 px-5 py-3.5 text-left hover:bg-slate-50"
              >
                <span className="w-36 font-mono text-[13px] text-slate-500">
                  {formatDate(s.datum)} · {formatTime(s.datum)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={`text-[15px] font-semibold ${s.status === 'abgesagt' ? 'text-slate-400 line-through' : ''}`}>
                    {s.gremium ?? s.titel}
                  </span>
                  {s.ort && <span className="text-[13px] text-slate-500">{s.ort}</span>}
                </span>
                {s.status === 'abgesagt' && (
                  <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs text-red-700">abgesagt</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {offen && <TerminDetailModal kind="session" id={offen} onClose={() => setOffen(null)} />}
    </div>
  )
}
