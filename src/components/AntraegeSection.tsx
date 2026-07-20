import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { AntragRow, AntragStatus, SessionRow, SummaryRow } from '../lib/types'
import { ANTRAG_STATUS_AKTIV, ANTRAG_STATUS_BADGE, ANTRAG_STATUS_LABEL } from '../lib/antragStatus'
import { AntragDetailModal } from './AntragDetailModal'
import { DocumentPreviewModal, fileNameFromPath } from './DocumentPreviewModal'
import { formatDate } from '../lib/format'

type Filter = 'alle' | AntragStatus

// "Meine Anträge" ist bewusst eine dokumentenzentrierte Übersicht: Kernobjekt
// ist das hochgeladene Antragsdokument (Word/PDF/...), getaggt mit Metadaten
// wie dem vorgesehenen Ausschuss - nicht ein reiner Text-Datensatz, an den
// optional mal ein Dokument gehängt wird. Titel, Ausschuss und Datei sind
// deshalb schon in der Schnellerfassung Pflicht, nicht erst im Detail-Modal.
export function AntraegeSection() {
  const [userId, setUserId] = useState<string | null>(null)
  const [antraege, setAntraege] = useState<AntragRow[]>([])
  const [sessionById, setSessionById] = useState<Map<string, SessionRow>>(new Map())
  const [docsByAntrag, setDocsByAntrag] = useState<Map<string, SummaryRow[]>>(new Map())
  const [gremienVorschlaege, setGremienVorschlaege] = useState<string[]>([])

  const [statusFilter, setStatusFilter] = useState<Filter>('alle')
  const [ausschussFilter, setAusschussFilter] = useState<string | null>(null)

  const [newTitel, setNewTitel] = useState('')
  const [newAusschuss, setNewAusschuss] = useState('')
  const [newFile, setNewFile] = useState<File | null>(null)
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
      setGremienVorschlaege((mine ?? []).map((g) => g.gremium))
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
    if (!userId || !newTitel.trim() || !newAusschuss.trim() || !newFile) return
    setAdding(true)
    setAddError(null)

    const path = `${userId}/${Date.now()}-${newFile.name}`
    const { error: uploadError } = await supabase.storage.from('zusammenfassungen').upload(path, newFile)
    if (uploadError) {
      setAddError(uploadError.message)
      setAdding(false)
      return
    }

    const { data: antrag, error: insertError } = await supabase
      .from('antraege')
      .insert({ user_id: userId, titel: newTitel.trim(), ausschuss: newAusschuss.trim() })
      .select()
      .single()
    if (insertError || !antrag) {
      setAddError(insertError?.message ?? 'Antrag konnte nicht angelegt werden.')
      setAdding(false)
      return
    }

    const { error: summaryError } = await supabase
      .from('summaries')
      .insert({ user_id: userId, antrag_id: antrag.id, datei_url: path })
    if (summaryError) {
      setAddError(summaryError.message)
      setAdding(false)
      return
    }

    setNewTitel('')
    setNewAusschuss('')
    setNewFile(null)
    setAdding(false)
    await load()
  }

  const aktive = antraege.filter((a) => ANTRAG_STATUS_AKTIV.includes(a.status))
  const vorkommendeStatus = ANTRAG_STATUS_AKTIV.filter((s) => aktive.some((a) => a.status === s))
  const vorkommendeAusschuesse = Array.from(new Set(aktive.filter((a) => a.ausschuss).map((a) => a.ausschuss as string)))
  const sichtbar = aktive.filter(
    (a) => (statusFilter === 'alle' || a.status === statusFilter) && (!ausschussFilter || a.ausschuss === ausschussFilter),
  )
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

      <form
        onSubmit={handleAdd}
        className="mb-3 space-y-2 rounded-xl border border-dashed border-slate-300 bg-white p-3"
      >
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Titel"
            value={newTitel}
            onChange={(e) => setNewTitel(e.target.value)}
            className="mc-input min-w-[10rem] flex-1"
            required
          />
          <input
            type="text"
            placeholder="Vorgesehener Ausschuss"
            value={newAusschuss}
            onChange={(e) => setNewAusschuss(e.target.value)}
            list="antraege-ausschuss-vorschlaege"
            className="mc-input min-w-[10rem] flex-1"
            required
          />
          <datalist id="antraege-ausschuss-vorschlaege">
            {gremienVorschlaege.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
            className="min-w-[12rem] flex-1 text-sm"
            required
          />
          <button type="submit" disabled={adding} className="mc-btn-primary shrink-0">
            {adding ? 'Hochladen...' : 'Antrag hochladen'}
          </button>
        </div>
        {addError && <p className="text-red-600 text-sm">{addError}</p>}
      </form>

      {(vorkommendeStatus.length > 1 || vorkommendeAusschuesse.length > 1) && (
        <div className="mb-3 space-y-1.5">
          {vorkommendeStatus.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStatusFilter('alle')}
                className={statusFilter === 'alle' ? 'mc-btn-primary !px-2.5 !py-1 !text-xs' : 'mc-btn-ghost !px-2.5 !py-1 !text-xs'}
              >
                Alle Status
              </button>
              {vorkommendeStatus.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={statusFilter === s ? 'mc-btn-primary !px-2.5 !py-1 !text-xs' : 'mc-btn-ghost !px-2.5 !py-1 !text-xs'}
                >
                  {ANTRAG_STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          )}
          {vorkommendeAusschuesse.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAusschussFilter(null)}
                className={!ausschussFilter ? 'mc-btn-primary !px-2.5 !py-1 !text-xs' : 'mc-btn-ghost !px-2.5 !py-1 !text-xs'}
              >
                Alle Ausschüsse
              </button>
              {vorkommendeAusschuesse.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAusschussFilter(a)}
                  className={ausschussFilter === a ? 'mc-btn-primary !px-2.5 !py-1 !text-xs' : 'mc-btn-ghost !px-2.5 !py-1 !text-xs'}
                >
                  {a}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <ul className="space-y-2">
        {sichtbar.map((a) => {
          const session = a.session_id ? sessionById.get(a.session_id) : undefined
          const docs = docsByAntrag.get(a.id) ?? []
          const [firstDoc, ...weitereDocs] = docs
          return (
            <li key={a.id}>
              <div
                onClick={() => setOpenId(a.id)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-shadow duration-150 hover:shadow-md"
              >
                <span
                  className={`shrink-0 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${ANTRAG_STATUS_BADGE[a.status]}`}
                >
                  {ANTRAG_STATUS_LABEL[a.status]}
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
                    {session && <span className="truncate">🗳️ {session.titel} · {formatDate(session.datum)}</span>}
                    {a.eingereicht_am && <span>Eingereicht {formatDate(a.eingereicht_am)}</span>}
                  </span>
                </span>
              </div>
            </li>
          )
        })}
        {sichtbar.length === 0 && (
          <li className="rounded-xl border-2 border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            {aktive.length === 0
              ? 'Noch keine Anträge. Oben Titel, Ausschuss und Antragsdokument angeben.'
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
