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
    <div className="min-h-screen bg-slate-100">
      <div className="h-1.5 bg-topbar" aria-hidden="true" />
      <header className="bg-gradient-to-r from-primary to-primary-hover text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {profileFotoUrl ? (
              <img
                src={profileFotoUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-white/40"
              />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 text-base font-semibold ring-2 ring-white/40">
                {profileName ? profileName.charAt(0).toUpperCase() : '?'}
              </span>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold leading-tight">MandatsCockpit</h1>
              {profileName && <p className="truncate text-sm leading-tight text-white/80">{profileName}</p>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/archiv"
              className="mc-btn px-3 py-1.5 text-sm text-white/90 hover:bg-white/15 hover:text-white"
            >
              Archiv
            </Link>
            <Link
              to="/settings"
              className="mc-btn px-3 py-1.5 text-sm text-white/90 hover:bg-white/15 hover:text-white"
            >
              Einstellungen
            </Link>
            <button
              onClick={() => supabase.auth.signOut()}
              className="mc-btn px-3 py-1.5 text-sm text-white/90 hover:bg-white/15 hover:text-white"
            >
              Abmelden
            </button>
            {parteiLogo && (
              <span className="ml-2 flex h-11 items-center rounded-lg bg-white px-2.5 shadow-sm">
                <img src={parteiLogo} alt={theme.label} className="h-7 w-auto" />
              </span>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <section className="mb-10">
          <h2 className="mb-3 text-base font-semibold text-slate-900">ToDo-Board</h2>
          <TodoBoard />
        </section>
        <CalendarView />
      </main>
    </div>
  )
}
