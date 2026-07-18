import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    navigate('/')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form
        onSubmit={handleLogin}
        className="mc-animate-pop w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-xl"
      >
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold text-slate-900">MandatsCockpit</h1>
          <p className="text-sm text-slate-500">Dein Dashboard fürs Mandat</p>
        </div>
        <input
          type="email"
          placeholder="E-Mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mc-input w-full"
          required
        />
        <input
          type="password"
          placeholder="Passwort"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mc-input w-full"
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={loading} className="mc-btn-primary w-full !py-2.5">
          {loading ? 'Anmelden...' : 'Anmelden'}
        </button>
        <p className="text-center text-xs text-slate-400">
          Accounts werden aktuell vom Ratsbüro über das Supabase-Dashboard angelegt (siehe README).
        </p>
      </form>
    </div>
  )
}
