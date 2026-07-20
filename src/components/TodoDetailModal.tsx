import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type {
  Ebene,
  EventRow,
  Profile,
  SessionRow,
  SummaryRow,
  TodoComment,
  TodoColumn,
  TodoPlacement,
  TodoRow,
} from '../lib/types'
import { formatDate, formatDateTime } from '../lib/format'
import { EBENE_LABEL } from '../lib/sourceColors'
import { DocumentPreviewModal, fileNameFromPath } from './DocumentPreviewModal'

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
  const [editZustaendig, setEditZustaendig] = useState('')
  const [editErledigt, setEditErledigt] = useState(false)
  const [terminModus, setTerminModus] = useState<TerminModus>('keine')
  const [editDatum, setEditDatum] = useState('')
  const [editEventId, setEditEventId] = useState('')
  const [editSessionId, setEditSessionId] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [ownEvents, setOwnEvents] = useState<EventRow[]>([])
  const [ownSessions, setOwnSessions] = useState<SessionRow[]>([])

  // Teilen mit Kolleg*innen gleicher Partei+Ebene (volle Gleichberechtigung,
  // siehe CLAUDE.md/Plan): nur der Ersteller verwaltet Ebene + Freigabeliste.
  const [myProfile, setMyProfile] = useState<Profile | null>(null)
  const [placements, setPlacements] = useState<TodoPlacement[]>([])
  const [placementNames, setPlacementNames] = useState<Map<string, string>>(new Map())
  const [candidates, setCandidates] = useState<Profile[]>([])
  const [shareError, setShareError] = useState<string | null>(null)
  const [shareSearch, setShareSearch] = useState('')
  const [shareDropdownOpen, setShareDropdownOpen] = useState(false)

  const [comments, setComments] = useState<TodoComment[]>([])
  const [commentAuthorNames, setCommentAuthorNames] = useState<Map<string, string>>(new Map())
  const [newComment, setNewComment] = useState('')
  const [savingComment, setSavingComment] = useState(false)

  const [documents, setDocuments] = useState<SummaryRow[]>([])
  const [newFile, setNewFile] = useState<File | null>(null)
  const [savingDocument, setSavingDocument] = useState(false)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [previewDoc, setPreviewDoc] = useState<{ path: string; name: string } | null>(null)

  async function loadTodo() {
    const { data, error } = await supabase.from('todos').select('*').eq('id', id).single()
    if (error || !data) {
      setLoadError('Karte nicht gefunden.')
      return
    }
    setTodo(data)
    setEditTitel(data.titel)
    setEditBeschreibung(data.beschreibung ?? '')
    setEditZustaendig(data.zustaendig ?? '')
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

  async function loadComments() {
    const { data } = await supabase.from('todo_comments').select('*').eq('todo_id', id).order('erstellt_am')
    setComments(data ?? [])
    const ids = Array.from(new Set((data ?? []).map((c) => c.user_id)))
    if (ids.length === 0) {
      setCommentAuthorNames(new Map())
      return
    }
    const { data: profs } = await supabase.from('profiles').select('id, name').in('id', ids)
    setCommentAuthorNames(new Map((profs ?? []).map((p) => [p.id, p.name])))
  }

  async function loadDocuments() {
    const { data } = await supabase.from('summaries').select('*').eq('todo_id', id).order('erstellt_am')
    setDocuments(data ?? [])
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

  // Kandidat*innen fürs Teilen: gleiche Partei UND die auf der Karte gewählte
  // Ebene in den eigenen Ebenen der Kolleg*in. RLS (profiles_select_same_
  // partei_ebene) scoped bereits grob auf "gleiche Partei + irgendeine
  // Ebenen-Überschneidung mit mir" - hier wird zusätzlich exakt auf die
  // gewählte Karten-Ebene gefiltert.
  async function loadCandidates(ebene: Ebene) {
    if (!myProfile?.partei || !userId) {
      setCandidates([])
      return
    }
    const { data } = await supabase.from('profiles').select('*').neq('id', userId)
    const filtered = (data ?? []).filter(
      (p) => p.partei === myProfile.partei && (p.ebenen ?? []).includes(ebene),
    )
    setCandidates(filtered)
  }

  useEffect(() => {
    loadTodo()
    loadComments()
    loadDocuments()
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
      zustaendig: editZustaendig || null,
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
    setDeleteError(null)
    const { error } = istErsteller
      ? await supabase.from('todos').delete().eq('id', todo.id)
      : await supabase.from('todo_placements').delete().eq('todo_id', todo.id).eq('user_id', userId)
    if (error) {
      setDeleteError(error.message)
      return
    }
    onChanged()
    onClose()
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

  async function handleAddComment(e: FormEvent) {
    e.preventDefault()
    if (!userId || !newComment.trim()) return
    setSavingComment(true)
    const { error } = await supabase
      .from('todo_comments')
      .insert({ todo_id: id, user_id: userId, inhalt: newComment.trim() })
    if (!error) {
      setNewComment('')
      await loadComments()
    }
    setSavingComment(false)
  }

  async function handleDeleteComment(commentId: string) {
    await supabase.from('todo_comments').delete().eq('id', commentId)
    await loadComments()
  }

  async function handleUploadDocument(e: FormEvent) {
    e.preventDefault()
    if (!userId || !newFile) return
    setSavingDocument(true)
    setDocumentError(null)
    const path = `${userId}/${Date.now()}-${newFile.name}`
    const { error: uploadError } = await supabase.storage.from('zusammenfassungen').upload(path, newFile)
    if (uploadError) {
      setDocumentError(uploadError.message)
      setSavingDocument(false)
      return
    }
    const { error } = await supabase.from('summaries').insert({ user_id: userId, todo_id: id, datei_url: path })
    if (error) {
      setDocumentError(error.message)
    } else {
      setNewFile(null)
      await loadDocuments()
    }
    setSavingDocument(false)
  }

  async function handleDeleteDocument(documentId: string) {
    await supabase.from('summaries').delete().eq('id', documentId)
    await loadDocuments()
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

  return (
    <>
    <div
      className="mc-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="mc-animate-pop max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between gap-4">
          <h1 className="truncate text-xl font-bold text-slate-900">{todo?.titel ?? 'Karte'}</h1>
          <button type="button" onClick={onClose} className="mc-btn-ghost shrink-0">
            Schließen
          </button>
        </header>

        {loadError && <p className="text-red-600 mb-4">{loadError}</p>}

        {todo && (
          <form onSubmit={handleSaveEdit} className="mb-6 space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4">
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
            <input
              type="text"
              placeholder="Zuständig (optional)"
              value={editZustaendig}
              onChange={(e) => setEditZustaendig(e.target.value)}
              className="mc-input w-full"
            />

            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={editErledigt}
                onChange={(e) => setEditErledigt(e.target.checked)}
              />
              Erledigt
            </label>

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
                  <Link to={`/termin/session/${linkedSession.id}`} className="underline">
                    {linkedSession.titel} ({formatDateTime(linkedSession.datum)})
                  </Link>
                </p>
              )}
            </div>

            {editError && <p className="text-red-600 text-sm">{editError}</p>}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={editSaving}
                className="mc-btn-primary"
              >
                {editSaving ? 'Speichern...' : 'Speichern'}
              </button>
              <button type="button" onClick={handleDelete} className="mc-btn-danger">
                {istErsteller ? 'Löschen' : 'Von meinem Board entfernen'}
              </button>
            </div>
            {deleteError && <p className="text-red-600 text-sm">{deleteError}</p>}
          </form>
        )}

        {todo && (
          <div className="mb-6 space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-700">Teilen</p>
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
                  <div>
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
          </div>
        )}

        <h2 className="font-semibold mb-2">Kommentare</h2>
        <ul className="space-y-2 mb-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <p className="text-sm whitespace-pre-wrap">{c.inhalt}</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-slate-400">
                  {c.user_id === userId ? 'Du' : commentAuthorNames.get(c.user_id) ?? 'Unbekannt'} ·{' '}
                  {formatDateTime(c.erstellt_am)}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeleteComment(c.id)}
                  className="mc-btn-danger !px-2 !py-1 !text-xs"
                >
                  Löschen
                </button>
              </div>
            </li>
          ))}
          {comments.length === 0 && <li className="text-slate-400 text-sm">Noch keine Kommentare.</li>}
        </ul>
        <form onSubmit={handleAddComment} className="mb-6 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <textarea
            placeholder="Kommentar hinzufügen"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="mc-input w-full"
            rows={2}
          />
          <button
            type="submit"
            disabled={savingComment || !newComment.trim()}
            className="mc-btn-primary"
          >
            {savingComment ? 'Speichern...' : 'Kommentieren'}
          </button>
        </form>

        <h2 className="font-semibold mb-2">Dokumente</h2>
        <ul className="space-y-2 mb-3">
          {documents.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm"
            >
              {d.datei_url && (
                <button
                  type="button"
                  onClick={() => setPreviewDoc({ path: d.datei_url!, name: fileNameFromPath(d.datei_url!) })}
                  className="mc-btn-ghost !px-2 !py-1 !text-xs"
                >
                  📎 {fileNameFromPath(d.datei_url)}
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDeleteDocument(d.id)}
                className="mc-btn-danger !px-2 !py-1 !text-xs"
              >
                Löschen
              </button>
            </li>
          ))}
          {documents.length === 0 && <li className="text-slate-400 text-sm">Noch keine Dokumente.</li>}
        </ul>
        <form onSubmit={handleUploadDocument} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <input
            type="file"
            onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm"
          />
          {documentError && <p className="text-red-600 text-sm">{documentError}</p>}
          <button
            type="submit"
            disabled={savingDocument || !newFile}
            className="mc-btn-primary"
          >
            {savingDocument ? 'Hochladen...' : 'Hochladen'}
          </button>
        </form>
      </div>
    </div>
    {previewDoc && (
      <DocumentPreviewModal
        path={previewDoc.path}
        fileName={previewDoc.name}
        onClose={() => setPreviewDoc(null)}
      />
    )}
    </>
  )
}
