import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'

/**
 * Blockiert die gesamte App, solange profiles.muss_passwort_aendern true
 * ist (admin-vergebenes Start-Passwort bzw. Admin-Reset, siehe
 * ProtectedRoute.tsx). Ein Nutzer darf ein solches Passwort nie dauerhaft
 * behalten - hier gibt es keinen "Überspringen"-Weg, nur "Abmelden" als
 * Ausweg statt eines Dead-Ends.
 */
export function ForcedPasswordChange({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [passwordWiederholen, setPasswordWiederholen] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Das Passwort muss mindestens 8 Zeichen lang sein.')
      return
    }
    if (password !== passwordWiederholen) {
      setError('Die beiden Passwörter stimmen nicht überein.')
      return
    }
    setSaving(true)
    const { error: authError } = await supabase.auth.updateUser({ password })
    if (authError) {
      setError(authError.message)
      setSaving(false)
      return
    }
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ muss_passwort_aendern: false })
      .eq('id', userId)
    if (profileError) {
      setError(profileError.message)
      setSaving(false)
      return
    }
    onDone()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form
        onSubmit={handleSubmit}
        className="mc-animate-pop w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-xl"
      >
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-bold text-slate-900">Neues Passwort erforderlich</h1>
          <p className="text-sm text-slate-500">
            Bevor es weitergeht, musst du dein Start-Passwort einmalig durch ein eigenes ersetzen.
          </p>
        </div>
        <input
          type="password"
          placeholder="Neues Passwort"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mc-input w-full"
          autoComplete="new-password"
          required
        />
        <input
          type="password"
          placeholder="Passwort wiederholen"
          value={passwordWiederholen}
          onChange={(e) => setPasswordWiederholen(e.target.value)}
          className="mc-input w-full"
          autoComplete="new-password"
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={saving} className="mc-btn-primary w-full !py-2.5">
          {saving ? 'Speichern...' : 'Passwort setzen'}
        </button>
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="mc-btn-ghost w-full !py-1.5 text-xs text-slate-400"
        >
          Abmelden
        </button>
      </form>
    </div>
  )
}
