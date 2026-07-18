import { useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type { Rolle } from '../lib/types'
import { PARTEI_THEMES, themeById } from '../lib/themes'
import { formatDateTime } from '../lib/format'

// Admin-Benutzerverwaltung: läuft komplett über die admin-users Edge Function
// (Service-Role-Operationen, siehe supabase/functions/admin-users/index.ts).
// Wird nur gerendert, wenn der eingeloggte Nutzer rolle='admin' hat - die
// eigentliche Zugriffskontrolle macht aber die Edge Function serverseitig.

interface AdminUser {
  id: string
  email: string
  name: string
  rolle: Rolle
  fraktion: string | null
  partei: string | null
  created_at: string
  last_sign_in_at: string | null
}

const ROLLEN: { value: Rolle; label: string }[] = [
  { value: 'mitglied', label: 'Mitglied' },
  { value: 'fraktionsbuero', label: 'Fraktionsbüro' },
  { value: 'admin', label: 'Admin' },
]

function rolleLabel(rolle: Rolle): string {
  return ROLLEN.find((r) => r.value === rolle)?.label ?? rolle
}

function rolleBadgeClass(rolle: Rolle): string {
  if (rolle === 'admin') return 'bg-primary/10 text-primary'
  if (rolle === 'fraktionsbuero') return 'bg-amber-100 text-amber-700'
  return 'bg-slate-100 text-slate-600'
}

async function callAdminUsers<T>(body: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await supabase.functions.invoke<T>('admin-users', { body })
  if (error) {
    let message = error.message
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      try {
        const json = await context.json()
        if (json?.error) message = json.error
      } catch {
        // Antwort war kein JSON - Standardmeldung behalten
      }
    }
    return { error: message }
  }
  return { data: data ?? undefined }
}

interface UserFormState {
  name: string
  email: string
  password: string
  rolle: Rolle
  fraktion: string
  partei: string
}

const EMPTY_FORM: UserFormState = { name: '', email: '', password: '', rolle: 'mitglied', fraktion: '', partei: '' }

function UserForm({
  form,
  setForm,
  onSubmit,
  onCancel,
  saving,
  submitLabel,
  isCreate,
}: {
  form: UserFormState
  setForm: (f: UserFormState) => void
  onSubmit: (e: FormEvent) => void
  onCancel: () => void
  saving: boolean
  submitLabel: string
  isCreate: boolean
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-2.5">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <input
          type="text"
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="mc-input"
          required
        />
        <input
          type="email"
          placeholder="E-Mail"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="mc-input"
          required={isCreate}
        />
        <input
          type="password"
          placeholder={isCreate ? 'Start-Passwort' : 'Neues Passwort (leer = unverändert)'}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          className="mc-input"
          required={isCreate}
          minLength={8}
          autoComplete="new-password"
        />
        <select
          value={form.rolle}
          onChange={(e) => setForm({ ...form, rolle: e.target.value as Rolle })}
          className="mc-input"
        >
          {ROLLEN.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Fraktion (optional)"
          value={form.fraktion}
          onChange={(e) => setForm({ ...form, fraktion: e.target.value })}
          className="mc-input"
        />
        <select
          value={form.partei}
          onChange={(e) => setForm({ ...form, partei: e.target.value })}
          className="mc-input"
        >
          {PARTEI_THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id ? t.label : 'Partei: keine / neutral'}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="mc-btn-primary">
          {saving ? 'Speichern...' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="mc-btn-ghost">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

export function UserManagement({ currentUserId }: { currentUserId: string | null }) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<UserFormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<UserFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setListError(null)
    const { data, error } = await callAdminUsers<{ users: AdminUser[] }>({ action: 'list' })
    if (error) {
      setListError(error)
    } else {
      setUsers(data?.users ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setActionError(null)
    const { error } = await callAdminUsers({
      action: 'create',
      email: createForm.email,
      password: createForm.password,
      name: createForm.name,
      rolle: createForm.rolle,
      fraktion: createForm.fraktion || null,
      partei: createForm.partei || null,
    })
    if (error) {
      setActionError(error)
    } else {
      setShowCreate(false)
      setCreateForm(EMPTY_FORM)
      await load()
    }
    setSaving(false)
  }

  function startEdit(u: AdminUser) {
    setEditingId(u.id)
    setActionError(null)
    setEditForm({
      name: u.name,
      email: u.email,
      password: '',
      rolle: u.rolle,
      fraktion: u.fraktion ?? '',
      partei: u.partei ?? '',
    })
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingId) return
    setSaving(true)
    setActionError(null)
    const original = users.find((u) => u.id === editingId)
    const { error } = await callAdminUsers({
      action: 'update',
      user_id: editingId,
      name: editForm.name,
      rolle: editForm.rolle,
      fraktion: editForm.fraktion,
      partei: editForm.partei,
      // E-Mail/Passwort nur mitschicken, wenn wirklich geändert
      ...(editForm.email && editForm.email !== original?.email ? { email: editForm.email } : {}),
      ...(editForm.password ? { password: editForm.password } : {}),
    })
    if (error) {
      setActionError(error)
    } else {
      setEditingId(null)
      await load()
    }
    setSaving(false)
  }

  async function handleDelete(u: AdminUser) {
    const message = `Benutzer "${u.name}" (${u.email}) endgültig löschen? Alle Termine, Karten, Notizen und Dateien dieses Nutzers werden mitgelöscht.`
    if (!window.confirm(message)) return
    setActionError(null)
    const { error } = await callAdminUsers({ action: 'delete', user_id: u.id })
    if (error) {
      setActionError(error)
    } else {
      await load()
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Benutzerverwaltung</h2>
          <p className="text-sm text-slate-500">
            {loading ? 'Lade Benutzer...' : `${users.length} Benutzer`}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} disabled={loading} className="mc-btn-ghost" title="Neu laden">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => {
              setShowCreate((v) => !v)
              setActionError(null)
            }}
            className={showCreate ? 'mc-btn-ghost' : 'mc-btn-primary'}
          >
            {showCreate ? (
              <>
                <X size={16} /> Abbrechen
              </>
            ) : (
              <>
                <Plus size={16} /> Benutzer anlegen
              </>
            )}
          </button>
        </div>
      </div>

      {actionError && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {showCreate && (
        <div className="mc-card mc-animate-pop mb-4 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Neuen Benutzer anlegen</h3>
          <UserForm
            form={createForm}
            setForm={setCreateForm}
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            saving={saving}
            submitLabel="Benutzer anlegen"
            isCreate
          />
          <p className="mt-2 text-xs text-slate-400">
            Der Benutzer kann sich sofort mit E-Mail und Start-Passwort anmelden (keine
            Bestätigungsmail). Passwort bitte sicher übermitteln.
          </p>
        </div>
      )}

      {listError && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {listError}
        </p>
      )}

      <ul className="space-y-2">
        {users.map((u) => {
          const isSelf = u.id === currentUserId
          if (editingId === u.id) {
            return (
              <li key={u.id} className="mc-card mc-animate-fade p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-900">
                  {u.name} bearbeiten
                </h3>
                <UserForm
                  form={editForm}
                  setForm={setEditForm}
                  onSubmit={handleSaveEdit}
                  onCancel={() => setEditingId(null)}
                  saving={saving}
                  submitLabel="Speichern"
                  isCreate={false}
                />
              </li>
            )
          }
          return (
            <li key={u.id} className="mc-card flex items-center gap-3 p-3 !rounded-lg">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {u.name.charAt(0).toUpperCase() || '?'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-slate-900">{u.name}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${rolleBadgeClass(u.rolle)}`}
                  >
                    {rolleLabel(u.rolle)}
                  </span>
                  {u.partei && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                      {themeById(u.partei).label}
                    </span>
                  )}
                  {isSelf && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Du
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {u.email}
                  {u.last_sign_in_at
                    ? ` · zuletzt angemeldet ${formatDateTime(u.last_sign_in_at)}`
                    : ' · noch nie angemeldet'}
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => startEdit(u)}
                  className="mc-btn-ghost !px-2 !py-2"
                  title="Bearbeiten"
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(u)}
                  disabled={isSelf}
                  className="mc-btn-danger !px-2 !py-2"
                  title={isSelf ? 'Du kannst dich nicht selbst löschen' : 'Löschen'}
                >
                  <Trash2 size={15} />
                </button>
              </span>
            </li>
          )
        })}
        {!loading && !listError && users.length === 0 && (
          <li className="mc-card p-6 text-center text-sm text-slate-400">Keine Benutzer gefunden.</li>
        )}
      </ul>
    </div>
  )
}
