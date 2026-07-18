import { useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { applyTheme } from '../lib/themes'

/**
 * Lädt einmalig die Partei aus dem Profil des eingeloggten Nutzers und wendet
 * das zugehörige Theme an (data-theme auf <html>). Wird in App.tsx gemountet,
 * damit alle Routen (Dashboard, Settings, Termindetail) das Theme bekommen.
 * Nicht eingeloggte Nutzer (Login-Seite) behalten das neutrale Theme.
 * Settings ruft applyTheme() beim Speichern zusätzlich direkt auf.
 */
export function ThemeLoader() {
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('partei')
        .eq('id', data.user.id)
        .single()
      applyTheme(profile?.partei)
    })
  }, [])
  return null
}
