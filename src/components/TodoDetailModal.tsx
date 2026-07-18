import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { EventRow, SessionRow, SummaryRow, TodoComment, TodoColumn, TodoRow } from '../lib/types'
import { formatDate, formatDateTime } from '../lib/format'

type TerminModus = 'keine' | 'datum' | 'termin' | 'sitzung'

function fileNameFromPath(path: string): string {
  return path.split('/').pop() ?? path
}

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
  const [terminModus, setTerminModus] = useState<TerminModus>('keine')
  const [editDatum, setEditDatum] = useState('')
  const [editEventId, setEditEventId] = useState('')
  const [editSessionId, setEditSessionId] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [ownEvents, setOwnEvents] = useState<EventRow[]>([])
  const [ownSessions, setOwnSessions] = useState<SessionRow[]>([])

  const [comments, setComments] = useState<TodoComment[]>([])
  const [newComment, setNewComment] = useState('')
  const [savingComment, setSavingComment] = useState(false)

  const [documents, setDocuments] = useState<SummaryRow[]>([])
  const [newFile, setNewFile] = useState<File | null>(null)
  const [savingDocument, setSavingDocument] = useState(false)
  const [documentError, setDocumentError] = useState<string | null>(null)

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
  }

  async function loadDocuments() {
    const { data } = await supabase.from('summaries').select('*').eq('todo_id', id).order('erstellt_am')
    setDocuments(data ?? [])
  }

  useEffect(() => {
    loadTodo()
    loadComments()
    loadDocuments()
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
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!todo) return
    setEditSaving(true)
    setEditError(null)

    const update: Partial<TodoRow> = {
      titel: editTitel,
      beschreibung: editBeschreibung || null,
      zustaendig: editZustaendig || null,
      faellig_am: terminModus === 'datum' ? editDatum || null : null,
      event_id: terminModus === 'termin' ? editEventId || null : null,
      session_id: terminModus === 'sitzung' ? editSessionId || null : null,
    }

    const { error } = await supabase.from('todos').update(update).eq('id', todo.id)
    if (error) {
      setEditError(error.message)
      setEditSaving(false)
      return
    }

    // Auto-Verschieben nach "Geplant": nur wenn die Karte gerade in einer
    // Spalte namens "Neu" liegt, ein Termin/Datum neu verknüpft wurde und
    // eine Spalte "Geplant" existiert. Spaltennamen sind frei änderbar -
    // greift also nur, solange die Standardnamen noch stimmen.
    if (terminModus !== 'keine') {
      const currentColumn = columns.find((c) => c.id === todo.column_id)
      const geplantColumn = columns.find((c) => c.titel.toLowerCase() === 'geplant')
      if (currentColumn?.titel.toLowerCase() === 'neu' && geplantColumn) {
        await supabase.from('todos').update({ column_id: geplantColumn.id }).eq('id', todo.id)
      }
    }

    await loadTodo()
    setEditSaving(false)
    onChanged()
  }

  async function handleDelete() {
    if (!todo) return
    setDeleteError(null)
    const { error } = await supabase.from('todos').delete().eq('id', todo.id)
    if (error) {
      setDeleteError(error.message)
      return
    }
    onChanged()
    onClose()
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

  async function handleDownload(path: string) {
    const { data, error } = await supabase.storage.from('zusammenfassungen').createSignedUrl(path, 60)
    if (!error && data) {
      window.open(data.signedUrl, '_blank')
    }
  }

  return (
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
                Löschen
              </button>
            </div>
            {deleteError && <p className="text-red-600 text-sm">{deleteError}</p>}
          </form>
        )}

        <h2 className="font-semibold mb-2">Kommentare</h2>
        <ul className="space-y-2 mb-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <p className="text-sm whitespace-pre-wrap">{c.inhalt}</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-slate-400">{formatDateTime(c.erstellt_am)}</span>
                {c.user_id === userId && (
                  <button
                    type="button"
                    onClick={() => handleDeleteComment(c.id)}
                    className="mc-btn-danger !px-2 !py-1 !text-xs"
                  >
                    Löschen
                  </button>
                )}
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
                  onClick={() => handleDownload(d.datei_url!)}
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
  )
}
