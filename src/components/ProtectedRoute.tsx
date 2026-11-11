import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { ForcedPasswordChange } from './ForcedPasswordChange'
import { NUTZUNGSERKLAERUNG_VERSION, NutzungserklaerungBestaetigen } from './Nutzungserklaerung'
import type { Session } from '@supabase/supabase-js'

interface Pflichten {
  mussPasswortAendern: boolean
  /** null = noch nie bestätigt */
  erklaerungVersion: number | null
}

export function ProtectedRoute({ children }: { children: JSX.Element }) {
  const [session, setSession] = useState<Session | null>(null)
  // null = noch nicht geladen, sonst die tatsächlichen Werte aus profiles.
  const [pflichten, setPflichten] = useState<Pflichten | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadPflichten(uid: string) {
    const { data } = await supabase
      .from('profiles')
      .select('muss_passwort_aendern, nutzungserklaerung_version')
      .eq('id', uid)
      .single()
    setPflichten({
      mussPasswortAendern: data?.muss_passwort_aendern ?? false,
      erklaerungVersion: data?.nutzungserklaerung_version ?? null,
    })
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      if (data.session) await loadPflichten(data.session.user.id)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (s) {
        loadPflichten(s.user.id)
      } else {
        setPflichten(null)
      }
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  if (loading) return <p className="p-8">Lade...</p>
  if (!session) return <Navigate to="/login" replace />
  // Admin-vergebenes Passwort darf nie dauerhaft behalten werden - blockt
  // jede geschützte Route, bis der Nutzer selbst ein neues gesetzt hat.
  if (pflichten?.mussPasswortAendern) {
    return (
      <ForcedPasswordChange
        userId={session.user.id}
        onDone={() => setPflichten((p) => (p ? { ...p, mussPasswortAendern: false } : p))}
      />
    )
  }
  // Danach die Nutzungserklärung (erster Login bzw. neue Fassung). Solange
  // das Profil nicht geladen ist, wird nichts entschieden.
  if (pflichten && (pflichten.erklaerungVersion ?? 0) < NUTZUNGSERKLAERUNG_VERSION) {
    return (
      <NutzungserklaerungBestaetigen
        userId={session.user.id}
        erneut={pflichten.erklaerungVersion !== null}
        onDone={() => setPflichten((p) => (p ? { ...p, erklaerungVersion: NUTZUNGSERKLAERUNG_VERSION } : p))}
      />
    )
  }
  return children
}
