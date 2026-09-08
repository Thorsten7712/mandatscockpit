import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, LogOut, Settings } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { CalendarView } from '../components/CalendarView'
import { TodoBoard } from '../components/TodoBoard'
import { AntraegeSection } from '../components/AntraegeSection'
import { PresseschauSection } from '../components/PresseschauSection'
import { logoUrl, themeById } from '../lib/themes'
import { istDokumentUngelesen } from '../lib/dokumenteGelesen'

export default function Dashboard() {
  const [profileName, setProfileName] = useState('')
  const [profileFotoUrl, setProfileFotoUrl] = useState<string | null>(null)
  const [partei, setPartei] = useState<string | null>(null)
  const [presseschauAktiv, setPresseschauAktiv] = useState(false)
  const [ungeleseneDokumente, setUngeleseneDokumente] = useState(0)

  // Profilmenü (Einstellungen/Abmelden) hinter dem eigenen Profilbild - hält
  // die Kopfleiste auf die drei inhaltlichen Ziele beschränkt.
  const [menuOffen, setMenuOffen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Zählt Top-Level-Dokumente (parent_id null), die entweder nie geöffnet
  // wurden oder seit dem letzten Öffnen eine neue Notiz bekommen haben (siehe
  // src/lib/dokumenteGelesen.ts). Eine einzige Abfrage über alle für den
  // Nutzer sichtbaren dokumente-Zeilen (Top-Level + Notizen) reicht, RLS
  // filtert auf das Sichtbare (0033/0034_dokumente*.sql).
  async function loadUngeleseneDokumente(uid: string) {
    const { data: alle } = await supabase.from('dokumente').select('id, parent_id, erstellt_am')
    const topLevel = (alle ?? []).filter((d) => !d.parent_id)
    const kinderByParent = new Map<string, { erstellt_am: string }[]>()
    for (const d of alle ?? []) {
      if (!d.parent_id) continue
      const list = kinderByParent.get(d.parent_id) ?? []
      list.push({ erstellt_am: d.erstellt_am })
      kinderByParent.set(d.parent_id, list)
    }
    const { data: gelesen } = await supabase.from('dokument_gelesen').select('dokument_id, gelesen_am').eq('user_id', uid)
    const gelesenMap = new Map((gelesen ?? []).map((g) => [g.dokument_id, g.gelesen_am]))
    const anzahl = topLevel.filter((d) =>
      istDokumentUngelesen(d, kinderByParent.get(d.id) ?? [], gelesenMap.get(d.id)),
    ).length
    setUngeleseneDokumente(anzahl)
  }

  // Schließen per Klick daneben und per Escape. Beide Listener hängen nur,
  // solange das Menü offen ist. 'mousedown' statt 'click', damit das Menü sich
  // schließt, bevor ein Klick auf ein Element dahinter dort ankommt.
  useEffect(() => {
    if (!menuOffen) return
    function beiKlickAussen(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOffen(false)
    }
    function beiEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOffen(false)
    }
    document.addEventListener('mousedown', beiKlickAussen)
    document.addEventListener('keydown', beiEscape)
    return () => {
      document.removeEventListener('mousedown', beiKlickAussen)
      document.removeEventListener('keydown', beiEscape)
    }
  }, [menuOffen])

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('name, foto_url, partei, presseschau_aktiv')
        .eq('id', data.user.id)
        .single()
      setProfileName(profile?.name ?? '')
      setPartei(profile?.partei ?? null)
      setPresseschauAktiv(profile?.presseschau_aktiv ?? false)
      if (profile?.foto_url) {
        const { data: signed } = await supabase.storage
          .from('profilbilder')
          .createSignedUrl(profile.foto_url, 3600)
        setProfileFotoUrl(signed?.signedUrl ?? null)
      }
      await loadUngeleseneDokumente(data.user.id)
    })
  }, [])

  const theme = themeById(partei)
  const parteiLogo = logoUrl(theme)

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="h-1.5 bg-topbar" aria-hidden="true" />
      <header className="bg-gradient-to-r from-primary to-primary-hover text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div className="relative flex min-w-0 items-center gap-3" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOffen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOffen}
              aria-label="Profilmenü öffnen"
              title="Einstellungen und Abmelden"
              className="group relative shrink-0 rounded-full ring-2 ring-white/40 transition hover:ring-white/80 focus:outline-none focus-visible:ring-white"
            >
              {profileFotoUrl ? (
                <img src={profileFotoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-base font-semibold">
                  {profileName ? profileName.charAt(0).toUpperCase() : '?'}
                </span>
              )}
              <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-primary shadow">
                <ChevronDown size={12} className={`transition-transform ${menuOffen ? 'rotate-180' : ''}`} />
              </span>
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold leading-tight">MandatsCockpit</h1>
              {profileName && <p className="truncate text-sm leading-tight text-white/80">{profileName}</p>}
            </div>
            {menuOffen && (
              <div
                role="menu"
                className="mc-animate-pop absolute left-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-xl bg-white py-1 text-slate-700 shadow-xl ring-1 ring-slate-200"
              >
                <Link
                  to="/settings"
                  role="menuitem"
                  onClick={() => setMenuOffen(false)}
                  className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50"
                >
                  <Settings size={15} className="text-slate-400" />
                  Einstellungen
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOffen(false)
                    supabase.auth.signOut()
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <LogOut size={15} className="text-slate-400" />
                  Abmelden
                </button>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/dokumente"
              className="mc-btn px-3 py-1.5 text-sm text-white/90 hover:bg-white/15 hover:text-white"
            >
              Dokumente
              {ungeleseneDokumente > 0 && (
                <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-primary">
                  {ungeleseneDokumente}
                </span>
              )}
            </Link>
            <Link
              to="/fakten"
              className="mc-btn px-3 py-1.5 text-sm text-white/90 hover:bg-white/15 hover:text-white"
            >
              Zahlen &amp; Fakten
            </Link>
            <Link
              to="/archiv"
              className="mc-btn px-3 py-1.5 text-sm text-white/90 hover:bg-white/15 hover:text-white"
            >
              Archiv
            </Link>
            {parteiLogo && (
              <span className="ml-2 flex h-11 items-center rounded-lg bg-white px-2.5 shadow-sm">
                <img src={parteiLogo} alt={theme.label} className="h-7 w-auto" />
              </span>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">
        {presseschauAktiv && <PresseschauSection />}
        <section className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-slate-900">ToDo-Board</h2>
          <TodoBoard />
        </section>
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <CalendarView />
          <AntraegeSection />
        </div>
      </main>
      <footer className="mx-auto max-w-7xl px-6 pb-8 text-xs text-slate-400">
        <Link to="/impressum" className="underline hover:text-slate-600">
          Impressum
        </Link>
        {' · '}
        <Link to="/datenschutz" className="underline hover:text-slate-600">
          Datenschutz
        </Link>
      </footer>
    </div>
  )
}
