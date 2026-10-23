import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import { tagGruppe, type TagGruppe } from '../lib/vorgaenge'

const GRUPPEN: { id: TagGruppe; titel: string }[] = [
  { id: 'gremien', titel: 'Gremien' },
  { id: 'antragsteller', titel: 'Antragsteller' },
  { id: 'themen', titel: 'Themen' },
]

/** So viele Tags je Gruppe sind ohne Suche sichtbar, der Rest hinter „weitere". */
const SICHTBAR = 8

/**
 * Filterfenster des Dokumenten-Hubs (Umgestaltung 23.10.2026): ersetzt die
 * frühere Wolke aller Tags über der Liste. Tags nach Gremien, Antragstellern
 * und Themen gruppiert, mit Suche; schließt per Klick daneben und Escape.
 */
export function FilterAuswahl({
  tags,
  aktiv,
  onUmschalten,
  zusatz,
}: {
  tags: string[]
  aktiv: string[]
  onUmschalten: (tag: string) => void
  /** Weitere Gruppe oben im Fenster, z. B. die Ebenen. */
  zusatz?: ReactNode
}) {
  const [offen, setOffen] = useState(false)
  const [suche, setSuche] = useState('')
  const [alleZeigen, setAlleZeigen] = useState<Set<TagGruppe>>(new Set())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!offen) return
    function beiKlick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOffen(false)
    }
    function beiTaste(e: KeyboardEvent) {
      if (e.key === 'Escape') setOffen(false)
    }
    document.addEventListener('mousedown', beiKlick)
    document.addEventListener('keydown', beiTaste)
    return () => {
      document.removeEventListener('mousedown', beiKlick)
      document.removeEventListener('keydown', beiTaste)
    }
  }, [offen])

  const begriff = suche.trim().toLowerCase()
  const passend = tags.filter((t) => !begriff || t.toLowerCase().includes(begriff))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOffen((v) => !v)}
        aria-expanded={offen}
        aria-haspopup="dialog"
        className={`inline-flex min-h-8.5 items-center gap-1.5 rounded-full border border-slate-300 px-3 text-[13px] font-semibold transition-colors ${
          offen ? 'bg-slate-100' : 'bg-white hover:bg-slate-50'
        }`}
      >
        <SlidersHorizontal size={14} />
        Filter{aktiv.length > 0 ? ` · ${aktiv.length}` : ''}
      </button>
      {offen && (
        <div
          role="dialog"
          aria-label="Filter"
          className="mc-animate-pop absolute left-0 top-full z-30 mt-2 flex max-h-[70vh] w-[min(560px,calc(100vw-2rem))] flex-col gap-4 overflow-y-auto rounded-[14px] border border-slate-200 bg-white p-4 shadow-xl"
        >
          <label className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm text-slate-500">
            <Search size={14} />
            <input
              type="search"
              autoFocus
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder="Gremium, Fraktion, Thema …"
              aria-label="Filter durchsuchen"
              className="min-w-0 flex-1 bg-transparent text-slate-900 outline-none"
            />
          </label>
          {zusatz}
          {GRUPPEN.map((g) => {
            const inGruppe = passend.filter((t) => tagGruppe(t) === g.id)
            if (inGruppe.length === 0) return null
            const alle = Boolean(begriff) || alleZeigen.has(g.id)
            // Aktive Tags immer zeigen, auch wenn sie hinter „weitere" lägen.
            const sichtbar = alle
              ? inGruppe
              : [...inGruppe.slice(0, SICHTBAR), ...inGruppe.slice(SICHTBAR).filter((t) => aktiv.includes(t))]
            const rest = inGruppe.length - sichtbar.length
            return (
              <div key={g.id} className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{g.titel}</span>
                <div className="flex flex-wrap gap-1.5">
                  {sichtbar.map((t) => {
                    const an = aktiv.includes(t)
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={an}
                        onClick={() => onUmschalten(t)}
                        className={`min-h-7.5 rounded-full border px-2.5 text-[13px] transition-colors ${
                          an ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white hover:bg-slate-50'
                        }`}
                      >
                        {t}
                      </button>
                    )
                  })}
                  {rest > 0 && (
                    <button
                      type="button"
                      onClick={() => setAlleZeigen((s) => new Set(s).add(g.id))}
                      className="min-h-7.5 px-2 text-[13px] font-medium text-primary hover:underline"
                    >
                      + {rest} weitere
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {passend.length === 0 && <p className="text-sm text-slate-500">Kein Tag passt zur Suche.</p>}
        </div>
      )}
    </div>
  )
}
