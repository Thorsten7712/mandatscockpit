import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { ForcedPasswordChange } from './ForcedPasswordChange'
import type { Session } from '@supabase/supabase-js'

export function ProtectedRoute({ children }: { children: JSX.Element }) {
  const [session, setSession] = useState<Session | null>(null)
  // null = noch nicht geladen, sonst der tatsächliche Wert aus profiles.
  const [mussPasswortAendern, setMussPasswortAendern] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadMussPasswortAendern(uid: string) {
    const { data } = await supabase.from('profiles').select('muss_passwort_aendern').eq('id', uid).single()
    setMussPasswortAendern(data?.muss_passwort_aendern ?? false)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      if (data.session) await loadMussPasswortAendern(data.session.user.id)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (s) {
        loadMussPasswortAendern(s.user.id)
      } else {
        setMussPasswortAendern(null)
      }
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  if (loading) return <p className="p-8">Lade...</p>
  if (!session) return <Navigate to="/login" replace />
  // Admin-vergebenes Passwort darf nie dauerhaft behalten werden - blockt
  // jede geschützte Route, bis der Nutzer selbst ein neues gesetzt hat.
  if (mussPasswortAendern) {
    return <ForcedPasswordChange userId={session.user.id} onDone={() => setMussPasswortAendern(false)} />
  }
  return children
}
