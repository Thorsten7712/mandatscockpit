import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type {
  AntragDeadlineSetting,
  AntragErgebnis,
  AntragRow,
  AntragShare,
  AntragStatus,
  Ebene,
  Profile,
  SessionRow,
} from '../lib/types'
import { ANTRAG_STATUS_ORDER, antragStatusLabel } from '../lib/antragStatus'
import { computeAntragDeadline } from '../lib/antragDeadline'
import { formatDate, formatDateTime } from '../lib/format'
import { EBENE_LABEL } from '../lib/sourceColors'
import { gleicheGliederung } from '../lib/gliederung'
import { DetailModalShell } from './DetailModalShell'
import { useLoeschDialog } from './LoeschDialog'

export function AntragDetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: string
  onClose: () => void
  onChanged: () => void
}) {
  const [userId, setUserId] = useState<string | null>(null)
  const [antrag, setAntrag] = useState<AntragRow | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [ownSessions, setOwnSessions] = useState<SessionRow[]>([])
  const [linkedSession, setLinkedSession] = useState<SessionRow | null>(null)
  const [tageByEbene, setTageByEbene] = useState<Map<Ebene, number>>(new Map())

  const [editTitel, setEditTitel] = useState('')
  // Bezugszeitpunkt für "überfällig", einmal beim Öffnen festgehalten:
  // Date.now() direkt im Render wäre bei jedem Rendern ein anderer Wert.
  const [jetzt] = useState(() => Date.now())
  const [editStatus, setEditStatus] = useState<AntragStatus>('entwurf')
  const [editErgebnis, setEditErgebnis] = useState<AntragErgebnis | ''>('')
  const [editAusschuss, setEditAusschuss] = useState('')
  const [editEbene, setEditEbene] = useState<Ebene | ''>('')
  const [editInhalt, setEditInhalt] = useState('')
  const [editSessionId, setEditSessionId] = useState('')
  const [editEingereichtAm, setEditEingereichtAm] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Teilen mit Kolleg*innen gleicher Partei+Ebene - gleiches Modell wie bei
  // ToDo-Karten (siehe TodoDetailModal.tsx), nur ohne Board-Position: hier
  // reicht eine reine Sichtbarkeits-/Bearbeitungs-Freigabe (antrag_shares).
  const [myProfile, setMyProfile] = useState<Profile | null>(null)
  const [shares, setShares] = useState<AntragShare[]>([])
  const [shareNames, setShareNames] = useState<Map<string, string>>(new Map())
  const [candidates, setCandidates] = useState<Profile[]>([])
  const [shareError, setShareError] = useState<string | null>(null)
  const [shareSearch, setShareSearch] = useState('')
  const [shareDropdownOpen, setShareDropdownOpen] = useState(false)


  const { fragen: loeschRueckfrage, dialog: loeschDialog } = useLoeschDialog()

  async function loadAntrag() {
    const { data, error } = await supabase.from('antraege').select('*').eq('id', id).single()
    if (error || !data) {
      setLoadError('Antrag nicht gefunden.')
      return
    }
    setAntrag(data)
    setEditTitel(data.titel)
    setEditStatus(data.status)
    setEditErgebnis(data.ergebnis ?? '')
    setEditAusschuss(data.ausschuss ?? '')
    setEditEbene(data.ebene ?? '')
    setEditInhalt(data.inhalt ?? '')
    setEditSessionId(data.session_id ?? '')
    setEditEingereichtAm(data.eingereicht_am ?? '')
    setLinkedSession(null)
    if (data.session_id) {
      const { data: se } = await supabase.from('sessions').select('*').eq('id', data.session_id).single()
      if (se) setLinkedSession(se)
    }
  }

  // Volle Freigabeliste (alle Kolleg*innen, für die dieser Antrag freigegeben
  // ist) - für den Ersteller der Checkbox-/Chip-Zustand, für alle anderen die
  // read-only "Geteilt mit"-Anzeige. RLS erlaubt jeder geteilten Person, alle
  // Freigaben desselben Antrags zu lesen (antrag_shares_select).
  async function loadSharing() {
    const { data: sh } = await supabase.from('antrag_shares').select('*').eq('antrag_id', id)
    setShares(sh ?? [])
    const ids = Array.from(new Set((sh ?? []).map((s) => s.user_id)))
    if (ids.length === 0) {
      setShareNames(new Map())
      return
    }
    const { data: profs } = await supabase.from('profiles').select('id, name').in('id', ids)
    setShareNames(new Map((profs ?? []).map((p) => [p.id, p.name])))
  }

  // Gleiche Partei, überschneidende Ebene UND (außer bei Bund) dieselbe
  // Gliederung (welche Kommune/welcher Kreis/welches Land - siehe
  // src/lib/gliederung.ts, verhindert Querverbindungen zwischen
  // Mitgliedern derselben Partei aus unterschiedlichen Städten).
  async function loadCandidates(ebene: Ebene) {
    if (!myProfile?.partei || !userId) {
      setCandidates([])
      return
    }
    const { data } = await supabase.from('profiles').select('*').neq('id', userId)
    const filtered = (data ?? []).filter(
      (p) =>
        !p.technisch &&
        p.partei === myProfile.partei &&
        (p.ebenen ?? []).includes(ebene) &&
        gleicheGliederung(myProfile, p, ebene),
    )
    setCandidates(filtered)
  }

  useEffect(() => {
    loadAntrag()
    loadSharing()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      const { data: mine } = await supabase.from('user_gremien').select('gremium').eq('user_id', data.user.id)
      const gremien = (mine ?? []).map((g) => g.gremium)
      if (gremien.length > 0) {
        const { data: sessions } = await supabase
          .from('sessions')
          .select('*')
          .in('gremium', gremien)
          .order('datum')
        setOwnSessions(sessions ?? [])
      }
      const { data: profileRow } = await supabase.from('profiles').select('*').eq('id', data.user.id).single()
      setMyProfile(profileRow)
      const { data: fristen } = await supabase
        .from('antrag_deadline_settings')
        .select('*')
        .eq('user_id', data.user.id)
      setTageByEbene(
        new Map(((fristen ?? []) as AntragDeadlineSetting[]).map((f) => [f.ebene, f.tage_vor_sitzung])),
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Kandidatenliste neu laden, sobald die Ebene des Antrags oder das eigene
  // Profil bekannt ist bzw. sich ändert (nur relevant für den Ersteller).
  useEffect(() => {
    if (antrag?.user_id === userId && antrag?.ebene) {
      loadCandidates(antrag.ebene)
    } else {
      setCandidates([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [antrag?.ebene, antrag?.user_id, userId, myProfile])

  // Sitzung ausgewählt -> Ausschuss/Ebene automatisch übernehmen, sofern der
  // Nutzer sie noch nicht selbst gesetzt hat (bleibt frei überschreibbar).
  function handleSessionChange(sessionId: string) {
    setEditSessionId(sessionId)
    const session = ownSessions.find((s) => s.id === sessionId)
    if (session) {
      if (!editAusschuss.trim() && session.gremium) setEditAusschuss(session.gremium)
      if (!editEbene && session.ebene) setEditEbene(session.ebene)
    }
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!antrag) return
    setEditError(null)

    if (editStatus === 'abgestimmt' && !editErgebnis) {
      setEditError('Bitte ein Ergebnis (Positiv/Negativ) wählen.')
      return
    }

    setEditSaving(true)

    // eingereicht_am nur beim ÜBERGANG in "Gestellt" automatisch auf heute
    // setzen (falls noch leer) - ein erneutes Speichern ohne Statuswechsel
    // überschreibt ein bereits gesetztes/manuell angepasstes Datum nicht.
    const wirdGestellt = editStatus === 'gestellt' && antrag.status !== 'gestellt'
    const eingereichtAm = editEingereichtAm || (wirdGestellt ? new Date().toISOString().slice(0, 10) : null)

    const { error } = await supabase
      .from('antraege')
      .update({
        titel: editTitel,
        status: editStatus,
        ergebnis: editStatus === 'abgestimmt' ? editErgebnis || null : null,
        ausschuss: editAusschuss || null,
        ebene: editEbene || null,
        inhalt: editInhalt || null,
        session_id: editSessionId || null,
        eingereicht_am: eingereichtAm,
      })
      .eq('id', antrag.id)
    if (error) {
      setEditError(error.message)
      setEditSaving(false)
      return
    }

    await loadAntrag()
    setEditSaving(false)
    onChanged()
  }

  const istErsteller = antrag?.user_id === userId

  async function handleDelete() {
    if (!antrag || !userId) return
    const { error } = istErsteller
      ? await supabase.from('antraege').delete().eq('id', antrag.id)
      : await supabase.from('antrag_shares').delete().eq('antrag_id', antrag.id).eq('user_id', userId)
    if (error) throw new Error(error.message)
    onChanged()
    onClose()
  }

  /** Mit wem der Antrag außer mir freigegeben ist (antrag_shares). */
  const andereNamen = shares.filter((sh) => sh.user_id !== userId).map((sh) => shareNames.get(sh.user_id) ?? 'Unbekannt')

  async function handleToggleShare(targetUserId: string, aktuellGeteilt: boolean) {
    setShareError(null)
    const { error } = aktuellGeteilt
      ? await supabase.from('antrag_shares').delete().eq('antrag_id', id).eq('user_id', targetUserId)
      : await supabase.from('antrag_shares').insert({ antrag_id: id, user_id: targetUserId })
    if (error) {
      setShareError(error.message)
      return
    }
    await loadSharing()
    onChanged()
  }

  const geteilteFreigaben = shares.filter((s) => s.user_id !== userId)
  const ungeteilteKandidatenGefiltert = candidates
    .filter((c) => !shares.some((s) => s.user_id === c.id))
    .filter((c) => c.name.toLowerCase().includes(shareSearch.trim().toLowerCase()))

  const deadline = antrag ? computeAntragDeadline(linkedSession, antrag.ebene, tageByEbene) : null
  const ueberfaellig = deadline ? deadline.getTime() < jetzt && antrag?.status === 'entwurf' : false

  const mitantragstellerTab = antrag && (
    <>
      {istErsteller ? (
        <>
          <div>
            <label className="mb-1 block text-sm text-slate-600">Ebene (für Mitantragsteller &amp; Frist)</label>
            <select
              value={editEbene}
              onChange={(e) => setEditEbene(e.target.value as Ebene | '')}
              className="mc-input w-full"
            >
              <option value="">– keine –</option>
              {(myProfile?.ebenen ?? []).map((e) => (
                <option key={e} value={e}>
                  {EBENE_LABEL[e]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              Änderung wird erst mit „Speichern" oben übernommen.
              {(myProfile?.ebenen ?? []).length === 0 &&
                ' Trage zuerst in den Einstellungen unter „Profil" deine eigenen Ebenen ein, um Mitantragsteller hinzuzufügen.'}
            </p>
          </div>
          {(geteilteFreigaben.length > 0 || antrag.ebene) && (
            <div className="mt-3">
              <p className="mb-1 text-sm text-slate-600">
                {antrag.ebene ? `Kolleg*innen (gleiche Partei, Ebene ${EBENE_LABEL[antrag.ebene]})` : 'Mitantragsteller'}
              </p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {geteilteFreigaben.map((s) => (
                  <span
                    key={s.user_id}
                    className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
                  >
                    {shareNames.get(s.user_id) ?? '…'}
                    <button
                      type="button"
                      onClick={() => handleToggleShare(s.user_id, true)}
                      aria-label={`${shareNames.get(s.user_id) ?? 'Kolleg*in'} entfernen`}
                      className="text-primary/70 hover:text-primary"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {geteilteFreigaben.length === 0 && (
                  <span className="text-xs text-slate-400">Noch keine Mitantragsteller.</span>
                )}
              </div>
              {antrag.ebene && (
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Mitantragsteller suchen..."
                    value={shareSearch}
                    onChange={(e) => setShareSearch(e.target.value)}
                    onFocus={() => setShareDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setShareDropdownOpen(false), 150)}
                    className="mc-input w-full"
                  />
                  {shareDropdownOpen && (
                    <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                      {ungeteilteKandidatenGefiltert.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onMouseDown={() => {
                              handleToggleShare(c.id, false)
                              setShareSearch('')
                            }}
                            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                          >
                            {c.name}
                          </button>
                        </li>
                      ))}
                      {ungeteilteKandidatenGefiltert.length === 0 && (
                        <li className="px-3 py-1.5 text-sm text-slate-400">
                          {candidates.length === 0
                            ? 'Keine Kolleg*innen mit gleicher Partei und Ebene gefunden.'
                            : 'Keine Treffer.'}
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
          {shareError && <p className="text-red-600 text-sm">{shareError}</p>}
        </>
      ) : (
        <p className="text-sm text-slate-600">
          Du bist Mitantragsteller*in dieses Antrags
          {antrag.ebene ? ` (Ebene ${EBENE_LABEL[antrag.ebene]})` : ''}.
          {geteilteFreigaben.length > 0 &&
            ` Weitere: ${geteilteFreigaben.map((s) => shareNames.get(s.user_id) ?? '…').join(', ')}`}
        </p>
      )}
    </>
  )

  const leftColumn = (
    <>
      {loadError && <p className="text-red-600 mb-4">{loadError}</p>}

      {deadline && (
            <p className={`mb-4 text-sm ${ueberfaellig ? 'font-semibold text-red-600' : 'text-slate-600'}`}>
              Einreichungsfrist: {formatDate(deadline.toISOString())}
              {ueberfaellig && ' · überfällig'}
            </p>
          )}

          {antrag && (
            <form
              id="antrag-edit-form"
              onSubmit={handleSaveEdit}
              className="mb-6 space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4"
            >
              <input
                type="text"
                value={editTitel}
                onChange={(e) => setEditTitel(e.target.value)}
                className="mc-input w-full font-medium"
                required
              />

              <div className="flex gap-2">
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as AntragStatus)}
                  className="mc-input flex-1"
                >
                  {ANTRAG_STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {antragStatusLabel(s, null)}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={editEingereichtAm}
                  onChange={(e) => setEditEingereichtAm(e.target.value)}
                  title="Eingereicht am"
                  className="mc-input flex-1"
                />
              </div>
              {editStatus === 'abgestimmt' && (
                <div className="flex items-center gap-4 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="ergebnis"
                      checked={editErgebnis === 'positiv'}
                      onChange={() => setEditErgebnis('positiv')}
                    />
                    <span className="font-medium text-emerald-700">Positiv</span>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="ergebnis"
                      checked={editErgebnis === 'negativ'}
                      onChange={() => setEditErgebnis('negativ')}
                    />
                    <span className="font-medium text-rose-700">Negativ</span>
                  </label>
                </div>
              )}

              <div className="space-y-1">
                <p className="text-sm text-slate-600">Sitzung, für die der Antrag vorgesehen ist</p>
                <select
                  value={editSessionId}
                  onChange={(e) => handleSessionChange(e.target.value)}
                  className="mc-input w-full"
                >
                  <option value="">— Keine Verknüpfung —</option>
                  {ownSessions.map((se) => (
                    <option key={se.id} value={se.id}>
                      {se.titel} ({formatDate(se.datum)})
                    </option>
                  ))}
                </select>
                {linkedSession && (
                  <p className="text-xs text-slate-500">
                    Aktuell verknüpft:{' '}
                    <Link to={`/termin/session/${linkedSession.id}`} className="underline">
                      {linkedSession.titel} ({formatDateTime(linkedSession.datum)})
                    </Link>
                  </p>
                )}
              </div>

              {editError && <p className="text-red-600 text-sm">{editError}</p>}
            </form>
          )}

      <h2 className="font-semibold mb-2">Mitantragsteller</h2>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">{mitantragstellerTab}</div>
    </>
  )

  const headerActions = antrag && (
    <>
      <button
        type="submit"
        form="antrag-edit-form"
        disabled={editSaving}
        className="mc-btn-primary px-3! py-1.5! text-sm!"
      >
        {editSaving ? 'Speichern...' : 'Speichern'}
      </button>
      <button
        type="button"
        onClick={() =>
          loeschRueckfrage(
            istErsteller
              ? {
                  titel: antrag?.titel ?? '',
                  was: 'Der Antrag',
                  folgen:
                    andereNamen.length > 0
                      ? [
                          `Der Antrag ist freigegeben für ${andereNamen.join(', ')} und verschwindet dort ebenfalls.`,
                          'Kommentare und Dokumente am Antrag gehen mit verloren.',
                          'Das lässt sich nicht rückgängig machen.',
                        ]
                      : undefined,
                  bestaetigungsText: 'Ja, ich möchte diesen Antrag für alle löschen.',
                  ausfuehren: handleDelete,
                }
              : {
                  // Ohne Ersteller-Rolle wird nur die eigene Freigabe entfernt.
                  titel: antrag?.titel ?? '',
                  was: 'Der Antrag',
                  aktionLabel: 'Entfernen',
                  ausfuehren: handleDelete,
                },
          )
        }
        aria-label={istErsteller ? 'Löschen' : 'Entfernen'}
        title={istErsteller ? 'Löschen' : 'Entfernen'}
        className="mc-btn-ghost p-2! text-slate-500 hover:bg-red-50 hover:text-red-600"
      >
        <Trash2 size={17} />
      </button>
    </>
  )

  // Seit 0055 gibt es Notizen nur an Aufgaben und Dokumenten - Kommentare
  // und Notizen am Antrag sind entfallen (es gab keine).
  const rightColumn = (
    <p className="text-sm text-slate-500">
      Notizen zu einem Antrag gehören an die zugehörige Aufgabe oder an das Dokument im Dokumenten-Hub.
    </p>
  )

  return (
    <>
      <DetailModalShell
        title={antrag?.titel ?? 'Antrag'}
        headerActions={headerActions}
        onClose={onClose}
        left={leftColumn}
        right={rightColumn}
      />
      {loeschDialog}
    </>
  )
}
