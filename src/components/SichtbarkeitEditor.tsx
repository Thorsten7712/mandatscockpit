import { useState } from 'react'
import type { DokumentSichtbarkeit, Profile } from '../lib/types'

/**
 * Sichtbarkeit-Auswahl (Persönlich/Ganze Ebene/Einzelne Personen) samt
 * Personen-Suche für "Einzelne Personen" - gemeinsam genutzt fürs Anlegen
 * UND fürs nachträgliche Bearbeiten von Notizen im Dokumenten-Hub
 * (DokumentDetailModal.tsx). Verwaltet die Such-Dropdown-Interna selbst,
 * meldet nach außen nur die finalen Werte.
 */
export function SichtbarkeitEditor({
  sichtbarkeit,
  onSichtbarkeitChange,
  ebeneOptionLabel,
  teilenMit,
  onTeilenMitChange,
  candidates,
}: {
  sichtbarkeit: DokumentSichtbarkeit
  onSichtbarkeitChange: (v: DokumentSichtbarkeit) => void
  ebeneOptionLabel: string
  teilenMit: string[]
  onTeilenMitChange: (ids: string[]) => void
  candidates: Profile[]
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  const gefiltert = candidates
    .filter((c) => !teilenMit.includes(c.id))
    .filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={sichtbarkeit === 'persoenlich'} onChange={() => onSichtbarkeitChange('persoenlich')} />
          Persönlich
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={sichtbarkeit === 'geteilt'} onChange={() => onSichtbarkeitChange('geteilt')} />
          {ebeneOptionLabel}
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={sichtbarkeit === 'einzelpersonen'} onChange={() => onSichtbarkeitChange('einzelpersonen')} />
          Einzelne Personen
        </label>
      </div>
      {sichtbarkeit === 'einzelpersonen' && (
        <div className="mt-2">
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {teilenMit.map((uid) => {
              const p = candidates.find((c) => c.id === uid)
              return (
                <span key={uid} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                  {p?.name ?? '…'}
                  <button type="button" onClick={() => onTeilenMitChange(teilenMit.filter((x) => x !== uid))} className="hover:opacity-70">
                    ×
                  </button>
                </span>
              )
            })}
          </div>
          <div className="relative">
            <input
              type="text"
              placeholder="Kolleg*in suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              className="mc-input w-full"
            />
            {open && (
              <ul className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {gefiltert.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onMouseDown={() => {
                        onTeilenMitChange([...teilenMit, c.id])
                        setSearch('')
                      }}
                      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                    >
                      {c.name}
                    </button>
                  </li>
                ))}
                {gefiltert.length === 0 && (
                  <li className="px-3 py-1.5 text-sm text-slate-400">
                    {candidates.length === 0 ? 'Keine Kolleg*innen mit gleicher Partei/Ebene gefunden.' : 'Keine Treffer.'}
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
