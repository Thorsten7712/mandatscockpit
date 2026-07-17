import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { EventRow, SessionRow, SummaryRow, TodoRow } from '../lib/types'
import { TodoDetailModal } from './TodoDetailModal'

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fileNameFromPath(path: string): string {
  return path.split('/').pop() ?? path
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

  useEffect(() => {
    setEditing(false)
    setOpenTodoId(null)
    loadTermin()
    loadSummaries()
    loadLinkedTodos()
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

  async function handleDownload(path: string) {
    const { data, error } = await supabase.storage.from('zusammenfassungen').createSignedUrl(path, 60)
    if (!error && data) {
      window.open(data.signedUrl, '_blank')
    }
  }

  const titel = event?.titel ?? session?.titel
  const start = event?.start ?? session?.datum
  const ort = event?.ort ?? session?.ort
  const abgesagt = event?.status === 'abgesagt' || session?.status === 'abgesagt'

  return (
    <div>
      <h2 className="text-lg font-bold mb-3">{titel ?? 'Termin'}</h2>

      {loadError && <p className="text-red-600 mb-4">{loadError}</p>}

      {(event || session) && (
        <div className="bg-white border rounded p-4 mb-6 space-y-1">
          {!editing && (
            <>
              {abgesagt && <p className="text-sm font-semibold text-red-600">Abgesagt</p>}
              {start && <p className="text-sm text-slate-600">{new Date(start).toLocaleString('de-DE')}</p>}
              {event?.ende && (
                <p className="text-sm text-slate-600">bis {new Date(event.ende).toLocaleString('de-DE')}</p>
              )}
              {ort && <p className="text-sm text-slate-600">Ort: {ort}</p>}
              {session?.gremium && <p className="text-sm text-slate-600">Gremium: {session.gremium}</p>}
              {event?.herkunft === 'fraktionsbuero' && (
                <p className="text-sm text-slate-600">Angelegt vom Fraktionsbüro</p>
              )}
              {event && (
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={startEdit} className="text-xs text-slate-600 underline">
                    Bearbeiten
                  </button>
                  <button type="button" onClick={handleToggleAbsage} className="text-xs text-slate-600 underline">
                    {event.status === 'abgesagt' ? 'Reaktivieren' : 'Absagen'}
                  </button>
                  <button type="button" onClick={handleDelete} className="text-xs text-red-500 underline">
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
                className="w-full border rounded px-2 py-1"
                required
              />
              <div className="flex gap-2">
                <input
                  type="datetime-local"
                  value={editStart}
                  onChange={(e) => setEditStart(e.target.value)}
                  className="flex-1 border rounded px-2 py-1"
                  required
                />
                <input
                  type="datetime-local"
                  value={editEnde}
                  onChange={(e) => setEditEnde(e.target.value)}
                  className="flex-1 border rounded px-2 py-1"
                />
              </div>
              <input
                type="text"
                placeholder="Ort (optional)"
                value={editOrt}
                onChange={(e) => setEditOrt(e.target.value)}
                className="w-full border rounded px-2 py-1"
              />
              {editError && <p className="text-red-600 text-sm">{editError}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={editSaving}
                  className="bg-slate-900 text-white rounded px-3 py-1 text-sm disabled:opacity-50"
                >
                  {editSaving ? 'Speichern...' : 'Speichern'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="text-sm text-slate-600 underline"
                >
                  Abbrechen
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <h3 className="font-semibold mb-2">Verknüpfte Aufgaben</h3>
      <ul className="space-y-2 mb-6">
        {linkedTodos.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setOpenTodoId(t.id)}
              className="w-full text-left border rounded px-3 py-2 bg-white hover:bg-slate-50 text-sm"
            >
              {t.titel}
            </button>
          </li>
        ))}
        {linkedTodos.length === 0 && (
          <li className="text-slate-400 text-sm">Keine verknüpften Aufgaben.</li>
        )}
      </ul>

      <h3 className="font-semibold mb-2">Notizen &amp; Dokumente</h3>
      <ul className="space-y-2 mb-3">
        {summaries.map((s) => (
          <li key={s.id} className="border rounded px-3 py-2 bg-white">
            {s.inhalt && <p className="text-sm whitespace-pre-wrap">{s.inhalt}</p>}
            {s.datei_url && (
              <button
                type="button"
                onClick={() => handleDownload(s.datei_url!)}
                className="text-xs text-slate-600 underline"
              >
                📎 {fileNameFromPath(s.datei_url)}
              </button>
            )}
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-slate-400">{new Date(s.erstellt_am).toLocaleString('de-DE')}</span>
              {s.user_id === userId && (
                <button
                  type="button"
                  onClick={() => handleDeleteSummary(s.id)}
                  className="text-xs text-red-500 underline"
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

      <form onSubmit={handleAddSummary} className="space-y-2 bg-white border rounded p-3">
        <textarea
          placeholder="Notiz (optional)"
          value={newInhalt}
          onChange={(e) => setNewInhalt(e.target.value)}
          className="w-full border rounded px-2 py-1"
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
          className="bg-slate-900 text-white rounded px-3 py-1 text-sm disabled:opacity-50"
        >
          {savingSummary ? 'Speichern...' : 'Hinzufügen'}
        </button>
      </form>

      {openTodoId && (
        <TodoDetailModal id={openTodoId} onClose={() => setOpenTodoId(null)} onChanged={loadLinkedTodos} />
      )}
    </div>
  )
}
