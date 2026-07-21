import { X } from 'lucide-react'
import { TerminDetailPanel } from './TerminDetailPanel'

/**
 * Dünner Modal-Wrapper um TerminDetailPanel (layout="columns"), damit
 * Sitzungstermine/eigene Termine dasselbe breite Detail-Modal-Muster wie
 * ToDo- und Antrag-Karten nutzen (siehe DetailModalShell.tsx) statt der
 * früheren Inline-Split-View. Eigenes Chrome statt DetailModalShell, weil
 * der Titel hier generisch ("Termin"/"Sitzung") bleibt - der eigentliche
 * Titel steht bereits als erste Zeile in TerminDetailPanel selbst, direkt
 * sichtbar ohne Scrollen.
 */
export function TerminDetailModal({
  kind,
  id,
  onClose,
  onDeleted,
}: {
  kind: 'event' | 'session'
  id: string
  onClose: () => void
  onDeleted?: () => void
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
          <h1 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {kind === 'session' ? 'Sitzung' : 'Termin'}
          </h1>
          <button type="button" onClick={onClose} aria-label="Schließen" title="Schließen" className="mc-btn-ghost shrink-0 !p-2">
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <TerminDetailPanel
            kind={kind}
            id={id}
            layout="columns"
            onDeleted={() => {
              onDeleted?.()
              onClose()
            }}
          />
        </div>
      </div>
    </div>
  )
}
