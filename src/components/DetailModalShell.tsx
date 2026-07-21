import type { ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Gemeinsame Hülle für breite 2-Spalten-Detail-Modals (ToDo, Antrag).
 * Linke Spalte = Kernfelder/Metadaten, rechte Spalte = Aktivität
 * (Kommentare/Dokumente) - beide unabhängig scrollend, damit nicht mehr
 * alles seriell in einem einzigen schmalen Scroll-Bereich steht.
 */
export function DetailModalShell({
  title,
  headerActions,
  onClose,
  left,
  right,
}: {
  title: ReactNode
  /** Speichern/Löschen o.ä. - sitzen im Header neben Schließen statt am Formularende. */
  headerActions?: ReactNode
  onClose: () => void
  left: ReactNode
  right: ReactNode
}) {
  return (
    <div
      className="mc-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="mc-animate-pop flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-slate-900">{title}</h1>
          <div className="flex shrink-0 items-center gap-2">
            {headerActions && <div className="flex items-center gap-1.5 border-r border-slate-200 pr-2">{headerActions}</div>}
            <button type="button" onClick={onClose} aria-label="Schließen" title="Schließen" className="mc-btn-ghost !p-2">
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="min-h-0 overflow-y-auto border-b border-slate-200 p-6 md:border-b-0 md:border-r">
            {left}
          </div>
          <div className="min-h-0 overflow-y-auto p-6">{right}</div>
        </div>
      </div>
    </div>
  )
}
