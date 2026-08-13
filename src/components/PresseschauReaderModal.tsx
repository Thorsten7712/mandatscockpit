import ReactMarkdown from 'react-markdown'
import { ChevronLeft, ChevronRight, Newspaper, X } from 'lucide-react'
import type { PresseschauRow } from '../lib/types'
import { formatDate } from '../lib/format'

/**
 * Vollansicht einer Presseschau-Ausgabe als fokussierter "Reader" (analog
 * Safari-Lesemodus/Apple News) statt eines eigenen Seitenbereichs auf dem
 * Dashboard - so bleibt die Startseite kompakt (ToDo-Board/Termine ohne
 * Scrollen sichtbar), während die Presseschau selbst weiterhin ihren vollen
 * Lesekomfort (Zeitungslayout, Tage-Navigation) behält. Bekommt Daten/Index
 * von PresseschauSection durchgereicht statt selbst nachzuladen - die sind
 * dort ohnehin schon im Speicher.
 */
export function PresseschauReaderModal({
  current,
  isNeuest,
  isAeltest,
  onPrev,
  onNext,
  onClose,
}: {
  current: PresseschauRow
  isNeuest: boolean
  isAeltest: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}) {
  return (
    <div
      className="mc-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mc-animate-pop flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-[#fbf9f4] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b-4 border-double border-slate-800 bg-[#fbf9f4]/95 px-5 pb-3 pt-4 backdrop-blur sm:px-8">
          <div className="flex items-center gap-2">
            <Newspaper className="h-5 w-5 shrink-0 text-slate-700" />
            <h2 className="font-serif text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Presseschau</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              disabled={isAeltest}
              className="mc-btn-ghost !px-2 !py-1"
              title="Älterer Eintrag"
              aria-label="Älterer Eintrag"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[7rem] text-center text-xs font-medium text-slate-500">
              {formatDate(current.datum)}
              {isNeuest && ' · neueste'}
            </span>
            <button
              type="button"
              onClick={onNext}
              disabled={isNeuest}
              className="mc-btn-ghost !px-2 !py-1"
              title="Neuerer Eintrag"
              aria-label="Neuerer Eintrag"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Schließen"
              title="Schließen"
              className="mc-btn-ghost !ml-1 !p-2"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">
          <header className="mb-4 border-b border-slate-300 pb-3">
            <h3 className="font-serif text-2xl font-bold leading-snug text-slate-900 sm:text-3xl">
              {current.titel ?? `Presseschau vom ${formatDate(current.datum)}`}
            </h3>
            <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
              {formatDate(current.datum)}
              {current.quelle && ` · ${current.quelle}`}
            </p>
          </header>
          <div className="mc-presseschau-content font-serif text-sm leading-relaxed text-slate-800 sm:text-[15px] sm:columns-2 sm:gap-8">
            <ReactMarkdown>{current.inhalt}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  )
}
