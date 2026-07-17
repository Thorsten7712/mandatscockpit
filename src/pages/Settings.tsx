import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { CalendarSource, Ebene } from '../lib/types'

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

  const [gremien, setGremien] = useState<string[]>([])
  const [meineGremien, setMeineGremien] = useState<string[]>([])
  const [isAdmin, setIsAdmin] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editEbene, setEditEbene] = useState<Ebene>('kommune')
  const [editIcsUrl, setEditIcsUrl] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  async function loadSources() {
    const { data } = await supabase.from('calendar_sources').select('*').order('name')
    setSources(data ?? [])
  }

  useEffect(() => {
    loadSources()
    loadDistinctGremien().then(setGremien)
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      const { data: subs } = await supabase
        .from('user_source_subscriptions')
        .select('source_id')
        .eq('user_id', data.user.id)
      setSubscribed((subs ?? []).map((s) => s.source_id))
      const { data: mine } = await supabase.from('user_gremien').select('gremium').eq('user_id', data.user.id)
      setMeineGremien((mine ?? []).map((g) => g.gremium))
      const { data: profile } = await supabase
        .from('profiles')
        .select('rolle')
        .eq('id', data.user.id)
        .single()
      setIsAdmin(profile?.rolle === 'admin')
    })
  }, [])

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

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <header className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">Kalenderquellen abonnieren</h1>
        <Link to="/" className="text-sm text-slate-600 underline">
          Zurück zum Dashboard
        </Link>
      </header>
      {deleteError && <p className="text-red-600 text-sm mb-2 max-w-md">{deleteError}</p>}
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
                      className="bg-slate-900 text-white rounded px-3 py-1 text-sm disabled:opacity-50"
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
          return (
            <li key={s.id} className="flex items-center justify-between border rounded px-3 py-2 bg-white">
              <span>
                {s.name} <span className="text-xs text-slate-400">({s.ebene})</span>
              </span>
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={subscribed.includes(s.id)} onChange={() => toggle(s.id)} />
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
          className="w-full bg-slate-900 text-white rounded px-3 py-2 disabled:opacity-50"
        >
          {saving ? 'Speichern...' : 'Quelle hinzufügen'}
        </button>
        <p className="text-xs text-slate-400">
          Die Termine der neuen Quelle erscheinen nach dem nächsten Lauf des ICS-Import-Jobs (täglich
          04:00 UTC, siehe README.md Abschnitt 7).
        </p>
      </form>
    </div>
  )
}
