import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { DOKUMENT_LISTEN_SPALTEN } from '../lib/dokumentSpalten'
import type {
  DokumentListenZeile,
  Ebene,
  EventRow,
  Profile,
  SessionRow,
  SummaryRow,
  TodoColumn,
  TodoPlacement,
  TodoRow,
} from '../lib/types'
import { formatDate, formatDateTime } from '../lib/format'
import { EBENE_LABEL } from '../lib/sourceColors'
import { gleicheGliederung } from '../lib/gliederung'
import { DetailModalShell } from './DetailModalShell'
import { useLoeschDialog } from './LoeschDialog'

type TerminModus = 'keine' | 'datum' | 'termin' | 'sitzung'

export function TodoDetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: string
  onClose: () => void
  onChanged: () => void
}) {
  const [userId, setUserId] = useState<string | null>(null)
  const [todo, setTodo] = useState<TodoRow | null>(null)
  const [columns, setColumns] = useState<TodoColumn[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const [linkedEvent, setLinkedEvent] = useState<EventRow | null>(null)
  const [linkedSession, setLinkedSession] = useState<SessionRow | null>(null)

  const [editTitel, setEditTitel] = useState('')
  const [editBeschreibung, setEditBeschreibung] = useState('')
  const [editErledigt, setEditErledigt] = useState(false)
  const [terminModus, setTerminModus] = useState<TerminModus>('keine')
  const [editDatum, setEditDatum] = useState('')
  const [editEventId, setEditEventId] = useState('')
  const [editSessionId, setEditSessionId] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [ownEvents, setOwnEvents] = useState<EventRow[]>([])
  const [ownSessions, setOwnSessions] = useState<SessionRow[]>([])

  // Teilen mit Kolleg*innen gleicher Partei+Ebene (volle Gleichberechtigung,
  // siehe CLAUDE.md/Plan): nur der Ersteller verwaltet Ebene + Freigabeliste.
  const [myProfile, setMyProfile] = useState<Profile | null>(null)
  const [placements, setPlacements] = useState<TodoPlacement[]>([])
  const [placementNames, setPlacementNames] = useState<Map<string, string>>(new Map())
  const [candidates, setCandidates] = useState<Profile[]>([])
  const [shareError, setShareError] = useState<string | null>(null)
  const [zustaendigFehler, setZustaendigFehler] = useState<string | null>(null)
  const [shareSearch, setShareSearch] = useState('')
  const [shareDropdownOpen, setShareDropdownOpen] = useState(false)

  // Notizen an der Karte (summaries.todo_id) - seit 0055 das einzige
  // Notiz-System an Aufgaben, die früheren Kommentare sind darin aufgegangen.
  // Sichtbar für alle, auf deren Board die Karte liegt.
  const [notizen, setNotizen] = useState<SummaryRow[]>([])
  const [autorNamen, setAutorNamen] = useState<Map<string, string>>(new Map())
  const [neueNotiz, setNeueNotiz] = useState('')
  const [notizSpeichert, setNotizSpeichert] = useState(false)
  const [notizFehler, setNotizFehler] = useState<string | null>(null)

  // Verknüpfte Dokumente aus dem Dokumenten-Hub (n:m über todo_dokumente,
  // siehe 0037_todo_dokumente.sql) - bewusst getrennt von "documents" oben
  // (das sind die Notizen direkt an der Karte, summaries-Tabelle).
  const [linkedDokumente, setLinkedDokumente] = useState<DokumentListenZeile[]>([])
  const [dokumentSearch, setDokumentSearch] = useState('')
  const [dokumentSearchResults, setDokumentSearchResults] = useState<DokumentListenZeile[]>([])
  const [dokumentDropdownOpen, setDokumentDropdownOpen] = useState(false)
  const [linkDokumentError, setLinkDokumentError] = useState<string | null>(null)

  const { fragen: loeschRueckfrage, dialog: loeschDialog } = useLoeschDialog()

  async function loadTodo() {
    const { data, error } = await supabase.from('todos').select('*').eq('id', id).single()
    if (error || !data) {
      setLoadError('Karte nicht gefunden.')
      return
    }
    setTodo(data)
    setEditTitel(data.titel)
    setEditBeschreibung(data.beschreibung ?? '')
    setEditErledigt(data.erledigt)
    if (data.event_id) {
      setTerminModus('termin')
      setEditEventId(data.event_id)
    } else if (data.session_id) {
      setTerminModus('sitzung')
      setEditSessionId(data.session_id)
    } else if (data.faellig_am) {
      setTerminModus('datum')
      setEditDatum(data.faellig_am)
    } else {
      setTerminModus('keine')
    }
    setLinkedEvent(null)
    setLinkedSession(null)
    if (data.event_id) {
      const { data: ev } = await supabase.from('events').select('*').eq('id', data.event_id).single()
      if (ev) setLinkedEvent(ev)
    }
    if (data.session_id) {
      const { data: se } = await supabase.from('sessions').select('*').eq('id', data.session_id).single()
      if (se) setLinkedSession(se)
    }
  }

  async function loadNotizen() {
    const { data } = await supabase.from('summaries').select('*').eq('todo_id', id).order('erstellt_am')
    const ids = Array.from(new Set((data ?? []).map((n) => n.user_id)))
    const { data: profs } =
      ids.length > 0 ? await supabase.from('profiles').select('id, name').in('id', ids) : { data: [] }
    // Beide nach demselben await setzen (siehe CLAUDE.md).
    setAutorNamen(new Map((profs ?? []).map((p) => [p.id, p.name])))
    setNotizen(data ?? [])
  }

  // RLS auf todo_dokumente/dokumente filtert bereits auf das für den Nutzer
  // Sichtbare (siehe 0037_todo_dokumente.sql) - die Web-UI läuft mit der
  // echten Nutzer-Session, anders als der MCP-Server über Service-Role.
  async function loadLinkedDokumente() {
    const { data: links } = await supabase.from('todo_dokumente').select('dokument_id').eq('todo_id', id)
    const ids = (links ?? []).map((l) => l.dokument_id as string)
    if (ids.length === 0) {
      setLinkedDokumente([])
      return
    }
    const { data } = await supabase.from('dokumente').select(DOKUMENT_LISTEN_SPALTEN).in('id', ids).order('erstellt_am', { ascending: false })
    setLinkedDokumente(data ?? [])
  }

  async function handleSearchDokumente(query: string) {
    setDokumentSearch(query)
    if (!query.trim()) {
      setDokumentSearchResults([])
      return
    }
    const { data } = await supabase.from('dokumente').select(DOKUMENT_LISTEN_SPALTEN).ilike('titel', `%${query.trim()}%`).limit(8)
    setDokumentSearchResults((data ?? []).filter((d) => !linkedDokumente.some((ld) => ld.id === d.id)))
  }

  async function handleLinkDokument(dokumentId: string) {
    setLinkDokumentError(null)
    const { error } = await supabase.from('todo_dokumente').insert({ todo_id: id, dokument_id: dokumentId })
    if (error) {
      setLinkDokumentError(error.message)
      return
    }
    setDokumentSearch('')
    setDokumentSearchResults([])
    await loadLinkedDokumente()
  }

  async function handleUnlinkDokument(dokumentId: string) {
    await supabase.from('todo_dokumente').delete().eq('todo_id', id).eq('dokument_id', dokumentId)
    await loadLinkedDokumente()
  }

  // Volle Platzierungsliste dieser Karte (alle Personen, für die sie auf dem
  // Board erscheint) - für den Ersteller der Checkbox-Zustand in der
  // Kandidatenliste, für alle anderen die read-only "Geteilt mit"-Anzeige.
  // RLS erlaubt jeder platzierten Person, alle Platzierungen derselben Karte
  // zu lesen (todo_placements_select, siehe Migration 0021).
  async function loadSharing() {
    const { data: pl } = await supabase.from('todo_placements').select('*').eq('todo_id', id)
    setPlacements(pl ?? [])
    const ids = Array.from(new Set((pl ?? []).map((p) => p.user_id)))
    if (ids.length === 0) {
      setPlacementNames(new Map())
      return
    }
    const { data: profs } = await supabase.from('profiles').select('id, name').in('id', ids)
    setPlacementNames(new Map((profs ?? []).map((p) => [p.id, p.name])))
  }

  // Kandidat*innen fürs Teilen: gleiche Partei, die auf der Karte gewählte
  // Ebene in den eigenen Ebenen der Kolleg*in UND (außer bei Bund) dieselbe
  // Gliederung (welche Kommune/welcher Kreis/welches Land - siehe
  // src/lib/gliederung.ts, verhindert Querverbindungen zwischen
  // Mitgliedern derselben Partei aus unterschiedlichen Städten). RLS
  // (profiles_select_same_partei_ebene) scoped bereits grob auf "gleiche
  // Partei + irgendeine Ebenen-Überschneidung mit mir" - hier wird
  // zusätzlich exakt auf die gewählte Karten-Ebene und -Gliederung gefiltert.
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
    loadTodo()
    loadNotizen()
    loadLinkedDokumente()
    loadSharing()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      const { data: cols } = await supabase.from('todo_columns').select('*').eq('user_id', data.user.id)
      setColumns(cols ?? [])
      const { data: events } = await supabase.from('events').select('*').order('start')
      setOwnEvents(events ?? [])
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
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Kandidatenliste neu laden, sobald die Karten-Ebene oder das eigene Profil
  // bekannt ist bzw. sich ändert (nur relevant für den Ersteller).
  useEffect(() => {
    if (todo?.user_id === userId && todo?.ebene) {
      loadCandidates(todo.ebene)
    } else {
      setCandidates([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todo?.ebene, todo?.user_id, userId, myProfile])

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!todo) return
    setEditSaving(true)
    setEditError(null)

    // erledigt_am nur beim ÜBERGANG false->true neu setzen, damit ein
    // erneutes Speichern ohne Statuswechsel den 5-Tage-Countdown (siehe
    // TodoBoard.tsx) nicht zurücksetzt.
    const erledigtWurdeGesetzt = editErledigt && !todo.erledigt
    const update: Partial<TodoRow> = {
      titel: editTitel,
      beschreibung: editBeschreibung || null,
      faellig_am: terminModus === 'datum' ? editDatum || null : null,
      event_id: terminModus === 'termin' ? editEventId || null : null,
      session_id: terminModus === 'sitzung' ? editSessionId || null : null,
      erledigt: editErledigt,
      erledigt_am: editErledigt ? (erledigtWurdeGesetzt ? new Date().toISOString() : todo.erledigt_am) : null,
    }

    const { error } = await supabase.from('todos').update(update).eq('id', todo.id)
    if (error) {
      setEditError(error.message)
      setEditSaving(false)
      return
    }

    // Auto-Verschieben nach "Geplant": nur wenn die Karte auf dem EIGENEN
    // Board gerade in einer Spalte namens "Neu" liegt, ein Termin/Datum neu
    // verknüpft wurde und eine Spalte "Geplant" existiert. Spaltennamen sind
    // frei änderbar - greift also nur, solange die Standardnamen noch
    // stimmen. Bewegt nur die eigene Platzierung (siehe TodoBoard.tsx:
    // fremde Platzierungen dürfen per RLS nicht angefasst werden).
    if (terminModus !== 'keine' && userId) {
      const { data: myPlacement } = await supabase
        .from('todo_placements')
        .select('*')
        .eq('todo_id', todo.id)
        .eq('user_id', userId)
        .single()
      const currentColumn = columns.find((c) => c.id === myPlacement?.column_id)
      const geplantColumn = columns.find((c) => c.titel.toLowerCase() === 'geplant')
      if (currentColumn?.titel.toLowerCase() === 'neu' && geplantColumn) {
        await supabase
          .from('todo_placements')
          .update({ column_id: geplantColumn.id })
          .eq('todo_id', todo.id)
          .eq('user_id', userId)
      }
    }

    await loadTodo()
    setEditSaving(false)
    onChanged()
  }

  // Nur der Ersteller löscht die Karte komplett (für alle Platzierten). Wer
  // nur mitgeteilt wurde, trägt sich stattdessen selbst aus - entfernt die
  // Karte vom eigenen Board, ohne sie für andere zu löschen (volle
  // Gleichberechtigung heißt nicht, dass jeder für alle löschen darf).
  const istErsteller = todo?.user_id === userId

  async function handleDelete() {
    if (!todo || !userId) return
    const { error } = istErsteller
      ? await supabase.from('todos').delete().eq('id', todo.id)
      : await supabase.from('todo_placements').delete().eq('todo_id', todo.id).eq('user_id', userId)
    if (error) throw new Error(error.message)
    onChanged()
    onClose()
  }

  /** Mit wem die Karte außer mir auf einem Board liegt (todo_placements). */
  const andereBoards = placements.filter((pl) => pl.user_id !== userId)
  const andereNamen = andereBoards.map((pl) => placementNames.get(pl.user_id) ?? 'Unbekannt')

  /** Notizen an einer geteilten Karte sehen alle Platzierten. */
  function geteilteKartenFolgen(was: string): string[] | undefined {
    if (andereNamen.length === 0) return undefined
    return [
      `${was} an dieser Karte ist auch für ${andereNamen.join(', ')} sichtbar und verschwindet dort ebenfalls.`,
      'Das lässt sich nicht rückgängig machen.',
    ]
  }

  async function handleSaveEbene(value: string) {
    if (!todo || !userId) return
    const ebene = (value || null) as Ebene | null
    setTodo({ ...todo, ebene })
    await supabase.from('todos').update({ ebene }).eq('id', todo.id)
    if (!ebene) {
      // "– keine –" heißt "nicht mehr geteilt": bestehende Freigaben mit
      // entfernen, sonst bliebe die Karte für bereits geteilte Kolleg*innen
      // weiterhin sichtbar, obwohl die Ebene-Auswahl das Gegenteil suggeriert.
      await supabase.from('todo_placements').delete().eq('todo_id', todo.id).neq('user_id', userId)
      await loadSharing()
    }
    onChanged()
  }

  // Zuweisen (0056): die Person muss die Karte auf dem Board haben. Wer sie
  // noch nicht hat, bekommt sie vorher geteilt - das darf nur der Ersteller,
  // und share-todo prüft dabei gleiche Partei und Ebene. Der Trigger
  // pruefe_zustaendigkeit hält die Regel auch ohne diese Oberfläche ein.
  async function handleSaveZustaendig(value: string) {
    if (!todo) return
    setZustaendigFehler(null)
    const ziel = value || null
    const hatKarte = !ziel || ziel === todo.user_id || placements.some((p) => p.user_id === ziel)
    if (!hatKarte) {
      const { error } = await supabase.functions.invoke('share-todo', {
        body: { action: 'share', todo_id: id, target_user_id: ziel },
      })
      if (error) {
        setZustaendigFehler(error.message)
        return
      }
      await loadSharing()
    }
    const { error } = await supabase.from('todos').update({ zustaendig_user_id: ziel }).eq('id', todo.id)
    if (error) {
      setZustaendigFehler(error.message)
      return
    }
    setTodo({ ...todo, zustaendig_user_id: ziel })
    onChanged()
  }

  async function handleToggleShare(targetUserId: string, aktuellGeteilt: boolean) {
    setShareError(null)
    if (aktuellGeteilt) {
      const { error } = await supabase
        .from('todo_placements')
        .delete()
        .eq('todo_id', id)
        .eq('user_id', targetUserId)
      if (error) {
        setShareError(error.message)
        return
      }
    } else {
      const { error } = await supabase.functions.invoke('share-todo', {
        body: { action: 'share', todo_id: id, target_user_id: targetUserId },
      })
      if (error) {
        setShareError(error.message)
        return
      }
    }
    await loadSharing()
    onChanged()
  }

  async function handleAddNotiz(e: FormEvent) {
    e.preventDefault()
    if (!userId || !neueNotiz.trim()) return
    setNotizSpeichert(true)
    setNotizFehler(null)
    const { error } = await supabase
      .from('summaries')
      .insert({ todo_id: id, user_id: userId, inhalt: neueNotiz.trim() })
    if (error) {
      setNotizFehler(error.message)
    } else {
      setNeueNotiz('')
      await loadNotizen()
    }
    setNotizSpeichert(false)
  }

  async function handleDeleteNotiz(notizId: string) {
    const { error } = await supabase.from('summaries').delete().eq('id', notizId)
    if (error) throw new Error(error.message)
    await loadNotizen()
  }

  // Bereits geteilt = tatsächliche todo_placements-Zeilen (unabhängig von der
  // aktuell gewählten Ebene!) - candidates ist nach der gewählten Ebene
  // gefiltert und wäre leer, sobald die Ebene z. B. wieder auf "keine"
  // gesetzt wird, obwohl noch Freigaben bestehen können (Bugreport: Ebene
  // stand auf "keine", ein Kollege hatte die Karte aber weiterhin auf seinem
  // Board - die Chips müssen also von placements/placementNames kommen,
  // nicht von candidates). Kandidatenliste kann bei größeren Fraktionen/
  // Parteien lang werden - der Rest über eine Such-Dropdown statt einer
  // langen Checkbox-Liste hinzufügbar.
  const geteiltePlatzierungen = placements.filter((p) => p.user_id !== userId)
  const ungeteilteKandidatenGefiltert = candidates
    .filter((c) => !placements.some((p) => p.user_id === c.id))
    .filter((c) => c.name.toLowerCase().includes(shareSearch.trim().toLowerCase()))

  // Zur Auswahl: wer die Karte schon hat (Ersteller und Platzierte) und - nur
  // für den Ersteller - die Kandidat*innen, denen sie dabei geteilt würde.
  const zustaendigOptionen = todo
    ? [
        ...new Map(
          [
            { id: todo.user_id, name: placementNames.get(todo.user_id) ?? (istErsteller ? myProfile?.name : undefined) ?? 'Ersteller*in' },
            ...placements.map((p) => ({ id: p.user_id, name: placementNames.get(p.user_id) ?? '…' })),
            ...(istErsteller ? candidates.map((c) => ({ id: c.id, name: c.name })) : []),
          ].map((o) => [o.id, o]),
        ).values(),
      ]
    : []

  const zustaendigBlock = todo && (
    <>
      <select
        value={todo.zustaendig_user_id ?? ''}
        onChange={(e) => handleSaveZustaendig(e.target.value)}
        className="mc-input w-full"
      >
        <option value="">– niemand –</option>
        {zustaendigOptionen.map((o) => (
          <option key={o.id} value={o.id}>
            {o.id === userId ? `${o.name} (ich)` : o.name}
            {!placements.some((p) => p.user_id === o.id) && o.id !== todo.user_id ? ' – wird dabei geteilt' : ''}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-slate-400">
        {istErsteller
          ? todo.ebene
            ? 'Wer zuständig ist, bekommt die Karte auf das eigene Board und kann sie bearbeiten.'
            : 'Für Kolleg*innen unten unter „Teilen" eine Ebene wählen – zuweisen lässt sich, wer die Karte teilen kann.'
          : 'Zuweisen lässt sich, wer die Karte schon auf dem Board hat.'}
      </p>
      {zustaendigFehler && <p className="text-red-600 text-sm">{zustaendigFehler}</p>}
    </>
  )

  const teilenTab = todo && (
    <>
      {istErsteller ? (
        <>
          <div>
            <label className="mb-1 block text-sm text-slate-600">Ebene</label>
            <select
              value={todo.ebene ?? ''}
              onChange={(e) => handleSaveEbene(e.target.value)}
              className="mc-input w-full"
            >
              <option value="">– keine –</option>
              {(myProfile?.ebenen ?? []).map((e) => (
                <option key={e} value={e}>
                  {EBENE_LABEL[e]}
                </option>
              ))}
            </select>
            {(myProfile?.ebenen ?? []).length === 0 && (
              <p className="mt-1 text-xs text-slate-400">
                Trage zuerst in den Einstellungen unter „Profil" deine eigenen Ebenen ein, um Karten
                teilen zu können.
              </p>
            )}
          </div>
          {(geteiltePlatzierungen.length > 0 || todo.ebene) && (
            <div className="mt-3">
              <p className="mb-1 text-sm text-slate-600">
                {todo.ebene ? `Kolleg*innen (gleiche Partei, Ebene ${EBENE_LABEL[todo.ebene]})` : 'Geteilt mit'}
              </p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {geteiltePlatzierungen.map((p) => (
                  <span
                    key={p.user_id}
                    className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
                  >
                    {placementNames.get(p.user_id) ?? '…'}
                    <button
                      type="button"
                      onClick={() => handleToggleShare(p.user_id, true)}
                      aria-label={`${placementNames.get(p.user_id) ?? 'Kolleg*in'} entfernen`}
                      className="text-primary/70 hover:text-primary"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {geteiltePlatzierungen.length === 0 && (
                  <span className="text-xs text-slate-400">Noch mit niemandem geteilt.</span>
                )}
              </div>
              {todo.ebene && (
              <div className="relative">
                <input
                  type="text"
                  placeholder="Kolleg*in suchen..."
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
        placements.length > 1 && (
          <p className="text-sm text-slate-600">
            {todo.ebene ? `Geteilt für Ebene ${EBENE_LABEL[todo.ebene]}` : 'Geteilt'} · Mitglieder:{' '}
            {placements.map((p) => placementNames.get(p.user_id) ?? '…').join(', ')}
          </p>
        )
      )}
    </>
  )

  const leftColumn = (
    <>
      {loadError && <p className="text-red-600 mb-4">{loadError}</p>}

      {todo && (
          <form
            id="todo-edit-form"
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
            <textarea
              placeholder="Beschreibung (optional)"
              value={editBeschreibung}
              onChange={(e) => setEditBeschreibung(e.target.value)}
              className="mc-input w-full"
              rows={3}
            />

            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="text-sm font-medium text-slate-700">Erledigt</span>
              <button
                type="button"
                role="switch"
                aria-checked={editErledigt}
                aria-label="Erledigt"
                onClick={() => setEditErledigt((v) => !v)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${editErledigt ? 'bg-primary' : 'bg-slate-300'}`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${editErledigt ? 'translate-x-5' : 'translate-x-0'}`}
                />
              </button>
            </div>

            <div className="space-y-1">
              <p className="text-sm text-slate-600">Termin-Verknüpfung</p>
              <div className="flex flex-wrap gap-3 text-sm">
                {(['keine', 'datum', 'termin', 'sitzung'] as TerminModus[]).map((modus) => (
                  <label key={modus} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="terminModus"
                      checked={terminModus === modus}
                      onChange={() => setTerminModus(modus)}
                    />
                    {modus === 'keine' && 'Keine'}
                    {modus === 'datum' && 'Datum'}
                    {modus === 'termin' && 'Eigener Termin'}
                    {modus === 'sitzung' && 'Sitzung'}
                  </label>
                ))}
              </div>
              {terminModus === 'datum' && (
                <input
                  type="date"
                  value={editDatum}
                  onChange={(e) => setEditDatum(e.target.value)}
                  className="mc-input w-full"
                />
              )}
              {terminModus === 'termin' && (
                <select
                  value={editEventId}
                  onChange={(e) => setEditEventId(e.target.value)}
                  className="mc-input w-full"
                >
                  <option value="">Bitte wählen...</option>
                  {ownEvents.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.titel} ({formatDate(ev.start)})
                    </option>
                  ))}
                </select>
              )}
              {terminModus === 'sitzung' && (
                <select
                  value={editSessionId}
                  onChange={(e) => setEditSessionId(e.target.value)}
                  className="mc-input w-full"
                >
                  <option value="">Bitte wählen...</option>
                  {/* linkedSession kann außerhalb der eigenen Gremien-Auswahl liegen (z. B. per
                      MCP-Tool gesetzt) - ohne diesen Zusatz würde der <select> dann klanglos auf
                      "Bitte wählen..." zurückfallen, obwohl tatsächlich eine Verknüpfung besteht. */}
                  {linkedSession && !ownSessions.some((se) => se.id === linkedSession.id) && (
                    <option value={linkedSession.id}>
                      {linkedSession.titel} ({formatDate(linkedSession.datum)})
                    </option>
                  )}
                  {ownSessions.map((se) => (
                    <option key={se.id} value={se.id}>
                      {se.titel} ({formatDate(se.datum)})
                    </option>
                  ))}
                </select>
              )}
              {linkedEvent && (
                <p className="text-xs text-slate-500">
                  Aktuell verknüpft:{' '}
                  <Link to={`/termin/event/${linkedEvent.id}`} className="underline">
                    {linkedEvent.titel} ({formatDateTime(linkedEvent.start)})
                  </Link>
                </p>
              )}
              {linkedSession && (
                <p className="text-xs text-slate-500">
                  Aktuell verknüpft:{' '}
                  <Link to={`/sitzungen/${linkedSession.id}`} className="underline">
                    {linkedSession.titel} ({formatDateTime(linkedSession.datum)})
                  </Link>
                </p>
              )}
            </div>

            {editError && <p className="text-red-600 text-sm">{editError}</p>}
          </form>
        )}

      <h2 className="font-semibold mb-2">Verknüpfte Sitzungen</h2>
      <ul className="mb-6 space-y-2">
        {linkedSession && (
          <li>
            <Link
              to={`/sitzungen/${linkedSession.id}`}
              className="block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-xs transition-shadow duration-150 hover:shadow-md"
            >
              {linkedSession.titel} ({formatDate(linkedSession.datum)})
            </Link>
          </li>
        )}
        {!linkedSession && <li className="text-slate-400 text-sm">Keine verknüpfte Sitzung.</li>}
      </ul>

      <h2 className="font-semibold mb-2">Verknüpfte Dokumente</h2>
      <ul className="mb-2 space-y-2">
        {linkedDokumente.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xs"
          >
            <span className="truncate text-sm font-medium text-slate-800">{d.titel}</span>
            <button
              type="button"
              onClick={() => handleUnlinkDokument(d.id)}
              className="mc-btn-ghost shrink-0! px-2! py-1! text-xs!"
            >
              Lösen
            </button>
          </li>
        ))}
        {linkedDokumente.length === 0 && <li className="text-slate-400 text-sm">Keine verknüpften Dokumente.</li>}
      </ul>
      <div className="relative mb-6">
        <input
          type="text"
          placeholder="Dokument suchen und verknüpfen..."
          value={dokumentSearch}
          onChange={(e) => handleSearchDokumente(e.target.value)}
          onFocus={() => setDokumentDropdownOpen(true)}
          onBlur={() => setTimeout(() => setDokumentDropdownOpen(false), 150)}
          className="mc-input w-full"
        />
        {dokumentDropdownOpen && dokumentSearch.trim() && (
          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {dokumentSearchResults.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onMouseDown={() => handleLinkDokument(d.id)}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                >
                  {d.titel}
                </button>
              </li>
            ))}
            {dokumentSearchResults.length === 0 && (
              <li className="px-3 py-1.5 text-sm text-slate-400">Keine Treffer.</li>
            )}
          </ul>
        )}
      </div>
      {linkDokumentError && <p className="mb-4 text-sm text-red-600">{linkDokumentError}</p>}

      <h2 className="font-semibold mb-2">Zuständig</h2>
      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4">{zustaendigBlock}</div>

      <h2 className="font-semibold mb-2">Teilen</h2>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">{teilenTab}</div>
    </>
  )

  const headerActions = todo && (
    <>
      <button
        type="submit"
        form="todo-edit-form"
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
                  titel: todo?.titel ?? '',
                  was: 'Die Karte',
                  // Nur der Ersteller löscht für alle - deshalb hier die
                  // Folgen-Variante, sobald die Karte auf fremden Boards liegt.
                  folgen:
                    andereNamen.length > 0
                      ? [
                          `Die Karte liegt auch auf dem Board von ${andereNamen.join(', ')} und verschwindet dort ebenfalls.`,
                          'Die Notizen an der Karte gehen mit verloren.',
                          'Das lässt sich nicht rückgängig machen.',
                        ]
                      : undefined,
                  bestaetigungsText: 'Ja, ich möchte diese Karte für alle löschen.',
                  ausfuehren: handleDelete,
                }
              : {
                  // Wer nur mitgeteilt wurde, entfernt die Karte allein von
                  // seinem eigenen Board - für andere ändert sich nichts.
                  titel: todo?.titel ?? '',
                  was: 'Die Karte',
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

  const rightColumn = (
    <>
      <h2 className="font-semibold mb-2">Notizen</h2>
      <ul className="space-y-2 mb-3">
        {notizen.map((n) => (
          <li key={n.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xs">
            <p className="text-sm whitespace-pre-wrap">{n.inhalt}</p>
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-slate-400">
                {n.user_id === userId ? 'Du' : autorNamen.get(n.user_id) ?? 'Unbekannt'} ·{' '}
                {formatDateTime(n.erstellt_am)}
              </span>
              {n.user_id === userId && (
                <button
                  type="button"
                  onClick={() => {
                    const text = n.inhalt ?? ''
                    loeschRueckfrage({
                      titel: text.length > 70 ? `${text.slice(0, 70)}…` : text,
                      was: 'Die Notiz',
                      folgen: geteilteKartenFolgen('Die Notiz'),
                      ausfuehren: () => handleDeleteNotiz(n.id),
                    })
                  }}
                  className="mc-btn-danger px-2! py-1! text-xs!"
                >
                  Löschen
                </button>
              )}
            </div>
          </li>
        ))}
        {notizen.length === 0 && <li className="text-slate-400 text-sm">Noch keine Notizen.</li>}
      </ul>
      <form onSubmit={handleAddNotiz} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <textarea
          placeholder="Notiz hinzufügen"
          value={neueNotiz}
          onChange={(e) => setNeueNotiz(e.target.value)}
          className="mc-input w-full"
          rows={3}
        />
        {notizFehler && <p className="text-red-600 text-sm">{notizFehler}</p>}
        <button type="submit" disabled={notizSpeichert || !neueNotiz.trim()} className="mc-btn-primary">
          {notizSpeichert ? 'Speichern...' : 'Hinzufügen'}
        </button>
      </form>
    </>
  )

  return (
    <>
      <DetailModalShell
        title={todo?.titel ?? 'Karte'}
        headerActions={headerActions}
        onClose={onClose}
        left={leftColumn}
        right={rightColumn}
      />
      {loeschDialog}
    </>
  )
}
