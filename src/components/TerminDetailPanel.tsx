import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { AntragRow, EventRow, SessionRow, SummaryRow, TodoRow } from '../lib/types'
import { TodoDetailModal } from './TodoDetailModal'
import { AntragDetailModal } from './AntragDetailModal'
import { DocumentPreviewModal, fileNameFromPath } from './DocumentPreviewModal'
import { formatDateTime } from '../lib/format'
import { ANTRAG_STATUS_BADGE, ANTRAG_STATUS_LABEL } from '../lib/antragStatus'

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TerminDetailPanel({
  kind,
  id,
  onDeleted,
}: {
  kind: 'event' | 'session'
  id: string
  onDeleted?: () => void
}) {
  const [userId, setUserId] = useState<string | null>(null)
  const [event, setEvent] = useState<EventRow | null>(null)
  const [session, setSession] = useState<SessionRow | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [editTitel, setEditTitel] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnde, setEditEnde] = useState('')
  const [editOrt, setEditOrt] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [summaries, setSummaries] = useState<SummaryRow[]>([])
  const [newInhalt, setNewInhalt] = useState('')
  const [newFile, setNewFile] = useState<File | null>(null)
  const [savingSummary, setSavingSummary] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const [linkedTodos, setLinkedTodos] = useState<TodoRow[]>([])
  const [openTodoId, setOpenTodoId] = useState<string | null>(null)
  const [previewDoc, setPreviewDoc] = useState<{ path: string; name: string } | null>(null)

  const [linkedAntraege, setLinkedAntraege] = useState<AntragRow[]>([])
  const [openAntragId, setOpenAntragId] = useState<string | null>(null)

  async function loadTermin() {
    setEvent(null)
    setSession(null)
    setLoadError(null)
    if (kind === 'event') {
      const { data, error } = await supabase.from('events').select('*').eq('id', id).single()
      if (error || !data) {
        setLoadError('Termin nicht gefunden.')
        return
      }
      setEvent(data)
    } else {
      const { data, error } = await supabase.from('sessions').select('*').eq('id', id).single()
      if (error || !data) {
        setLoadError('Sitzung nicht gefunden.')
        return
      }
      setSession(data)
    }
  }

  async function loadSummaries() {
    const column = kind === 'event' ? 'event_id' : 'session_id'
    const { data } = await supabase.from('summaries').select('*').eq(column, id).order('erstellt_am')
    setSummaries(data ?? [])
  }

  async function loadLinkedTodos() {
    const column = kind === 'event' ? 'event_id' : 'session_id'
    const { data } = await supabase.from('todos').select('*').eq(column, id).order('position')
    setLinkedTodos(data ?? [])
  }

  async function loadLinkedAntraege() {
    if (kind !== 'session') {
      setLinkedAntraege([])
      return
    }
    const { data } = await supabase.from('antraege').select('*').eq('session_id', id).order('created_at')
    setLinkedAntraege(data ?? [])
  }

  useEffect(() => {
    setEditing(false)
    setOpenTodoId(null)
    setOpenAntragId(null)
    loadTermin()
    loadSummaries()
    loadLinkedTodos()
    loadLinkedAntraege()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id])

  function startEdit() {
    if (!event) return
    setEditTitel(event.titel)
    setEditStart(toDatetimeLocalValue(event.start))
    setEditEnde(event.ende ? toDatetimeLocalValue(event.ende) : '')
    setEditOrt(event.ort ?? '')
    setEditError(null)
    setEditing(true)
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!event) return
    setEditSaving(true)
    setEditError(null)
    const { error } = await supabase
      .from('events')
      .update({
        titel: editTitel,
        start: new Date(editStart).toISOString(),
        ende: editEnde ? new Date(editEnde).toISOString() : null,
        ort: editOrt || null,
      })
      .eq('id', event.id)
    if (error) {
      setEditError(error.message)
    } else {
      setEditing(false)
      await loadTermin()
    }
    setEditSaving(false)
  }

  async function handleDelete() {
    if (!event) return
    setDeleteError(null)
    const { error } = await supabase.from('events').delete().eq('id', event.id)
    if (error) {
      setDeleteError(error.message)
      return
    }
    onDeleted?.()
  }

  async function handleToggleAbsage() {
    if (!event) return
    setDeleteError(null)
    const nextStatus = event.status === 'abgesagt' ? 'geplant' : 'abgesagt'
    const { error } = await supabase.from('events').update({ status: nextStatus }).eq('id', event.id)
    if (error) {
      setDeleteError(error.message)
      return
    }
    await loadTermin()
  }

  async function handleAddSummary(e: FormEvent) {
    e.preventDefault()
    if (!userId) return
    if (!newInhalt && !newFile) return
    setSavingSummary(true)
    setSummaryError(null)

    let dateiUrl: string | null = null
    if (newFile) {
      const path = `${userId}/${Date.now()}-${newFile.name}`
      const { error: uploadError } = await supabase.storage.from('zusammenfassungen').upload(path, newFile)
      if (uploadError) {
        setSummaryError(uploadError.message)
        setSavingSummary(false)
        return
      }
      dateiUrl = path
    }

    const { error } = await supabase.from('summaries').insert({
      user_id: userId,
      [kind === 'event' ? 'event_id' : 'session_id']: id,
      inhalt: newInhalt || null,
      datei_url: dateiUrl,
    })
    if (error) {
      setSummaryError(error.message)
    } else {
      setNewInhalt('')
      setNewFile(null)
      await loadSummaries()
    }
    setSavingSummary(false)
  }

  async function handleDeleteSummary(summaryId: string) {
    await supabase.from('summaries').delete().eq('id', summaryId)
    await loadSummaries()
  }

  const titel = event?.titel ?? session?.titel
  const start = event?.start ?? session?.datum
  const ort = event?.ort ?? session?.ort
  const abgesagt = event?.status === 'abgesagt' || session?.status === 'abgesagt'

  return (
    <div>
      <h2 className="mb-3 text-lg font-bold text-slate-900">{titel ?? 'Termin'}</h2>

      {loadError && <p className="text-red-600 mb-4">{loadError}</p>}

      {(event || session) && (
        <div className="mb-6 space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-4">
          {!editing && (
            <>
              {abgesagt && <p className="text-sm font-semibold text-red-600">Abgesagt</p>}
              {start && <p className="text-sm text-slate-600">{formatDateTime(start)}</p>}
              {event?.ende && (
                <p className="text-sm text-slate-600">bis {formatDateTime(event.ende)}</p>
              )}
              {ort && <p className="text-sm text-slate-600">Ort: {ort}</p>}
              {session?.gremium && <p className="text-sm text-slate-600">Gremium: {session.gremium}</p>}
              {event?.herkunft === 'fraktionsbuero' && (
                <p className="text-sm text-slate-600">Angelegt vom Fraktionsbüro</p>
              )}
              {event && (
                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={startEdit} className="mc-btn-ghost !px-2 !py-1 !text-xs">
                    Bearbeiten
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleAbsage}
                    className="mc-btn-ghost !px-2 !py-1 !text-xs"
                  >
                    {event.status === 'abgesagt' ? 'Reaktivieren' : 'Absagen'}
                  </button>
                  <button type="button" onClick={handleDelete} className="mc-btn-danger !px-2 !py-1 !text-xs">
                    Löschen
                  </button>
                </div>
              )}
              {deleteError && <p className="text-red-600 text-sm">{deleteError}</p>}
            </>
          )}
          {editing && (
            <form onSubmit={handleSaveEdit} className="space-y-2">
              <input
                type="text"
                value={editTitel}
                onChange={(e) => setEditTitel(e.target.value)}
                className="mc-input w-full"
                required
              />
              <div className="flex gap-2">
                <input
                  type="datetime-local"
                  value={editStart}
                  onChange={(e) => setEditStart(e.target.value)}
                  className="mc-input flex-1"
                  required
                />
                <input
                  type="datetime-local"
                  value={editEnde}
                  onChange={(e) => setEditEnde(e.target.value)}
                  className="mc-input flex-1"
                />
              </div>
              <input
                type="text"
                placeholder="Ort (optional)"
                value={editOrt}
                onChange={(e) => setEditOrt(e.target.value)}
                className="mc-input w-full"
              />
              {editError && <p className="text-red-600 text-sm">{editError}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={editSaving}
                  className="mc-btn-primary"
                >
                  {editSaving ? 'Speichern...' : 'Speichern'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="mc-btn-ghost"
                >
                  Abbrechen
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <h3 className="mb-2 text-sm font-semibold text-slate-900">Verknüpfte Aufgaben</h3>
      <ul className="mb-6 space-y-2">
        {linkedTodos.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setOpenTodoId(t.id)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-800 shadow-sm transition-shadow duration-150 hover:shadow-md"
            >
              {t.titel}
            </button>
          </li>
        ))}
        {linkedTodos.length === 0 && (
          <li className="text-slate-400 text-sm">Keine verknüpften Aufgaben.</li>
        )}
      </ul>

      {kind === 'session' && (
        <>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Verknüpfte Anträge</h3>
          <ul className="mb-6 space-y-2">
            {linkedAntraege.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setOpenAntragId(a.id)}
                  className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition-shadow duration-150 hover:shadow-md"
                >
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ANTRAG_STATUS_BADGE[a.status]}`}
                  >
                    {ANTRAG_STATUS_LABEL[a.status]}
                  </span>
                  <span className="truncate text-sm font-medium text-slate-800">{a.titel}</span>
                </button>
              </li>
            ))}
            {linkedAntraege.length === 0 && (
              <li className="text-slate-400 text-sm">Keine verknüpften Anträge.</li>
            )}
          </ul>
        </>
      )}

      <h3 className="mb-2 text-sm font-semibold text-slate-900">Notizen &amp; Dokumente</h3>
      <ul className="mb-3 space-y-2">
        {summaries.map((s) => (
          <li key={s.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
            {s.inhalt && <p className="text-sm whitespace-pre-wrap">{s.inhalt}</p>}
            {s.datei_url && (
              <button
                type="button"
                onClick={() => setPreviewDoc({ path: s.datei_url!, name: fileNameFromPath(s.datei_url!) })}
                className="mc-btn-ghost !px-2 !py-1 !text-xs"
              >
                📎 {fileNameFromPath(s.datei_url)}
              </button>
            )}
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-slate-400">{formatDateTime(s.erstellt_am)}</span>
              {s.user_id === userId && (
                <button
                  type="button"
                  onClick={() => handleDeleteSummary(s.id)}
                  className="mc-btn-danger !px-2 !py-1 !text-xs"
                >
                  Löschen
                </button>
              )}
            </div>
          </li>
        ))}
        {summaries.length === 0 && (
          <li className="text-slate-400 text-sm">Noch keine Notizen oder Dokumente.</li>
        )}
      </ul>

      <form onSubmit={handleAddSummary} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <textarea
          placeholder="Notiz (optional)"
          value={newInhalt}
          onChange={(e) => setNewInhalt(e.target.value)}
          className="mc-input w-full"
          rows={3}
        />
        <input
          type="file"
          onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
          className="w-full text-sm"
        />
        {summaryError && <p className="text-red-600 text-sm">{summaryError}</p>}
        <button
          type="submit"
          disabled={savingSummary || (!newInhalt && !newFile)}
          className="mc-btn-primary"
        >
          {savingSummary ? 'Speichern...' : 'Hinzufügen'}
        </button>
      </form>

      {openTodoId && (
        <TodoDetailModal id={openTodoId} onClose={() => setOpenTodoId(null)} onChanged={loadLinkedTodos} />
      )}
      {openAntragId && (
        <AntragDetailModal id={openAntragId} onClose={() => setOpenAntragId(null)} onChanged={loadLinkedAntraege} />
      )}
      {previewDoc && (
        <DocumentPreviewModal
          path={previewDoc.path}
          fileName={previewDoc.name}
          onClose={() => setPreviewDoc(null)}
        />
      )}
    </div>
  )
}
