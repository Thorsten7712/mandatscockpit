import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Bot, CalendarClock, CalendarDays, Landmark, SquareKanban, User, Users } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type { AntragDeadlineSetting, CalendarSource, Ebene, Profile, TodoBoardSettings, TodoColumn } from '../lib/types'
import { themeById } from '../lib/themes'
import { EBENE_LABEL, SOURCE_COLORS, sourceColorById } from '../lib/sourceColors'
import { gliederungFeld } from '../lib/gliederung'
import { UserManagement } from '../components/UserManagement'

type SectionId = 'profil' | 'kalender' | 'gremien' | 'board' | 'fristen' | 'mcp' | 'benutzer'

const SECTIONS: { id: SectionId; label: string; icon: typeof User; adminOnly?: boolean }[] = [
  { id: 'profil', label: 'Profil', icon: User },
  { id: 'kalender', label: 'Kalenderquellen', icon: CalendarDays },
  { id: 'gremien', label: 'Meine Gremien', icon: Landmark },
  { id: 'board', label: 'ToDo-Board', icon: SquareKanban },
  { id: 'fristen', label: 'Antrags-Fristen', icon: CalendarClock },
  { id: 'mcp', label: 'MCP Connection', icon: Bot },
  { id: 'benutzer', label: 'Benutzerverwaltung', icon: Users, adminOnly: true },
]

// Erzeugt ein zufälliges Bearer-Token client-seitig (nie an den Server
// übertragen) und dessen SHA-256-Hash zum Speichern. Muss mit der
// Hash-Berechnung in supabase/functions/mcp-server/index.ts identisch
// bleiben, sonst schlägt der Token-Lookup dort fehl.
function randomMcpToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const base64url = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `mck_${base64url}`
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Claudes "Custom Connector"-Dialog hat nur ein einzelnes URL-Feld (kein
// separates Bearer-Token-Feld, nur eine optionale OAuth-Client-ID für
// echte OAuth-Server) - das Token muss deshalb direkt in der URL stecken.
// mcp-server/index.ts liest es dort per ?token=-Query-Parameter aus.
function mcpConnectorUrl(token: string): string {
  const functionsBase = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/mcp-server`
  return `${functionsBase}?token=${token}`
}

interface GremiumEntry {
  gremium: string
  source_id: string | null
}

// Distinct (gremium, quelle)-Paare - die Meine-Gremien-Checkliste ist nach
// Quellen gruppiert. Taucht dasselbe Gremium in mehreren Quellen auf, wird
// es pro Quelle gelistet (Auswahl bleibt trotzdem gremium-Text-basiert).
async function loadDistinctGremien(): Promise<GremiumEntry[]> {
  const { data } = await supabase.from('sessions').select('gremium, source_id').not('gremium', 'is', null)
  const seen = new Set<string>()
  const entries: GremiumEntry[] = []
  for (const row of data ?? []) {
    const key = `${row.source_id ?? ''}|${row.gremium}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({ gremium: row.gremium as string, source_id: (row.source_id as string | null) ?? null })
  }
  return entries.sort((a, b) => a.gremium.localeCompare(b.gremium, 'de'))
}

const EBENEN: { value: Ebene; label: string }[] = [
  { value: 'kommune', label: 'Kommune' },
  { value: 'kreis', label: 'Kreis' },
  { value: 'land', label: 'Land' },
  { value: 'bund', label: 'Bund' },
]

const GLIEDERUNG_PLATZHALTER: Record<string, string> = {
  kommune: 'z. B. Iserlohn',
  kreis: 'z. B. Märkischer Kreis',
  land: 'z. B. Nordrhein-Westfalen',
}

export default function Settings() {
  const [activeSection, setActiveSection] = useState<SectionId>('profil')
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

  const [gremien, setGremien] = useState<GremiumEntry[]>([])
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

  const [fristenTage, setFristenTage] = useState<Record<Ebene, string>>({
    kommune: '',
    kreis: '',
    land: '',
    bund: '',
  })
  const [savingFristen, setSavingFristen] = useState(false)
  const [fristenError, setFristenError] = useState<string | null>(null)

  const [mcpTokenCreatedAt, setMcpTokenCreatedAt] = useState<string | null>(null)
  const [mcpGeneratedToken, setMcpGeneratedToken] = useState<string | null>(null)
  const [mcpGenerating, setMcpGenerating] = useState(false)
  const [mcpError, setMcpError] = useState<string | null>(null)
  const [mcpCopied, setMcpCopied] = useState(false)

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

  async function loadMcpTokenStatus(uid: string) {
    const { data } = await supabase.from('mcp_tokens').select('created_at').eq('user_id', uid).maybeSingle()
    setMcpTokenCreatedAt(data?.created_at ?? null)
  }

  async function loadFristen(uid: string) {
    const { data } = await supabase.from('antrag_deadline_settings').select('*').eq('user_id', uid)
    const byEbene: Record<Ebene, string> = { kommune: '', kreis: '', land: '', bund: '' }
    for (const row of (data ?? []) as AntragDeadlineSetting[]) {
      byEbene[row.ebene] = String(row.tage_vor_sitzung)
    }
    setFristenTage(byEbene)
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
      loadMcpTokenStatus(data.user.id)
      loadFristen(data.user.id)
    })
  }, [])

  // Pro Ebene entweder upserten (Wert gesetzt) oder löschen (Feld geleert) -
  // eine konfigurierte Frist pro Ebene "Tage vor der Sitzung" (z. B. Kommune
  // = 14), aus der AntraegeSection/AntragDetailModal die Einreichungsfrist
  // berechnen (siehe src/lib/antragDeadline.ts).
  async function handleSaveFristen(e: FormEvent) {
    e.preventDefault()
    if (!userId) return
    setSavingFristen(true)
    setFristenError(null)
    for (const e2 of EBENEN) {
      const wert = fristenTage[e2.value].trim()
      if (wert === '') {
        const { error } = await supabase
          .from('antrag_deadline_settings')
          .delete()
          .eq('user_id', userId)
          .eq('ebene', e2.value)
        if (error) setFristenError(error.message)
      } else {
        const { error } = await supabase
          .from('antrag_deadline_settings')
          .upsert({ user_id: userId, ebene: e2.value, tage_vor_sitzung: Number(wert) })
        if (error) setFristenError(error.message)
      }
    }
    setSavingFristen(false)
  }

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
      setStaleGremien(currentSelection.filter((g) => !freshGremien.some((e) => e.gremium === g)))
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

  async function handleSetFarbe(sourceId: string, farbe: string | null) {
    // Optimistisch setzen, dann speichern - bei Fehler einfach neu laden.
    setSources((prev) => prev.map((s) => (s.id === sourceId ? { ...s, farbe } : s)))
    const { error } = await supabase.from('calendar_sources').update({ farbe }).eq('id', sourceId)
    if (error) await loadSources()
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

  // Anders als Partei (admin-verwaltet, siehe UserManagement) trägt jeder
  // Nutzer seine eigenen Mandats-Ebenen selbst ein - bestimmt, mit wem
  // ToDo-Karten geteilt werden können (siehe TodoDetailModal.tsx).
  async function toggleMyEbene(value: Ebene) {
    if (!userId || !profile) return
    const aktuell = profile.ebenen ?? []
    const neu = aktuell.includes(value) ? aktuell.filter((e) => e !== value) : [...aktuell, value]
    setProfile((prev) => (prev ? { ...prev, ebenen: neu } : prev))
    const { error } = await supabase.from('profiles').update({ ebenen: neu }).eq('id', userId)
    if (error) await loadProfile(userId)
  }

  // Welche konkrete Kommune/welcher Kreis/welches Land - nötig, damit das
  // Teilen (siehe gleicheGliederung() in src/lib/gliederung.ts) nicht
  // fälschlich zwischen Mitgliedern derselben Partei/Ebene aus
  // unterschiedlichen Städten anbietet. Bund braucht kein Gegenstück
  // (gliederungFeld() liefert dafür null).
  async function updateGliederung(feld: 'gliederung_kommune' | 'gliederung_kreis' | 'gliederung_land', value: string) {
    if (!userId) return
    const { error } = await supabase.from('profiles').update({ [feld]: value || null }).eq('id', userId)
    if (error) await loadProfile(userId)
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

  async function handleGenerateMcpToken() {
    if (!userId) return
    if (mcpTokenCreatedAt) {
      const ok = window.confirm(
        'Neues Token erzeugen? Das bisherige Token funktioniert danach nicht mehr und muss in Claude ersetzt werden.',
      )
      if (!ok) return
    }
    setMcpGenerating(true)
    setMcpError(null)
    setMcpCopied(false)
    const token = randomMcpToken()
    const tokenHash = await sha256Hex(token)
    const { error } = await supabase
      .from('mcp_tokens')
      .upsert({ user_id: userId, token_hash: tokenHash, created_at: new Date().toISOString() })
    if (error) {
      setMcpError(error.message)
    } else {
      setMcpGeneratedToken(token)
      await loadMcpTokenStatus(userId)
    }
    setMcpGenerating(false)
  }

  async function handleCopyMcpToken() {
    if (!mcpGeneratedToken) return
    await navigator.clipboard.writeText(mcpConnectorUrl(mcpGeneratedToken))
    setMcpCopied(true)
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="h-1.5 bg-topbar" aria-hidden="true" />
      <header className="bg-gradient-to-r from-primary to-primary-hover text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <h1 className="text-lg font-bold">Einstellungen</h1>
          <Link to="/" className="mc-btn px-3 py-1.5 text-sm text-white/90 hover:bg-white/15 hover:text-white">
            Zurück zum Dashboard
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex flex-col gap-8 md:flex-row">
      <aside className="shrink-0 md:w-56">
        <nav className="flex gap-1 overflow-x-auto pb-1 md:sticky md:top-6 md:flex-col md:pb-0">
          {SECTIONS.filter((s) => !s.adminOnly || isAdmin).map((s) => {
            const Icon = s.icon
            const active = activeSection === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'
                }`}
              >
                <Icon size={16} className="shrink-0" />
                {s.label}
              </button>
            )
          })}
        </nav>
      </aside>
      <div className="min-w-0 max-w-2xl flex-1">

      {activeSection === 'profil' && (
      <section className="mc-animate-fade">
      <h2 className="mb-2 text-base font-semibold text-slate-900">Profil</h2>
      <div className="mc-card mb-8 max-w-md space-y-3 p-4">
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
              className="mc-btn-ghost !px-2 !py-1 !text-xs"
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
            className="mc-input flex-1"
            required
          />
          <button type="submit" disabled={savingName} className="mc-btn-primary">
            {savingName ? 'Speichern...' : 'Speichern'}
          </button>
        </form>
        {nameError && <p className="text-red-600 text-sm">{nameError}</p>}

        <div>
          <p className="mb-1 block text-sm text-slate-600">Partei (bestimmt das Farbschema)</p>
          <p className="mc-input flex w-full items-center bg-slate-50 text-slate-700">
            {themeById(partei).label}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Wird von einem Admin in der Benutzerverwaltung festgelegt.
          </p>
        </div>

        <div>
          <p className="mb-1 block text-sm text-slate-600">Meine Ebenen (Mandate)</p>
          <div className="flex flex-wrap gap-3 text-sm">
            {EBENEN.map((e) => (
              <label key={e.value} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={(profile?.ebenen ?? []).includes(e.value)}
                  onChange={() => toggleMyEbene(e.value)}
                />
                {e.label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Wird von dir selbst gepflegt (anders als die Partei) - mehrere Ebenen gleichzeitig möglich,
            z. B. Stadtrat und Kreistag. Bestimmt, mit wem du ToDo-Karten teilen kannst.
          </p>

          {(profile?.ebenen ?? []).some((e) => gliederungFeld(e)) && (
            <div className="mt-3 space-y-2">
              {EBENEN.filter((e) => (profile?.ebenen ?? []).includes(e.value) && gliederungFeld(e.value)).map(
                (e) => {
                  const feld = gliederungFeld(e.value)!
                  return (
                    <div key={e.value}>
                      <label className="mb-1 block text-xs text-slate-500">Welche{e.value === 'land' ? 's' : e.value === 'kreis' ? 'r' : ''} {e.label}?</label>
                      <input
                        type="text"
                        defaultValue={profile?.[feld] ?? ''}
                        placeholder={GLIEDERUNG_PLATZHALTER[e.value]}
                        onBlur={(ev) => updateGliederung(feld, ev.target.value)}
                        className="mc-input w-full"
                      />
                    </div>
                  )
                },
              )}
              <p className="text-xs text-slate-400">
                Nötig, damit Teilen nur mit Kolleg*innen derselben Kommune/desselben Kreises/Landes
                funktioniert - ohne diese Angabe erscheinst du für diese Ebene bei niemandem als
                Teilen-Kandidat*in.
              </p>
            </div>
          )}
        </div>
      </div>

      </section>
      )}

      {activeSection === 'kalender' && (
      <section className="mc-animate-fade">
      <h2 className="mb-2 text-base font-semibold text-slate-900">Kalenderquellen abonnieren</h2>
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
              <li key={s.id} className="mc-card space-y-2 px-3 py-2 !rounded-lg">
                <form onSubmit={handleSaveEdit} className="space-y-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mc-input w-full"
                    required
                  />
                  <select
                    value={editEbene}
                    onChange={(e) => setEditEbene(e.target.value as Ebene)}
                    className="mc-input w-full"
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
                    className="mc-input w-full"
                    required
                  />
                  {editError && <p className="text-red-600 text-sm">{editError}</p>}
                  <div className="flex gap-2">
                    <button type="submit" disabled={editSaving} className="mc-btn-primary">
                      {editSaving ? 'Speichern...' : 'Speichern'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="mc-btn-ghost"
                    >
                      Abbrechen
                    </button>
                  </div>
                </form>
              </li>
            )
          }
          const isRefreshing = refreshingSourceId === s.id
          const farbe = sourceColorById(s.farbe)
          return (
            <li key={s.id} className="mc-card px-3 py-2.5 !rounded-lg">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${farbe.dot}`} aria-hidden="true" />
                  <span className="truncate text-sm font-medium text-slate-900">{s.name}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${farbe.chip}`}>
                    {EBENE_LABEL[s.ebene] ?? s.ebene}
                  </span>
                </span>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                  Abonniert
                  <input type="checkbox" checked={subscribed.includes(s.id)} onChange={() => toggle(s.id)} />
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                {canManage ? (
                  <div className="flex items-center gap-1.5">
                    <span className="mr-1 text-xs text-slate-400">Farbe:</span>
                    <button
                      type="button"
                      onClick={() => handleSetFarbe(s.id, null)}
                      title="Theme-Farbe (Standard)"
                      className={`h-5 w-5 rounded-full bg-primary transition-transform hover:scale-110 ${!s.farbe ? 'ring-2 ring-primary ring-offset-2' : ''}`}
                    />
                    {SOURCE_COLORS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSetFarbe(s.id, c.id)}
                        title={c.label}
                        className={`h-5 w-5 rounded-full ${c.dot} transition-transform hover:scale-110 ${s.farbe === c.id ? `ring-2 ${c.ring} ring-offset-2` : ''}`}
                      />
                    ))}
                  </div>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleRefreshSource(s.id)}
                    disabled={isRefreshing}
                    className="mc-btn-ghost !px-2 !py-1 !text-xs"
                  >
                    {isRefreshing ? 'Aktualisiert...' : 'Aktualisieren'}
                  </button>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(s)}
                        className="mc-btn-ghost !px-2 !py-1 !text-xs"
                      >
                        Bearbeiten
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(s.id)}
                        className="mc-btn-danger !px-2 !py-1 !text-xs"
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

      </section>
      )}

      {activeSection === 'gremien' && (
      <section className="mc-animate-fade">
      <h2 className="mb-2 text-base font-semibold text-slate-900">Meine Gremien</h2>
      <p className="text-xs text-slate-400 mb-2 max-w-md">
        Häkchen bei den Gremien, in denen du ein Mandat hast. Das Dashboard zeigt dann nur noch
        Sitzungstermine dieser Gremien an.
      </p>
      {/* Gruppiert nach Kalenderquelle: Gruppen-Header mit Farbpunkt der
          Quelle + Ebene-Badge, damit die Zuordnung Kommune/Kreis/Land/Bund
          direkt sichtbar ist. Gremien ohne zuordenbare Quelle landen in
          einer "Ohne Quelle"-Gruppe am Ende. */}
      <div className="max-w-md space-y-6">
        {[
          ...sources
            .filter((s) => gremien.some((g) => g.source_id === s.id))
            .map((s) => ({ source: s as CalendarSource | null, entries: gremien.filter((g) => g.source_id === s.id) })),
          ...(gremien.some((g) => g.source_id === null || !sources.some((s) => s.id === g.source_id))
            ? [
                {
                  source: null as CalendarSource | null,
                  entries: gremien.filter(
                    (g) => g.source_id === null || !sources.some((s) => s.id === g.source_id),
                  ),
                },
              ]
            : []),
        ].map(({ source, entries }) => {
          const farbe = sourceColorById(source?.farbe)
          return (
            <div key={source?.id ?? 'ohne-quelle'}>
              <div className="mb-2 flex items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${farbe.dot}`} aria-hidden="true" />
                <h3 className="text-sm font-semibold text-slate-900">{source?.name ?? 'Ohne Quelle'}</h3>
                {source && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${farbe.chip}`}
                  >
                    {EBENE_LABEL[source.ebene] ?? source.ebene}
                  </span>
                )}
              </div>
              <ul className="space-y-2">
                {entries.map((g) => (
                  <li
                    key={`${source?.id ?? ''}-${g.gremium}`}
                    className="mc-card flex items-center justify-between px-3 py-2 !rounded-lg"
                  >
                    <span className="text-sm">{g.gremium}</span>
                    <input
                      type="checkbox"
                      checked={meineGremien.includes(g.gremium)}
                      onChange={() => toggleGremium(g.gremium)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
      <ul className="max-w-md">
        {gremien.length === 0 && (
          <li className="text-slate-400 text-sm">
            Noch keine Gremien vorhanden – erst importiert der ICS-Import-Job Sitzungen (siehe oben).
          </li>
        )}
      </ul>

      </section>
      )}

      {/* Zweiter kalender-Block: erscheint im Kalenderquellen-Tab unterhalb
          der Quellenliste (Quellcode-Reihenfolge ist durch das Conditional-
          Rendering fürs UI egal, so bleiben die Edits minimal). */}
      {activeSection === 'kalender' && (
      <section className="mc-animate-fade">
      <h2 className="mt-10 mb-2 text-base font-semibold text-slate-900">Eigene Quelle hinzufügen</h2>
      <form onSubmit={handleAddSource} className="mc-card max-w-md space-y-3 p-4">
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
            className="mc-input w-full"
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
            className="mc-input w-full"
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
            className="mc-input w-full"
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

      </section>
      )}

      {activeSection === 'board' && (
      <section className="mc-animate-fade">
      <h2 className="mb-2 text-base font-semibold text-slate-900">ToDo-Board</h2>
      <p className="text-xs text-slate-400 mb-2 max-w-md">Spalten verwalten und sortieren.</p>
      <ul className="space-y-2 max-w-md">
        {[...todoColumns]
          .sort((a, b) => a.reihenfolge - b.reihenfolge)
          .map((col, i, sorted) => {
            if (editingColumnId === col.id) {
              return (
                <li key={col.id} className="mc-card px-3 py-2 !rounded-lg">
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
                    className="mc-input w-full"
                  />
                </li>
              )
            }
            return (
              <li key={col.id} className="mc-card flex items-center justify-between px-3 py-2 !rounded-lg">
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
          className="mc-input flex-1"
        />
        <button type="submit" className="bg-primary hover:bg-primary-hover text-white rounded px-3 py-2 text-sm">
          Hinzufügen
        </button>
      </form>

      <p className="text-sm text-slate-600 mt-4 mb-2">Details auf den Karten anzeigen</p>
      <div className="mc-card max-w-md space-y-2 p-4">
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
      </section>
      )}

      {activeSection === 'fristen' && (
      <section className="mc-animate-fade">
      <h2 className="mb-2 text-base font-semibold text-slate-900">Antrags-Fristen</h2>
      <p className="mb-3 max-w-md text-sm text-slate-500">
        Wie viele Tage vor der Sitzung muss ein Antrag auf dieser Ebene spätestens gestellt sein? Wird bei
        Anträgen mit verknüpfter Sitzung automatisch zur Einreichungsfrist verrechnet (z. B. Kommune = 14
        Tage). Leer lassen, um für eine Ebene keine Frist anzuzeigen.
      </p>
      <form onSubmit={handleSaveFristen} className="mc-card max-w-md space-y-3 p-4">
        {EBENEN.map((e) => (
          <div key={e.value} className="flex items-center justify-between gap-3">
            <label htmlFor={`frist-${e.value}`} className="text-sm text-slate-700">
              {e.label}
            </label>
            <div className="flex items-center gap-2">
              <input
                id={`frist-${e.value}`}
                type="number"
                min={0}
                placeholder="z. B. 14"
                value={fristenTage[e.value]}
                onChange={(ev) => setFristenTage((prev) => ({ ...prev, [e.value]: ev.target.value }))}
                className="mc-input w-24"
              />
              <span className="text-sm text-slate-500">Tage vorher</span>
            </div>
          </div>
        ))}
        {fristenError && <p className="text-red-600 text-sm">{fristenError}</p>}
        <button type="submit" disabled={savingFristen} className="mc-btn-primary">
          {savingFristen ? 'Speichern...' : 'Speichern'}
        </button>
      </form>
      </section>
      )}

      {activeSection === 'mcp' && (
      <section className="mc-animate-fade">
      <h2 className="mb-2 text-base font-semibold text-slate-900">MCP Connection</h2>
      <p className="text-xs text-slate-400 mb-2 max-w-md">
        Mit einer persönlichen Zugangs-URL kannst du MandatsCockpit direkt aus Claude heraus per Chat
        steuern (z. B. „Leg mir ein ToDo an: XY im nächsten Verkehrsausschuss fragen"). Richte dazu in
        Claude unter Connectors einen Custom Connector ein und trage dort diese URL **komplett** in das
        einzige URL-Feld ein (Claude bietet aktuell kein separates Token-/API-Key-Feld an, siehe
        README.md) – nicht nur den Teil vor dem „?".
      </p>
      <div className="mc-card max-w-md space-y-3 p-4">
        <p className="text-sm text-slate-600">
          {mcpTokenCreatedAt
            ? `Aktives Token erzeugt am ${new Date(mcpTokenCreatedAt).toLocaleString('de-DE')}.`
            : 'Noch keine Zugangs-URL erzeugt.'}
        </p>
        <button
          type="button"
          onClick={handleGenerateMcpToken}
          disabled={mcpGenerating || !userId}
          className="mc-btn-primary"
        >
          {mcpGenerating ? 'Erzeuge...' : mcpTokenCreatedAt ? 'Neue Zugangs-URL erzeugen' : 'Zugangs-URL erzeugen'}
        </button>
        {mcpError && <p className="text-red-600 text-sm">{mcpError}</p>}
        {mcpGeneratedToken && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-xs text-amber-800">
              Diese komplette URL wird nur jetzt im Klartext angezeigt (gespeichert wird nur ein Hash) –
              jetzt kopieren und als Server-URL im Custom Connector eintragen.
            </p>
            <code className="block break-all rounded bg-white px-2 py-1.5 text-xs text-slate-800">
              {mcpConnectorUrl(mcpGeneratedToken)}
            </code>
            <button type="button" onClick={handleCopyMcpToken} className="mc-btn-ghost !px-2 !py-1 !text-xs">
              {mcpCopied ? 'Kopiert ✓' : 'In Zwischenablage kopieren'}
            </button>
          </div>
        )}
      </div>
      </section>
      )}

      {activeSection === 'benutzer' && isAdmin && (
      <section className="mc-animate-fade">
        <UserManagement currentUserId={userId} />
      </section>
      )}

      </div>
      </div>
      </div>
    </div>
  )
}
