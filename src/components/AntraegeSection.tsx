import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { AntragRow, AntragStatus, SessionRow } from '../lib/types'
import { ANTRAG_STATUS_AKTIV, ANTRAG_STATUS_BADGE, ANTRAG_STATUS_LABEL } from '../lib/antragStatus'
import { AntragDetailModal } from './AntragDetailModal'
import { formatDate } from '../lib/format'

type Filter = 'alle' | AntragStatus

export function AntraegeSection() {
  const [userId, setUserId] = useState<string | null>(null)
  const [antraege, setAntraege] = useState<AntragRow[]>([])
  const [sessionById, setSessionById] = useState<Map<string, SessionRow>>(new Map())
  const [dokumentIds, setDokumentIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<Filter>('alle')
  const [newTitel, setNewTitel] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('antraege').select('*').order('created_at', { ascending: false })
    setAntraege(data ?? [])
  }

  useEffect(() => {
    load()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
    })
  }, [])

  // Verknüpfte Sitzungen und das "hat Dokumente/Kommentare"-Flag nur für die
  // aktuell sichtbaren, aktiven Anträge nachladen (gleiches Muster wie
  // eventById/sessionById in TodoBoard).
  useEffect(() => {
    const sessionIds = Array.from(new Set(antraege.filter((a) => a.session_id).map((a) => a.session_id as string)))
    if (sessionIds.length === 0) {
      setSessionById(new Map())
    } else {
      supabase
        .from('sessions')
        .select('*')
        .in('id', sessionIds)
        .then(({ data }) => setSessionById(new Map((data ?? []).map((s: SessionRow) => [s.id, s]))))
    }

    const antragIds = antraege.map((a) => a.id)
    if (antragIds.length === 0) {
      setDokumentIds(new Set())
    } else {
      supabase
        .from('summaries')
        .select('antrag_id')
        .in('antrag_id', antragIds)
        .then(({ data }) => setDokumentIds(new Set((data ?? []).map((d) => d.antrag_id as string))))
    }
  }, [antraege])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!userId || !newTitel.trim()) return
    const { data } = await supabase
      .from('antraege')
      .insert({ user_id: userId, titel: newTitel.trim() })
      .select()
      .single()
    if (data) setAntraege((prev) => [data, ...prev])
    setNewTitel('')
  }

  const aktive = antraege.filter((a) => ANTRAG_STATUS_AKTIV.includes(a.status))
  const vorkommendeStatus = ANTRAG_STATUS_AKTIV.filter((s) => aktive.some((a) => a.status === s))
  const sichtbar = filter === 'alle' ? aktive : aktive.filter((a) => a.status === filter)
  const abgeschlosseneAnzahl = antraege.length - aktive.length

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Meine Anträge</h2>
        {abgeschlosseneAnzahl > 0 && (
          <Link to="/archiv" className="text-xs font-medium text-primary underline">
            {abgeschlosseneAnzahl} entschiedene im Archiv
          </Link>
        )}
      </div>

      <form onSubmit={handleAdd} className="mb-3">
        <input
          type="text"
          placeholder="+ Neuer Antrag (Titel)"
          value={newTitel}
          onChange={(e) => setNewTitel(e.target.value)}
          className="w-full rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 transition-colors hover:border-slate-400 focus:border-solid"
        />
      </form>

      {vorkommendeStatus.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setFilter('alle')}
            className={filter === 'alle' ? 'mc-btn-primary !px-2.5 !py-1 !text-xs' : 'mc-btn-ghost !px-2.5 !py-1 !text-xs'}
          >
            Alle
          </button>
          {vorkommendeStatus.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={filter === s ? 'mc-btn-primary !px-2.5 !py-1 !text-xs' : 'mc-btn-ghost !px-2.5 !py-1 !text-xs'}
            >
              {ANTRAG_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      )}

      <ul className="space-y-2">
        {sichtbar.map((a) => {
          const session = a.session_id ? sessionById.get(a.session_id) : undefined
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => setOpenId(a.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-shadow duration-150 hover:shadow-md"
              >
                <span
                  className={`shrink-0 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${ANTRAG_STATUS_BADGE[a.status]}`}
                >
                  {ANTRAG_STATUS_LABEL[a.status]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-900">
                    <span className="truncate">{a.titel}</span>
                    {dokumentIds.has(a.id) && (
                      <span className="shrink-0" title="Enthält Dokumente">
                        📎
                      </span>
                    )}
                  </span>
                  {(a.ausschuss || session || a.eingereicht_am) && (
                    <span className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-slate-500">
                      {a.ausschuss && (
                        <span className="truncate rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                          {a.ausschuss}
                        </span>
                      )}
                      {session && <span className="truncate">🗳️ {session.titel} · {formatDate(session.datum)}</span>}
                      {a.eingereicht_am && <span>Eingereicht {formatDate(a.eingereicht_am)}</span>}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
        {sichtbar.length === 0 && (
          <li className="rounded-xl border-2 border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            {aktive.length === 0
              ? 'Noch keine Anträge. Oben Titel eingeben, um deinen ersten Antrag anzulegen.'
              : 'Keine Anträge mit diesem Status.'}
          </li>
        )}
      </ul>

      {openId && <AntragDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </section>
  )
}
