import { useState } from 'react'
import { tagColor } from '../lib/sourceColors'

/**
 * Editierbare Tag-Chip-Liste - gemeinsam genutzt fürs Anlegen UND fürs
 * nachträgliche Bearbeiten von Dokumenten/Notizen im Dokumenten-Hub
 * (Dokumente.tsx, DokumentDetailModal.tsx). `onChange` liefert die komplette
 * neue Liste, Persistenz macht der Aufrufer (sofort bei Bearbeiten, erst bei
 * Formular-Submit beim Anlegen).
 */
export function TagEditor({
  tags,
  onChange,
  vorschlaege = [],
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  vorschlaege?: string[]
}) {
  const [input, setInput] = useState('')

  function add(tag: string) {
    const t = tag.trim()
    if (!t || tags.includes(t)) return
    onChange([...tags, t])
  }

  return (
    <div>
      {vorschlaege.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {vorschlaege.filter((t) => !tags.includes(t)).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => add(t)}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200"
            >
              + {t}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span key={t} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${tagColor(t).chip}`}>
            {t}
            <button
              type="button"
              onClick={() => onChange(tags.filter((x) => x !== t))}
              aria-label={`Tag "${t}" entfernen`}
              className="hover:opacity-70"
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          placeholder="Tag + Enter"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(input)
              setInput('')
            }
          }}
          className="mc-input !w-32 !py-1 !text-xs"
        />
      </div>
    </div>
  )
}
