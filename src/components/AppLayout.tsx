import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Archive,
  BarChart3,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Home,
  Landmark,
  LogOut,
  Menu,
  Settings,
  SquareCheck,
  X,
  type LucideIcon,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { logoUrl, themeById } from '../lib/themes'
import { istDokumentUngelesen } from '../lib/dokumenteGelesen'
import { alleZeilen } from '../lib/alleZeilen'

/**
 * App-Rahmen für alle Seiten hinter dem Login (UI-Umbau 18.10.2026): eine
 * Leiste links, die sich auf Symbolbreite einklappen lässt, auf dem Handy
 * stattdessen eine Tab-Leiste unten. Die Seiten selbst bringen kein eigenes
 * Chrome mehr mit, nur ihren Titel (`mc-page-title`) und den Inhalt – damit
 * sind Breite, Abstände und Navigation überall gleich.
 */

interface NavZiel {
  to: string
  label: string
  icon: LucideIcon
  /** Zusätzliche Pfade, unter denen der Eintrag als aktiv gilt. */
  auch?: string[]
}

const ZIELE: NavZiel[] = [
  { to: '/', label: 'Heute', icon: Home },
  { to: '/kalender', label: 'Kalender', icon: CalendarDays, auch: ['/termin/event'] },
  { to: '/sitzungen', label: 'Sitzungen', icon: Landmark, auch: ['/termin/session'] },
  { to: '/aufgaben', label: 'Aufgaben', icon: SquareCheck },
  { to: '/dokumente', label: 'Dokumente', icon: FileText },
  { to: '/fakten', label: 'Zahlen & Fakten', icon: BarChart3 },
  { to: '/archiv', label: 'Archiv', icon: Archive },
]

/** Ereignis auf window, wenn die Einstellungen Name, Foto oder Partei ändern. */
export const PROFIL_GEAENDERT = 'mc:profil-geaendert'

// Die Tab-Leiste auf dem Handy hat Platz für fünf Ziele, der Rest liegt hinter „Mehr".
const HANDY_TABS = ['/', '/sitzungen', '/aufgaben', '/dokumente']

// Reine Anzeige-Vorliebe pro Gerät, deshalb localStorage und nicht die DB.
// Zugriffe in try/catch: im privaten Fenster kann schon der Zugriff werfen.
const EINGEKLAPPT_KEY = 'mc.leiste.eingeklappt'

function leseEingeklappt(): boolean {
  try {
    return window.localStorage.getItem(EINGEKLAPPT_KEY) === '1'
  } catch {
    return false
  }
}

function istAktiv(ziel: NavZiel, pfad: string): boolean {
  if (ziel.to === '/') return pfad === '/'
  return [ziel.to, ...(ziel.auch ?? [])].some((p) => pfad === p || pfad.startsWith(`${p}/`))
}

// Zählt Top-Level-Dokumente, die nie geöffnet wurden oder seit dem letzten
// Öffnen eine neue Notiz bekommen haben (src/lib/dokumenteGelesen.ts).
// Seitenweise, weil eine einzelne Abfrage bei 1.000 Zeilen abschneidet.
async function zaehleUngeleseneDokumente(uid: string): Promise<number> {
  const { zeilen: alle } = await alleZeilen<{ id: string; parent_id: string | null; erstellt_am: string }>((von, bis) =>
    supabase.from('dokumente').select('id, parent_id, erstellt_am').order('id').range(von, bis),
  )
  const kinderByParent = new Map<string, { erstellt_am: string }[]>()
  for (const d of alle) {
    if (!d.parent_id) continue
    const list = kinderByParent.get(d.parent_id) ?? []
    list.push({ erstellt_am: d.erstellt_am })
    kinderByParent.set(d.parent_id, list)
  }
  const { data: gelesen } = await supabase.from('dokument_gelesen').select('dokument_id, gelesen_am').eq('user_id', uid)
  const gelesenMap = new Map((gelesen ?? []).map((g) => [g.dokument_id, g.gelesen_am]))
  return alle.filter((d) => !d.parent_id && istDokumentUngelesen(d, kinderByParent.get(d.id) ?? [], gelesenMap.get(d.id)))
    .length
}

export function AppLayout() {
  const { pathname } = useLocation()
  const [eingeklappt, setEingeklappt] = useState(leseEingeklappt)
  const [mehrOffen, setMehrOffen] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [partei, setPartei] = useState<string | null>(null)
  const [ungelesen, setUngelesen] = useState(0)

  useEffect(() => {
    function ladeProfil() {
      supabase.auth.getUser().then(async ({ data }) => {
        if (!data.user) return
        setUserId(data.user.id)
        const { data: profile } = await supabase
          .from('profiles')
          .select('name, foto_url, partei')
          .eq('id', data.user.id)
          .single()
        setName(profile?.name ?? '')
        setPartei(profile?.partei ?? null)
        if (profile?.foto_url) {
          const { data: signed } = await supabase.storage.from('profilbilder').createSignedUrl(profile.foto_url, 3600)
          setFotoUrl(signed?.signedUrl ?? null)
        } else {
          setFotoUrl(null)
        }
      })
    }
    ladeProfil()
    // Name, Foto oder Partei in den Einstellungen geändert: Leiste nachziehen.
    window.addEventListener(PROFIL_GEAENDERT, ladeProfil)
    return () => window.removeEventListener(PROFIL_GEAENDERT, ladeProfil)
  }, [])

  // Neu zählen bei jedem Seitenwechsel: wer im Hub Dokumente gelesen hat,
  // sieht die Zahl spätestens beim nächsten Ziel aktualisiert.
  useEffect(() => {
    if (!userId) return
    let aktuell = true
    zaehleUngeleseneDokumente(userId).then((n) => {
      if (aktuell) setUngelesen(n)
    })
    return () => {
      aktuell = false
    }
  }, [userId, pathname])

  // „Mehr" schließt bei jedem Seitenwechsel und per Escape.
  useEffect(() => setMehrOffen(false), [pathname])
  useEffect(() => {
    if (!mehrOffen) return
    function beiEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setMehrOffen(false)
    }
    document.addEventListener('keydown', beiEscape)
    return () => document.removeEventListener('keydown', beiEscape)
  }, [mehrOffen])

  function umschalten() {
    setEingeklappt((v) => {
      try {
        window.localStorage.setItem(EINGEKLAPPT_KEY, v ? '0' : '1')
      } catch {
        // nur Anzeige-Vorliebe – ohne Speicher gilt sie eben für diese Sitzung
      }
      return !v
    })
  }

  const theme = themeById(partei)
  const parteiLogo = logoUrl(theme)
  const initiale = name ? name.charAt(0).toUpperCase() : '?'

  const avatar = (groesse: string) =>
    fotoUrl ? (
      <img src={fotoUrl} alt="" className={`${groesse} shrink-0 rounded-full object-cover`} />
    ) : (
      <span
        className={`${groesse} flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary`}
      >
        {initiale}
      </span>
    )

  const badge = (zahl: number, klein: boolean) =>
    zahl > 0 ? (
      <span
        className={
          klein
            ? 'absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white'
            : 'ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-bold leading-none text-white'
        }
        aria-label={`${zahl} ungelesen`}
      >
        {zahl}
      </span>
    ) : null

  const handyMehr = ZIELE.filter((z) => !HANDY_TABS.includes(z.to))
  const mehrAktiv = handyMehr.some((z) => istAktiv(z, pathname)) || pathname.startsWith('/settings')

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="sticky top-0 z-40 h-1 bg-topbar" aria-hidden="true" />
      <div className="flex">
        {/* Leiste ab Tablet-Breite */}
        <aside
          className={`sticky top-1 hidden h-[calc(100vh-0.25rem)] shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 md:flex ${
            eingeklappt ? 'w-[72px]' : 'w-60'
          }`}
        >
          <div className={`flex h-16 items-center gap-3 border-b border-slate-100 ${eingeklappt ? 'justify-center' : 'px-4'}`}>
            {parteiLogo ? (
              <img src={parteiLogo} alt={theme.label} className="h-8 w-auto max-w-10 shrink-0 object-contain" />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
                M
              </span>
            )}
            {!eingeklappt && <span className="truncate text-[15px] font-bold tracking-tight">MandatsCockpit</span>}
          </div>

          <nav aria-label="Hauptnavigation" className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
            {ZIELE.map((ziel) => {
              const aktiv = istAktiv(ziel, pathname)
              const Icon = ziel.icon
              const zahl = ziel.to === '/dokumente' ? ungelesen : 0
              return (
                <NavLink
                  key={ziel.to}
                  to={ziel.to}
                  end={ziel.to === '/'}
                  title={eingeklappt ? ziel.label : undefined}
                  aria-current={aktiv ? 'page' : undefined}
                  className={`relative flex min-h-11 items-center gap-3 rounded-lg text-[15px] transition-colors ${
                    eingeklappt ? 'justify-center' : 'px-3'
                  } ${aktiv ? 'bg-primary/10 font-semibold text-primary' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
                >
                  <span className="relative">
                    <Icon size={20} className="shrink-0" />
                    {eingeklappt && badge(zahl, true)}
                  </span>
                  {!eingeklappt && <span className="truncate">{ziel.label}</span>}
                  {!eingeklappt && badge(zahl, false)}
                </NavLink>
              )
            })}
          </nav>

          <div className="flex flex-col gap-1 border-t border-slate-100 p-3">
            <Link
              to="/settings"
              title={eingeklappt ? 'Einstellungen' : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-lg transition-colors ${eingeklappt ? 'justify-center' : 'px-2'} ${
                pathname.startsWith('/settings') ? 'bg-primary/10 text-primary' : 'hover:bg-slate-100'
              }`}
            >
              {avatar('h-8 w-8')}
              {!eingeklappt && (
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-sm font-semibold">{name || 'Profil'}</span>
                  <span className="text-xs text-slate-500">Einstellungen</span>
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={() => supabase.auth.signOut()}
              title={eingeklappt ? 'Abmelden' : undefined}
              className={`flex min-h-10 items-center gap-3 rounded-lg text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 ${
                eingeklappt ? 'justify-center' : 'px-3'
              }`}
            >
              <LogOut size={18} />
              {!eingeklappt && 'Abmelden'}
            </button>
            <button
              type="button"
              onClick={umschalten}
              aria-label={eingeklappt ? 'Leiste ausklappen' : 'Leiste einklappen'}
              className={`flex min-h-10 items-center gap-3 rounded-lg text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 ${
                eingeklappt ? 'justify-center' : 'px-3'
              }`}
            >
              {eingeklappt ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
              {!eingeklappt && 'Einklappen'}
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-8 pt-6 sm:px-6 md:pb-12 md:pt-7 lg:px-10">
            <Outlet />
          </main>
          <footer className="mx-auto w-full max-w-[1440px] px-4 pb-24 text-xs text-slate-400 sm:px-6 md:pb-8 lg:px-10">
            <Link to="/impressum" className="underline hover:text-slate-600">
              Impressum
            </Link>
            {' · '}
            <Link to="/datenschutz" className="underline hover:text-slate-600">
              Datenschutz
            </Link>
          </footer>
        </div>
      </div>

      {/* Tab-Leiste auf dem Handy */}
      <nav
        aria-label="Hauptnavigation"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {ZIELE.filter((z) => HANDY_TABS.includes(z.to)).map((ziel) => {
          const aktiv = istAktiv(ziel, pathname)
          const Icon = ziel.icon
          return (
            <NavLink
              key={ziel.to}
              to={ziel.to}
              end={ziel.to === '/'}
              aria-current={aktiv ? 'page' : undefined}
              className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${
                aktiv ? 'font-semibold text-primary' : 'text-slate-500'
              }`}
            >
              <span className="relative">
                <Icon size={22} />
                {badge(ziel.to === '/dokumente' ? ungelesen : 0, true)}
              </span>
              {ziel.label}
            </NavLink>
          )
        })}
        <button
          type="button"
          onClick={() => setMehrOffen((v) => !v)}
          aria-expanded={mehrOffen}
          className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${
            mehrAktiv || mehrOffen ? 'font-semibold text-primary' : 'text-slate-500'
          }`}
        >
          <Menu size={22} />
          Mehr
        </button>
      </nav>

      {mehrOffen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Weitere Bereiche">
          <button
            type="button"
            aria-label="Schließen"
            className="absolute inset-0 bg-slate-900/30"
            onClick={() => setMehrOffen(false)}
          />
          <div className="mc-animate-pop absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-3">
                {avatar('h-9 w-9')}
                <span className="text-sm font-semibold">{name || 'Profil'}</span>
              </span>
              <button type="button" onClick={() => setMehrOffen(false)} aria-label="Schließen" className="mc-btn-ghost">
                <X size={18} />
              </button>
            </div>
            <div className="flex flex-col">
              {handyMehr.map((ziel) => {
                const Icon = ziel.icon
                return (
                  <Link
                    key={ziel.to}
                    to={ziel.to}
                    className={`flex min-h-12 items-center gap-3 rounded-lg px-3 text-[15px] ${
                      istAktiv(ziel, pathname) ? 'bg-primary/10 font-semibold text-primary' : 'text-slate-700'
                    }`}
                  >
                    <Icon size={20} />
                    {ziel.label}
                  </Link>
                )
              })}
              <Link to="/settings" className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-[15px] text-slate-700">
                <Settings size={20} />
                Einstellungen
              </Link>
              <button
                type="button"
                onClick={() => supabase.auth.signOut()}
                className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-left text-[15px] text-slate-700"
              >
                <LogOut size={20} />
                Abmelden
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
