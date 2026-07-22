import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { AntragDeadlineSetting, AntragRow, Ebene, SessionRow, SummaryRow } from '../lib/types'
import { ANTRAG_STATUS_AKTIV, antragBadgeClasses, antragStatusLabel } from '../lib/antragStatus'
import { computeAntragDeadline } from '../lib/antragDeadline'
import { AntragDetailModal } from './AntragDetailModal'
import { DocumentPreviewModal, fileNameFromPath } from './DocumentPreviewModal'
import { formatDate } from '../lib/format'

/** 'alle' = ungefiltert, 'eigene' = Anträge ohne Sitzungsbezug, sonst eine session_id. */
type SitzungFilter = 'alle' | 'eigene' | string

// "Antrags-Dokumente" ist eine dokumentenzentrierte Übersicht (Kernobjekt ist
// das hochgeladene Antragsdokument, getaggt mit der verknüpften Sitzung),
// aber die Anlage selbst ist bewusst leichtgewichtig: Titel + optionale
// Sitzung reichen, Status startet immer bei "Entwurf". Ausschuss/Ebene werden
// beim Verknüpfen einer Sitzung automatisch übernommen. Ein Dokument wird
// erst spätestens beim Status "Gestellt" verlangt (siehe AntragDetailModal).
export function AntraegeSection() {
  const [userId, setUserId] = useState<string | null>(null)
  const [antraege, setAntraege] = useState<AntragRow[]>([])
  const [sessionById, setSessionById] = useState<Map<string, SessionRow>>(new Map())
  const [docsByAntrag, setDocsByAntrag] = useState<Map<string, SummaryRow[]>>(new Map())
  const [ownSessions, setOwnSessions] = useState<SessionRow[]>([])
  const [tageByEbene, setTageByEbene] = useState<Map<Ebene, number>>(new Map())

  const [sitzungFilter, setSitzungFilter] = useState<SitzungFilter>('alle')

  const [showAddForm, setShowAddForm] = useState(false)
  const [newTitel, setNewTitel] = useState('')
  const [newSessionId, setNewSessionId] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [openId, setOpenId] = useState<string | null>(null)
  const [previewDoc, setPreviewDoc] = useState<{ path: string; name: string } | null>(null)

  async function load() {
    const { data } = await supabase.from('antraege').select('*').order('created_at', { ascending: false })
    setAntraege(data ?? [])
  }

  useEffect(() => {
    load()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      const { data: mine } = await supabase.from('user_gremien').select('gremium').eq('user_id', data.user.id)
      const gremien = (mine ?? []).map((g) => g.gremium)
      if (gremien.length > 0) {
        const { data: sessions } = await supabase.from('sessions').select('*').in('gremium', gremien).order('datum')
        setOwnSessions(sessions ?? [])
      }
      const { data: fristen } = await supabase
        .from('antrag_deadline_settings')
        .select('*')
        .eq('user_id', data.user.id)
      setTageByEbene(
        new Map(((fristen ?? []) as AntragDeadlineSetting[]).map((f) => [f.ebene, f.tage_vor_sitzung])),
      )
    })
  }, [])

  // Verknüpfte Sitzungen und die hochgeladenen Dokumente nur für die
  // tatsächlich vorhandenen Anträge nachladen (gleiches Muster wie
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
      setDocsByAntrag(new Map())
    } else {
      supabase
        .from('summaries')
        .select('*')
        .in('antrag_id', antragIds)
        .order('erstellt_am')
        .then(({ data }) => {
          const map = new Map<string, SummaryRow[]>()
          for (const d of data ?? []) {
            const list = map.get(d.antrag_id as string) ?? []
            list.push(d)
            map.set(d.antrag_id as string, list)
          }
          setDocsByAntrag(map)
        })
    }
  }, [antraege])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!userId || !newTitel.trim()) return
    setAdding(true)
    setAddError(null)

    const session = newSessionId ? ownSessions.find((s) => s.id === newSessionId) : undefined
    const { error } = await supabase.from('antraege').insert({
      user_id: userId,
      titel: newTitel.trim(),
      session_id: newSessionId || null,
      ausschuss: session?.gremium ?? null,
      ebene: session?.ebene ?? null,
    })
    if (error) {
      setAddError(error.message)
      setAdding(false)
      return
    }

    setNewTitel('')
    setNewSessionId('')
    setAdding(false)
    setShowAddForm(false)
    await load()
  }

  const aktive = antraege.filter((a) => ANTRAG_STATUS_AKTIV.includes(a.status))
  // Sitzungs-Filter: ein Chip pro Sitzung, die tatsächlich unter den aktiven
  // Anträgen vorkommt (chronologisch), plus "Eigene Anträge" für Anträge
  // ohne Sitzungsbezug - keine wirkungslosen Filter anzeigen.
  const vorkommendeSitzungen = Array.from(new Set(aktive.filter((a) => a.session_id).map((a) => a.session_id as string)))
    .map((id) => sessionById.get(id))
    .filter((s): s is SessionRow => Boolean(s))
    .sort((a, b) => a.datum.localeCompare(b.datum))
  const hatEigeneOhneSitzung = aktive.some((a) => !a.session_id)
  const sichtbar = aktive.filter((a) => {
    if (sitzungFilter === 'alle') return true
    if (sitzungFilter === 'eigene') return !a.session_id
    return a.session_id === sitzungFilter
  })
  const abgeschlosseneAnzahl = antraege.length - aktive.length

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-slate-900">Antrags-Dokumente</h2>
          {abgeschlosseneAnzahl > 0 && (
            <Link to="/archiv" className="text-xs font-medium text-primary underline">
              {abgeschlosseneAnzahl} entschiedene im Archiv
            </Link>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className={showAddForm ? 'mc-btn-ghost' : 'mc-btn-primary'}
        >
          {showAddForm ? 'Abbrechen' : '+ Antrag'}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleAdd} className="mc-card mc-animate-pop mb-3 space-y-2.5 p-4">
          <input
            type="text"
            placeholder="Titel"
            value={newTitel}
            onChange={(e) => setNewTitel(e.target.value)}
            className="mc-input w-full"
            required
          />
          <select
            value={newSessionId}
            onChange={(e) => setNewSessionId(e.target.value)}
            className="mc-input w-full"
          >
            <option value="">Vorgesehene Sitzung (optional)</option>
            {ownSessions.map((se) => (
              <option key={se.id} value={se.id}>
                {se.titel} ({formatDate(se.datum)})
              </option>
            ))}
          </select>
          {addError && <p className="text-sm text-red-600">{addError}</p>}
          <button type="submit" disabled={adding} className="mc-btn-primary">
            {adding ? 'Anlegen...' : 'Antrag anlegen'}
          </button>
        </form>
      )}

      {(vorkommendeSitzungen.length > 0 || hatEigeneOhneSitzung) && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSitzungFilter('alle')}
            className={sitzungFilter === 'alle' ? 'mc-btn-primary !px-2.5 !py-1 !text-xs' : 'mc-btn-ghost !px-2.5 !py-1 !text-xs'}
          >
            Alle
          </button>
          {vorkommendeSitzungen.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSitzungFilter(s.id)}
              className={sitzungFilter === s.id ? 'mc-btn-primary !px-2.5 !py-1 !text-xs' : 'mc-btn-ghost !px-2.5 !py-1 !text-xs'}
            >
              {s.titel}
            </button>
          ))}
          {hatEigeneOhneSitzung && (
            <button
              type="button"
              onClick={() => setSitzungFilter('eigene')}
              className={sitzungFilter === 'eigene' ? 'mc-btn-primary !px-2.5 !py-1 !text-xs' : 'mc-btn-ghost !px-2.5 !py-1 !text-xs'}
            >
              Eigene Anträge
            </button>
          )}
        </div>
      )}

      <ul className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
        {sichtbar.map((a) => {
          const session = a.session_id ? sessionById.get(a.session_id) : undefined
          const docs = docsByAntrag.get(a.id) ?? []
          const [firstDoc, ...weitereDocs] = docs
          const deadline = computeAntragDeadline(session, a.ebene, tageByEbene)
          const ueberfaellig = deadline ? deadline.getTime() < Date.now() && a.status === 'entwurf' : false
          return (
            <li key={a.id}>
              <div
                onClick={() => setOpenId(a.id)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-shadow duration-150 hover:shadow-md"
              >
                <span
                  className={`shrink-0 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${antragBadgeClasses(a.status, a.ergebnis)}`}
                >
                  {antragStatusLabel(a.status, a.ergebnis)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{a.titel}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {a.ausschuss && (
                      <span className="truncate rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                        {a.ausschuss}
                      </span>
                    )}
                    {firstDoc?.datei_url ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setPreviewDoc({ path: firstDoc.datei_url!, name: fileNameFromPath(firstDoc.datei_url!) })
                        }}
                        className="mc-btn-ghost !px-1.5 !py-0.5 !text-xs"
                      >
                        📎 {fileNameFromPath(firstDoc.datei_url)}
                        {weitereDocs.length > 0 && ` +${weitereDocs.length}`}
                      </button>
                    ) : (
                      <span className="italic text-slate-400">Kein Dokument hochgeladen</span>
                    )}
                    {session ? (
                      <span className="truncate">🗳️ {session.titel} · {formatDate(session.datum)}</span>
                    ) : (
                      <span className="italic text-slate-400">Ohne Sitzungsbezug</span>
                    )}
                    {deadline && (
                      <span className={ueberfaellig ? 'font-semibold text-red-600' : ''}>
                        Frist {formatDate(deadline.toISOString())}
                        {ueberfaellig && ' · überfällig'}
                      </span>
                    )}
                  </span>
                </span>
              </div>
            </li>
          )
        })}
        {sichtbar.length === 0 && (
          <li className="rounded-xl border-2 border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            {aktive.length === 0
              ? 'Noch keine Anträge. Über „+ Antrag" oben Titel eingeben, optional die vorgesehene Sitzung wählen.'
              : 'Keine Anträge mit diesen Filtern.'}
          </li>
        )}
      </ul>

      {openId && <AntragDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
      {previewDoc && (
        <DocumentPreviewModal path={previewDoc.path} fileName={previewDoc.name} onClose={() => setPreviewDoc(null)} />
      )}
    </section>
  )
}
