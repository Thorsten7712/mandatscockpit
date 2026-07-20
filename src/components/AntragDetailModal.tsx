import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { AntragComment, AntragRow, AntragStatus, SessionRow, SummaryRow } from '../lib/types'
import { ANTRAG_STATUS_LABEL, ANTRAG_STATUS_ORDER } from '../lib/antragStatus'
import { formatDate, formatDateTime } from '../lib/format'
import { DocumentPreviewModal, fileNameFromPath } from './DocumentPreviewModal'

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

  const [gremienVorschlaege, setGremienVorschlaege] = useState<string[]>([])
  const [ownSessions, setOwnSessions] = useState<SessionRow[]>([])
  const [linkedSession, setLinkedSession] = useState<SessionRow | null>(null)

  const [editTitel, setEditTitel] = useState('')
  const [editStatus, setEditStatus] = useState<AntragStatus>('entwurf')
  const [editAusschuss, setEditAusschuss] = useState('')
  const [editInhalt, setEditInhalt] = useState('')
  const [editMitantragsteller, setEditMitantragsteller] = useState('')
  const [editSessionId, setEditSessionId] = useState('')
  const [editEingereichtAm, setEditEingereichtAm] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [comments, setComments] = useState<AntragComment[]>([])
  const [newComment, setNewComment] = useState('')
  const [savingComment, setSavingComment] = useState(false)

  const [documents, setDocuments] = useState<SummaryRow[]>([])
  const [newFile, setNewFile] = useState<File | null>(null)
  const [savingDocument, setSavingDocument] = useState(false)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [previewDoc, setPreviewDoc] = useState<{ path: string; name: string } | null>(null)

  async function loadAntrag() {
    const { data, error } = await supabase.from('antraege').select('*').eq('id', id).single()
    if (error || !data) {
      setLoadError('Antrag nicht gefunden.')
      return
    }
    setAntrag(data)
    setEditTitel(data.titel)
    setEditStatus(data.status)
    setEditAusschuss(data.ausschuss ?? '')
    setEditInhalt(data.inhalt ?? '')
    setEditMitantragsteller(data.mitantragsteller ?? '')
    setEditSessionId(data.session_id ?? '')
    setEditEingereichtAm(data.eingereicht_am ?? '')
    setLinkedSession(null)
    if (data.session_id) {
      const { data: se } = await supabase.from('sessions').select('*').eq('id', data.session_id).single()
      if (se) setLinkedSession(se)
    }
  }

  async function loadComments() {
    const { data } = await supabase.from('antrag_comments').select('*').eq('antrag_id', id).order('erstellt_am')
    setComments(data ?? [])
  }

  async function loadDocuments() {
    const { data } = await supabase.from('summaries').select('*').eq('antrag_id', id).order('erstellt_am')
    setDocuments(data ?? [])
  }

  useEffect(() => {
    loadAntrag()
    loadComments()
    loadDocuments()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      const { data: mine } = await supabase.from('user_gremien').select('gremium').eq('user_id', data.user.id)
      const gremien = (mine ?? []).map((g) => g.gremium)
      setGremienVorschlaege(gremien)
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
    if (!antrag) return
    setEditSaving(true)
    setEditError(null)

    const { error } = await supabase
      .from('antraege')
      .update({
        titel: editTitel,
        status: editStatus,
        ausschuss: editAusschuss || null,
        inhalt: editInhalt || null,
        mitantragsteller: editMitantragsteller || null,
        session_id: editSessionId || null,
        eingereicht_am: editEingereichtAm || null,
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

  async function handleDelete() {
    if (!antrag) return
    setDeleteError(null)
    const { error } = await supabase.from('antraege').delete().eq('id', antrag.id)
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
      .from('antrag_comments')
      .insert({ antrag_id: id, user_id: userId, inhalt: newComment.trim() })
    if (!error) {
      setNewComment('')
      await loadComments()
    }
    setSavingComment(false)
  }

  async function handleDeleteComment(commentId: string) {
    await supabase.from('antrag_comments').delete().eq('id', commentId)
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
    const { error } = await supabase.from('summaries').insert({ user_id: userId, antrag_id: id, datei_url: path })
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
            <h1 className="truncate text-xl font-bold text-slate-900">{antrag?.titel ?? 'Antrag'}</h1>
            <button type="button" onClick={onClose} className="mc-btn-ghost shrink-0">
              Schließen
            </button>
          </header>

          {loadError && <p className="text-red-600 mb-4">{loadError}</p>}

          {antrag && (
            <form
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
                      {ANTRAG_STATUS_LABEL[s]}
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

              <input
                type="text"
                placeholder="Vorgesehener Ausschuss"
                value={editAusschuss}
                onChange={(e) => setEditAusschuss(e.target.value)}
                list="antrag-ausschuss-vorschlaege"
                className="mc-input w-full"
              />
              <datalist id="antrag-ausschuss-vorschlaege">
                {gremienVorschlaege.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>

              <textarea
                placeholder="Antragstext / Begründung (optional)"
                value={editInhalt}
                onChange={(e) => setEditInhalt(e.target.value)}
                className="mc-input w-full"
                rows={5}
              />

              <input
                type="text"
                placeholder="Mitantragsteller (optional)"
                value={editMitantragsteller}
                onChange={(e) => setEditMitantragsteller(e.target.value)}
                className="mc-input w-full"
              />

              <div className="space-y-1">
                <p className="text-sm text-slate-600">Sitzung, in der der Antrag behandelt wird</p>
                <select
                  value={editSessionId}
                  onChange={(e) => setEditSessionId(e.target.value)}
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
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={editSaving} className="mc-btn-primary">
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
          <form
            onSubmit={handleAddComment}
            className="mb-6 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
          >
            <textarea
              placeholder="Kommentar hinzufügen"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              className="mc-input w-full"
              rows={2}
            />
            <button type="submit" disabled={savingComment || !newComment.trim()} className="mc-btn-primary">
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
          <form
            onSubmit={handleUploadDocument}
            className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
          >
            <input type="file" onChange={(e) => setNewFile(e.target.files?.[0] ?? null)} className="w-full text-sm" />
            {documentError && <p className="text-red-600 text-sm">{documentError}</p>}
            <button type="submit" disabled={savingDocument || !newFile} className="mc-btn-primary">
              {savingDocument ? 'Hochladen...' : 'Hochladen'}
            </button>
          </form>
        </div>
      </div>
      {previewDoc && (
        <DocumentPreviewModal path={previewDoc.path} fileName={previewDoc.name} onClose={() => setPreviewDoc(null)} />
      )}
    </>
  )
}
