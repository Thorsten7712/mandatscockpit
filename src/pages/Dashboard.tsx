import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { CalendarView } from '../components/CalendarView'
import { TodoBoard } from '../components/TodoBoard'
import { logoUrl, themeById } from '../lib/themes'

export default function Dashboard() {
  const [profileName, setProfileName] = useState('')
  const [profileFotoUrl, setProfileFotoUrl] = useState<string | null>(null)
  const [partei, setPartei] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('name, foto_url, partei')
        .eq('id', data.user.id)
        .single()
      setProfileName(profile?.name ?? '')
      setPartei(profile?.partei ?? null)
      if (profile?.foto_url) {
        const { data: signed } = await supabase.storage
          .from('profilbilder')
          .createSignedUrl(profile.foto_url, 3600)
        setProfileFotoUrl(signed?.signedUrl ?? null)
      }
    })
  }, [])

  const theme = themeById(partei)
  const parteiLogo = logoUrl(theme)

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="h-1.5 bg-topbar" aria-hidden="true" />
      <div className="p-6">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            {profileFotoUrl ? (
              <img src={profileFotoUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
            ) : profileName ? (
              <span className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-sm font-medium text-slate-500">
                {profileName.charAt(0).toUpperCase()}
              </span>
            ) : null}
            MandatsCockpit{profileName && ` - ${profileName}`}
          </h1>
          <div className="flex items-center gap-4">
            <Link to="/settings" className="text-sm text-slate-600 underline">
              Einstellungen
            </Link>
            <button onClick={() => supabase.auth.signOut()} className="text-sm text-slate-600 underline">
              Abmelden
            </button>
            {parteiLogo && <img src={parteiLogo} alt={theme.label} className="h-8 w-auto" />}
          </div>
        </header>
        <main>
          <section className="mb-8">
            <h2 className="font-semibold mb-2">ToDo-Board</h2>
            <TodoBoard />
          </section>
          <CalendarView />
        </main>
      </div>
    </div>
  )
}
