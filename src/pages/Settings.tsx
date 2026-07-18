import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { CalendarSource, Ebene, Profile, TodoBoardSettings, TodoColumn } from '../lib/types'
import { PARTEI_THEMES, applyTheme } from '../lib/themes'

async function loadDistinctGremien(): Promise<string[]> {
  const { data } = await supabase.from('sessions').select('gremium').not('gremium', 'is', null)
  const unique = new Set((data ?? []).map((row) => row.gremium as string))
  return Array.from(unique).sort((a, b) => a.localeCompare(b, 'de'))
}

const EBENEN: { value: Ebene; label: string }[] = [
  { value: 'kommune', label: 'Kommune' },
  { value: 'kreis', label: 'Kreis' },
  { value: 'land', label: 'Land' },
  { value: 'bund', label: 'Bund' },
]

export default function Settings() {
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [subscribed, setSubscribed] = useState<string[]>([])
  const [userId, setUserId] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [ebene, setEbene] = useState<Ebene>('kommune')
  const [icsUrl, setIcsUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileFotoUrl, setProfileFotoUrl] = useState<string | null>(null)
  const [profileName, setProfileName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [newFoto, setNewFoto] = useState<File | null>(null)
  const [savingFoto, setSavingFoto] = useState(false)
  const [fotoError, setFotoError] = useState<string | null>(null)
  const [partei, setPartei] = useState('')
  const [parteiError, setParteiError] = useState<string | null>(null)

  const [gremien, setGremien] = useState<string[]>([])
  const [meineGremien, setMeineGremien] = useState<string[]>([])
  const [staleGremien, setStaleGremien] = useState<string[]>([])
  const [isAdmin, setIsAdmin] = useState(false)

  const [refreshingSourceId, setRefreshingSourceId] = useState<string | null>(null)
  const [sourceRefreshError, setSourceRefreshError] = useState<{ sourceId: string; message: string } | null>(
    null,
  )
  const [sourceRefreshResult, setSourceRefreshResult] = useState<{ sourceId: string; imported: number } | null>(
    null,
  )

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editEbene, setEditEbene] = useState<Ebene>('kommune')
  const [editIcsUrl, setEditIcsUrl] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [todoColumns, setTodoColumns] = useState<TodoColumn[]>([])
  const [newColumnTitel, setNewColumnTitel] = useState('')
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
  const [editColumnTitel, setEditColumnTitel] = useState('')
  const [boardSettings, setBoardSettings] = useState<TodoBoardSettings | null>(null)

  async function loadSources() {
    const { data } = await supabase.from('calendar_sources').select('*').order('name')
    setSources(data ?? [])
  }

  async function loadUserData(uid: string) {
    const { data: subs } = await supabase
      .from('user_source_subscriptions')
      .select('source_id')
      .eq('user_id', uid)
    setSubscribed((subs ?? []).map((s) => s.source_id))
    const { data: mine } = await supabase.from('user_gremien').select('gremium').eq('user_id', uid)
    const currentSelection = (mine ?? []).map((g) => g.gremium)
    setMeineGremien(currentSelection)
    const { data: profileRow } = await supabase.from('profiles').select('rolle').eq('id', uid).single()
    setIsAdmin(profileRow?.rolle === 'admin')
    return currentSelection
  }

  async function loadProfile(uid: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single()
    setProfile(data)
    setProfileName(data?.name ?? '')
    setPartei(data?.partei ?? '')
    if (data?.foto_url) {
      const { data: signed } = await supabase.storage.from('profilbilder').createSignedUrl(data.foto_url, 3600)
      setProfileFotoUrl(signed?.signedUrl ?? null)
    } else {
      setProfileFotoUrl(null)
    }
  }

  async function loadTodoColumns() {
    const { data } = await supabase.from('todo_columns').select('*').order('reihenfolge')
    setTodoColumns(data ?? [])
  }

  async function loadBoardSettings(uid: string) {
    const { data } = await supabase.from('todo_board_settings').select('*').eq('user_id', uid).single()
    setBoardSettings(data)
  }

  useEffect(() => {
    loadSources()
    loadDistinctGremien().then(setGremien)
    loadTodoColumns()
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      loadUserData(data.user.id)
      loadBoardSettings(data.user.id)
      loadProfile(data.user.id)
    })
  }, [])

  async function handleRefreshSource(sourceId: string) {
    setRefreshingSourceId(sourceId)
    setSourceRefreshError(null)
    setSourceRefreshResult(null)
    setStaleGremien([])

    const { data, error } = await supabase.functions.invoke<{ imported?: number }>('import-ics-source', {
      body: { source_id: sourceId },
    })

    if (error) {
      let message = error.message
      const context = (error as { context?: unknown }).context
      if (context instanceof Response) {
        try {
          const body = await context.json()
          if (body?.error) message = body.error
        } catch {
          // Antwort war kein JSON - Standardmeldung von supabase-js behalten
        }
      }
      setSourceRefreshError({ sourceId, message })
      setRefreshingSourceId(null)
      return
    }

    setSourceRefreshResult({ sourceId, imported: data?.imported ?? 0 })

    const freshGremien = await loadDistinctGremien()
    setGremien(freshGremien)
    if (userId) {
      const currentSelection = await loadUserData(userId)
      setStaleGremien(currentSelection.filter((g) => !freshGremien.includes(g)))
    }
    setRefreshingSourceId(null)
  }

  function startEdit(s: CalendarSource) {
    setEditingId(s.id)
    setEditName(s.name)
    setEditEbene(s.ebene)
    setEditIcsUrl(s.ics_url)
    setEditError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditError(null)
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingId) return
    setEditSaving(true)
    setEditError(null)
    const { error } = await supabase
      .from('calendar_sources')
      .update({ name: editName, ebene: editEbene, ics_url: editIcsUrl })
      .eq('id', editingId)
    if (error) {
      setEditError(error.message)
    } else {
      setEditingId(null)
      await loadSources()
    }
    setEditSaving(false)
  }

  async function toggleGremium(gremium: string) {
    if (!userId) return
    if (meineGremien.includes(gremium)) {
      await supabase.from('user_gremien').delete().eq('user_id', userId).eq('gremium', gremium)
      setMeineGremien((prev) => prev.filter((g) => g !== gremium))
    } else {
      await supabase.from('user_gremien').insert({ user_id: userId, gremium })
      setMeineGremien((prev) => [...prev, gremium])
    }
  }

  async function toggle(sourceId: string) {
    if (!userId) return
    if (subscribed.includes(sourceId)) {
      await supabase
        .from('user_source_subscriptions')
        .delete()
        .eq('user_id', userId)
        .eq('source_id', sourceId)
      setSubscribed((prev) => prev.filter((id) => id !== sourceId))
    } else {
      await supabase.from('user_source_subscriptions').insert({ user_id: userId, source_id: sourceId })
      setSubscribed((prev) => [...prev, sourceId])
    }
  }

  async function handleAddSource(e: FormEvent) {
    e.preventDefault()
    if (!userId) return
    setSaving(true)
    setError(null)
    const { error } = await supabase
      .from('calendar_sources')
      .insert({ name, ebene, ics_url: icsUrl, verwaltet_von: userId })
    if (error) {
      setError(error.message)
    } else {
      setName('')
      setEbene('kommune')
      setIcsUrl('')
      await loadSources()
    }
    setSaving(false)
  }

  async function handleDelete(sourceId: string) {
    setDeleteError(null)
    const { error } = await supabase.from('calendar_sources').delete().eq('id', sourceId)
    if (error) {
      setDeleteError(error.message)
      return
    }
    await loadSources()
    setSubscribed((prev) => prev.filter((id) => id !== sourceId))
  }

  async function handleSaveName(e: FormEvent) {
    e.preventDefault()
    if (!userId) return
    setSavingName(true)
    setNameError(null)
    const { error } = await supabase.from('profiles').update({ name: profileName }).eq('id', userId)
    if (error) {
      setNameError(error.message)
    } else {
      setProfile((prev) => (prev ? { ...prev, name: profileName } : prev))
    }
    setSavingName(false)
  }

  async function handleParteiChange(next: string) {
    if (!userId) return
    setParteiError(null)
    setPartei(next)
    // Theme sofort anwenden - nicht erst nach dem Roundtrip, damit die
    // Auswahl direkt sichtbares Feedback gibt.
    applyTheme(next)
    const { error } = await supabase
      .from('profiles')
      .update({ partei: next || null })
      .eq('id', userId)
    if (error) setParteiError(error.message)
  }

  async function handleUploadFoto() {
    if (!userId || !newFoto) return
    setSavingFoto(true)
    setFotoError(null)
    const path = `${userId}/${Date.now()}-${newFoto.name}`
    const { error: uploadError } = await supabase.storage.from('profilbilder').upload(path, newFoto)
    if (uploadError) {
      setFotoError(uploadError.message)
      setSavingFoto(false)
      return
    }
    const oldFotoUrl = profile?.foto_url
    const { error } = await supabase.from('profiles').update({ foto_url: path }).eq('id', userId)
    if (error) {
      setFotoError(error.message)
      setSavingFoto(false)
      return
    }
    if (oldFotoUrl) {
      await supabase.storage.from('profilbilder').remove([oldFotoUrl])
    }
    setNewFoto(null)
    await loadProfile(userId)
    setSavingFoto(false)
  }

  async function handleAddColumn(e: FormEvent) {
    e.preventDefault()
    if (!userId || !newColumnTitel.trim()) return
    const maxReihenfolge = Math.max(-1, ...todoColumns.map((c) => c.reihenfolge))
    const { data } = await supabase
      .from('todo_columns')
      .insert({ user_id: userId, titel: newColumnTitel.trim(), reihenfolge: maxReihenfolge + 1 })
      .select()
      .single()
    if (data) setTodoColumns((prev) => [...prev, data])
    setNewColumnTitel('')
  }

  function startEditColumn(col: TodoColumn) {
    setEditingColumnId(col.id)
    setEditColumnTitel(col.titel)
  }

  async function saveEditColumn() {
    if (!editingColumnId) return
    const titel = editColumnTitel.trim()
    if (titel) {
      await supabase.from('todo_columns').update({ titel }).eq('id', editingColumnId)
      setTodoColumns((prev) => prev.map((c) => (c.id === editingColumnId ? { ...c, titel } : c)))
    }
    setEditingColumnId(null)
  }

  async function handleMoveColumn(col: TodoColumn, direction: 'left' | 'right') {
    const sorted = [...todoColumns].sort((a, b) => a.reihenfolge - b.reihenfolge)
    const index = sorted.findIndex((c) => c.id === col.id)
    const swapIndex = direction === 'left' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= sorted.length) return
    const other = sorted[swapIndex]
    await supabase.from('todo_columns').update({ reihenfolge: other.reihenfolge }).eq('id', col.id)
    await supabase.from('todo_columns').update({ reihenfolge: col.reihenfolge }).eq('id', other.id)
    setTodoColumns((prev) =>
      prev.map((c) => {
        if (c.id === col.id) return { ...c, reihenfolge: other.reihenfolge }
        if (c.id === other.id) return { ...c, reihenfolge: col.reihenfolge }
        return c
      }),
    )
  }

  async function handleDeleteColumn(col: TodoColumn) {
    const message = `Spalte „${col.titel}" löschen? Enthaltene Karten werden mitgelöscht.`
    if (!window.confirm(message)) return
    await supabase.from('todo_columns').delete().eq('id', col.id)
    setTodoColumns((prev) => prev.filter((c) => c.id !== col.id))
  }

  async function toggleBoardSetting(field: 'zeige_termin' | 'zeige_zustaendig') {
    if (!userId) return
    const current = boardSettings ?? { user_id: userId, zeige_termin: true, zeige_zustaendig: true }
    const updated = { ...current, [field]: !current[field] }
    setBoardSettings(updated)
    await supabase.from('todo_board_settings').upsert(updated)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="h-1.5 bg-topbar" aria-hidden="true" />
      <div className="p-6">
      <header className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">Einstellungen</h1>
        <Link to="/" className="text-sm text-slate-600 underline">
          Zurück zum Dashboard
        </Link>
      </header>

      <h2 className="text-lg font-semibold mb-2">Profil</h2>
      <div className="max-w-md bg-white border rounded p-4 space-y-3 mb-8">
        <div className="flex items-center gap-4">
          {profileFotoUrl ? (
            <img src={profileFotoUrl} alt="Profilfoto" className="w-16 h-16 rounded-full object-cover" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 text-xl">
              {profileName.charAt(0).toUpperCase() || '?'}
            </div>
          )}
          <div className="flex-1 space-y-1">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setNewFoto(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
            <button
              type="button"
              onClick={handleUploadFoto}
              disabled={!newFoto || savingFoto}
              className="text-xs text-slate-600 underline disabled:opacity-50"
            >
              {savingFoto ? 'Hochladen...' : 'Foto hochladen'}
            </button>
          </div>
        </div>
        {fotoError && <p className="text-red-600 text-sm">{fotoError}</p>}

        <form onSubmit={handleSaveName} className="flex gap-2">
          <input
            type="text"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            className="flex-1 border rounded px-2 py-1"
            required
          />
          <button
            type="submit"
            disabled={savingName}
            className="bg-primary hover:bg-primary-hover text-white rounded px-3 py-1 text-sm disabled:opacity-50"
          >
            {savingName ? 'Speichern...' : 'Speichern'}
          </button>
        </form>
        {nameError && <p className="text-red-600 text-sm">{nameError}</p>}

        <div>
          <label className="block text-sm text-slate-600 mb-1" htmlFor="profil-partei">
            Partei (bestimmt das Farbschema)
          </label>
          <select
            id="profil-partei"
            value={partei}
            onChange={(e) => handleParteiChange(e.target.value)}
            className="w-full border rounded px-2 py-1"
          >
            {PARTEI_THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {parteiError && <p className="text-red-600 text-sm mt-1">{parteiError}</p>}
        </div>
      </div>

      <h2 className="text-lg font-semibold mb-2">Kalenderquellen abonnieren</h2>
      {deleteError && <p className="text-red-600 text-sm mb-2 max-w-md">{deleteError}</p>}
      {staleGremien.length > 0 && (
        <p className="text-amber-600 text-sm mb-2 max-w-md">
          Diese angehakten Gremien haben aktuell keine Sitzungen mehr: {staleGremien.join(', ')}. Häkchen
          bleibt bestehen, falls das Gremium später wieder importiert wird.
        </p>
      )}
      <ul className="space-y-2 max-w-md">
        {sources.map((s) => {
          const canManage = s.verwaltet_von === userId || isAdmin
          if (editingId === s.id) {
            return (
              <li key={s.id} className="border rounded px-3 py-2 bg-white space-y-2">
                <form onSubmit={handleSaveEdit} className="space-y-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full border rounded px-2 py-1"
                    required
                  />
                  <select
                    value={editEbene}
                    onChange={(e) => setEditEbene(e.target.value as Ebene)}
                    className="w-full border rounded px-2 py-1"
                  >
                    {EBENEN.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="url"
                    value={editIcsUrl}
                    onChange={(e) => setEditIcsUrl(e.target.value)}
                    className="w-full border rounded px-2 py-1"
                    required
                  />
                  {editError && <p className="text-red-600 text-sm">{editError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={editSaving}
                      className="bg-primary hover:bg-primary-hover text-white rounded px-3 py-1 text-sm disabled:opacity-50"
                    >
                      {editSaving ? 'Speichern...' : 'Speichern'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="text-sm text-slate-600 underline"
                    >
                      Abbrechen
                    </button>
                  </div>
                </form>
              </li>
            )
          }
          const isRefreshing = refreshingSourceId === s.id
          return (
            <li key={s.id} className="border rounded px-3 py-2 bg-white">
              <div className="flex items-center justify-between">
                <span>
                  {s.name} <span className="text-xs text-slate-400">({s.ebene})</span>
                </span>
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={subscribed.includes(s.id)} onChange={() => toggle(s.id)} />
                  <button
                    type="button"
                    onClick={() => handleRefreshSource(s.id)}
                    disabled={isRefreshing}
                    className="text-xs text-slate-600 underline disabled:opacity-50"
                  >
                    {isRefreshing ? 'Aktualisiert...' : 'Aktualisieren'}
                  </button>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(s)}
                        className="text-xs text-slate-600 underline"
                      >
                        Bearbeiten
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(s.id)}
                        className="text-xs text-red-500 underline"
                      >
                        Löschen
                      </button>
                    </>
                  )}
                </div>
              </div>
              {sourceRefreshResult?.sourceId === s.id && (
                <p className="text-xs text-green-600 mt-1">
                  {sourceRefreshResult.imported} Termine importiert/aktualisiert.
                </p>
              )}
              {sourceRefreshError?.sourceId === s.id && (
                <p className="text-xs text-red-600 mt-1">{sourceRefreshError.message}</p>
              )}
            </li>
          )
        })}
        {sources.length === 0 && <li className="text-slate-400 text-sm">Noch keine Kalenderquellen angelegt.</li>}
      </ul>

      <h2 className="text-lg font-semibold mt-8 mb-2">Meine Gremien</h2>
      <p className="text-xs text-slate-400 mb-2 max-w-md">
        Häkchen bei den Gremien, in denen du ein Mandat hast. Das Dashboard zeigt dann nur noch
        Sitzungstermine dieser Gremien an.
      </p>
      <ul className="space-y-2 max-w-md">
        {gremien.map((g) => (
          <li key={g} className="flex items-center justify-between border rounded px-3 py-2 bg-white">
            <span>{g}</span>
            <input type="checkbox" checked={meineGremien.includes(g)} onChange={() => toggleGremium(g)} />
          </li>
        ))}
        {gremien.length === 0 && (
          <li className="text-slate-400 text-sm">
            Noch keine Gremien vorhanden – erst importiert der ICS-Import-Job Sitzungen (siehe oben).
          </li>
        )}
      </ul>

      <h2 className="text-lg font-semibold mt-8 mb-2">Eigene Quelle hinzufügen</h2>
      <form onSubmit={handleAddSource} className="space-y-3 max-w-md bg-white border rounded p-4">
        <div>
          <label className="block text-sm text-slate-600 mb-1" htmlFor="source-name">
            Name
          </label>
          <input
            id="source-name"
            type="text"
            placeholder="z. B. Kreistag Märkischer Kreis"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border rounded px-3 py-2"
            required
          />
        </div>
        <div>
          <label className="block text-sm text-slate-600 mb-1" htmlFor="source-ebene">
            Ebene
          </label>
          <select
            id="source-ebene"
            value={ebene}
            onChange={(e) => setEbene(e.target.value as Ebene)}
            className="w-full border rounded px-3 py-2"
          >
            {EBENEN.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-slate-600 mb-1" htmlFor="source-ics-url">
            ICS-URL
          </label>
          <input
            id="source-ics-url"
            type="url"
            placeholder="https://.../kalender.ics"
            value={icsUrl}
            onChange={(e) => setIcsUrl(e.target.value)}
            className="w-full border rounded px-3 py-2"
            required
          />
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={saving || !userId}
          className="w-full bg-primary hover:bg-primary-hover text-white rounded px-3 py-2 disabled:opacity-50"
        >
          {saving ? 'Speichern...' : 'Quelle hinzufügen'}
        </button>
        <p className="text-xs text-slate-400">
          Die Termine der neuen Quelle erscheinen nach dem nächsten Lauf des ICS-Import-Jobs (täglich
          04:00 UTC, siehe README.md Abschnitt 7).
        </p>
      </form>

      <h2 className="text-lg font-semibold mt-8 mb-2">ToDo-Board</h2>
      <p className="text-xs text-slate-400 mb-2 max-w-md">Spalten verwalten und sortieren.</p>
      <ul className="space-y-2 max-w-md">
        {[...todoColumns]
          .sort((a, b) => a.reihenfolge - b.reihenfolge)
          .map((col, i, sorted) => {
            if (editingColumnId === col.id) {
              return (
                <li key={col.id} className="border rounded px-3 py-2 bg-white">
                  <input
                    type="text"
                    value={editColumnTitel}
                    onChange={(e) => setEditColumnTitel(e.target.value)}
                    onBlur={saveEditColumn}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEditColumn()
                      if (e.key === 'Escape') setEditingColumnId(null)
                    }}
                    autoFocus
                    className="w-full border rounded px-2 py-1"
                  />
                </li>
              )
            }
            return (
              <li key={col.id} className="flex items-center justify-between border rounded px-3 py-2 bg-white">
                <span className="cursor-pointer" onClick={() => startEditColumn(col)}>
                  {col.titel}
                </span>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <button
                    type="button"
                    onClick={() => handleMoveColumn(col, 'left')}
                    disabled={i === 0}
                    className="disabled:opacity-30"
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveColumn(col, 'right')}
                    disabled={i === sorted.length - 1}
                    className="disabled:opacity-30"
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteColumn(col)}
                    className="text-red-500"
                  >
                    Löschen
                  </button>
                </div>
              </li>
            )
          })}
        {todoColumns.length === 0 && <li className="text-slate-400 text-sm">Noch keine Spalten.</li>}
      </ul>
      <form onSubmit={handleAddColumn} className="flex gap-2 max-w-md mt-2">
        <input
          type="text"
          placeholder="Neue Spalte"
          value={newColumnTitel}
          onChange={(e) => setNewColumnTitel(e.target.value)}
          className="flex-1 border rounded px-3 py-2"
        />
        <button type="submit" className="bg-primary hover:bg-primary-hover text-white rounded px-3 py-2 text-sm">
          Hinzufügen
        </button>
      </form>

      <p className="text-sm text-slate-600 mt-4 mb-2">Details auf den Karten anzeigen</p>
      <div className="max-w-md bg-white border rounded p-4 space-y-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={boardSettings?.zeige_termin ?? true}
            onChange={() => toggleBoardSetting('zeige_termin')}
          />
          Termin-Symbol (📅)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={boardSettings?.zeige_zustaendig ?? true}
            onChange={() => toggleBoardSetting('zeige_zustaendig')}
          />
          Zuständigkeit (👤)
        </label>
      </div>
      </div>
    </div>
  )
}
