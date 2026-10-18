import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { SessionRow } from '../lib/types'
import { TerminDetailPanel } from '../components/TerminDetailPanel'
import { formatTime, startOfTodayIso } from '../lib/format'
import { inStuecken } from '../lib/alleZeilen'

type SitzungZeile = Pick<SessionRow, 'id' | 'titel' | 'gremium' | 'datum' | 'status'>

/** Wie viele kommende Sitzungen die Leiste oben zeigt. */
const LEISTE_ANZAHL = 12

/**
 * Sitzungsansicht (UI-Umbau 18.10.2026, Entwurf B): oben die kommenden
 * Sitzungen meiner Gremien als Leiste, darunter die gewählte Sitzung mit
 * Tagesordnung und Tagesordnungspunkt in einer Karte (TerminDetailPanel,
 * layout="eingebettet"). Ohne :id ist die nächste Sitzung gewählt. Vergangene
 * Sitzungen erreicht man über Archiv und Kalender – sie stehen dann vorn in
 * der Leiste.
 */
export default function Sitzungen() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [kommende, setKommende] = useState<SitzungZeile[] | null>(null)
  const [gewaehlteZeile, setGewaehlteZeile] = useState<SitzungZeile | null>(null)
  const [topsJeSitzung, setTopsJeSitzung] = useState<Map<string, number>>(new Map())
  const [ohneGremien, setOhneGremien] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const aktiveKachel = useRef<HTMLAnchorElement | null>(null)

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
        setKommende([])
        return
      }
      const { data, error } = await supabase
        .from('sessions')
        .select('id, titel, gremium, datum, status')
        .in('gremium', gremien)
        .gte('datum', startOfTodayIso())
        .order('datum')
        .limit(LEISTE_ANZAHL)
      if (error) setFehler(error.message)
      const zeilen = data ?? []
      const tops = new Map<string, number>()
      for (const ids of inStuecken(zeilen.map((s) => s.id))) {
        const { data: links } = await supabase.from('sitzung_dokumente').select('session_id').in('session_id', ids)
        for (const l of links ?? []) tops.set(l.session_id, (tops.get(l.session_id) ?? 0) + 1)
      }
      setTopsJeSitzung(tops)
      setKommende(zeilen)
    }
    laden()
  }, [])

  // Eine gewählte Sitzung, die nicht unter den kommenden ist (vergangen oder
  // aus einem anderen Gremium), wird nachgeladen und vorn in die Leiste gestellt.
  useEffect(() => {
    if (!id || !kommende || kommende.some((s) => s.id === id)) return
    supabase
      .from('sessions')
      .select('id, titel, gremium, datum, status')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => setGewaehlteZeile(data))
  }, [id, kommende])

  const gewaehlt = id ?? kommende?.find((s) => s.status !== 'abgesagt')?.id ?? kommende?.[0]?.id ?? null
  const leiste = [
    ...(gewaehlteZeile && gewaehlteZeile.id === id && !kommende?.some((s) => s.id === id) ? [gewaehlteZeile] : []),
    ...(kommende ?? []),
  ]

  useEffect(() => {
    aktiveKachel.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [gewaehlt, kommende])

  return (
    <div className="flex flex-col gap-5">
      <h1 className="sr-only">Sitzungen</h1>
      {fehler && <p className="text-sm text-red-600">Sitzungen konnten nicht geladen werden: {fehler}</p>}
      {ohneGremien && !id && (
        <p className="text-sm text-slate-600">
          Du hast noch keine Gremien ausgewählt.{' '}
          <Link to="/settings" className="font-medium text-primary underline">
            Gremien wählen
          </Link>
        </p>
      )}

      {leiste.length > 0 && (
        <nav aria-label="Kommende Sitzungen meiner Gremien" className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1">
          {leiste.map((s) => {
            const aktiv = s.id === gewaehlt
            const d = new Date(s.datum)
            const tops = topsJeSitzung.get(s.id) ?? 0
            return (
              <Link
                key={s.id}
                to={`/sitzungen/${s.id}`}
                ref={aktiv ? aktiveKachel : undefined}
                aria-current={aktiv ? 'page' : undefined}
                className={`flex w-[196px] shrink-0 flex-col gap-1 rounded-xl p-3.5 transition-colors ${
                  aktiv ? 'bg-primary text-white' : 'border border-slate-200 bg-white hover:border-primary/40'
                }`}
              >
                <span className={`font-mono text-[13px] ${aktiv ? '' : 'text-slate-500'}`}>
                  {d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} · {formatTime(s.datum)}
                </span>
                <span className={`line-clamp-2 text-base font-semibold leading-snug ${s.status === 'abgesagt' ? 'line-through' : ''}`}>
                  {s.gremium ?? s.titel}
                </span>
                <span className={`text-[13px] ${aktiv ? 'opacity-90' : 'text-slate-500'}`}>
                  {s.status === 'abgesagt' ? 'abgesagt' : tops > 0 ? `${tops} Punkte` : 'Noch keine Tagesordnung'}
                </span>
              </Link>
            )
          })}
        </nav>
      )}

      {kommende !== null && !gewaehlt && !ohneGremien && (
        <p className="text-sm text-slate-500">Keine kommenden Sitzungen in deinen Gremien.</p>
      )}

      {gewaehlt && (
        <TerminDetailPanel
          key={gewaehlt}
          kind="session"
          id={gewaehlt}
          layout="eingebettet"
          onDeleted={() => navigate('/sitzungen')}
        />
      )}
    </div>
  )
}
