import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { CalendarSource, Ebene } from '../lib/types'

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

  async function loadSources() {
    const { data } = await supabase.from('calendar_sources').select('*').order('name')
    setSources(data ?? [])
  }

  useEffect(() => {
    loadSources()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      const { data: subs } = await supabase
        .from('user_source_subscriptions')
        .select('source_id')
        .eq('user_id', data.user.id)
      setSubscribed((subs ?? []).map((s) => s.source_id))
    })
  }, [])

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
        {sources.map((s) => (
          <li key={s.id} className="flex items-center justify-between border rounded px-3 py-2 bg-white">
            <span>
              {s.name} <span className="text-xs text-slate-400">({s.ebene})</span>
            </span>
            <div className="flex items-center gap-3">
              <input type="checkbox" checked={subscribed.includes(s.id)} onChange={() => toggle(s.id)} />
              {s.verwaltet_von === userId && (
                <button
                  type="button"
                  onClick={() => handleDelete(s.id)}
                  className="text-xs text-red-500 underline"
                >
                  Löschen
                </button>
              )}
            </div>
          </li>
        ))}
        {sources.length === 0 && <li className="text-slate-400 text-sm">Noch keine Kalenderquellen angelegt.</li>}
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
