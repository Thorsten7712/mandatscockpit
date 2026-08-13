import { useEffect, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Newspaper } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type { PresseschauRow } from '../lib/types'
import { formatDate } from '../lib/format'
import { PresseschauReaderModal } from './PresseschauReaderModal'

/** Wandelt die Markdown-Presseschau in einen kurzen Anreißer-Text für die
 *  kompakte Karte auf dem Dashboard um. Bevorzugt den Inhalt eines
 *  "## Kernaussage"-Abschnitts (bereits eine von der KI geschriebene
 *  Zusammenfassung, siehe docs/-Beispielvorlage) - fällt sonst auf die
 *  ersten Zeichen des Volltexts zurück. */
function extractTeaser(inhalt: string, maxLen = 220): string {
  const kernaussage = inhalt.match(/##\s*Kernaussage\s*\n+([\s\S]*?)(?=\n##|\n---|$)/i)
  const quelle = kernaussage ? kernaussage[1] : inhalt
  const plain = quelle
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length <= maxLen ? plain : `${plain.slice(0, maxLen).trimEnd()}…`
}

/** Kompakte, klickbare "Presseschau"-Karte auf dem Dashboard - zeigt nur
 * Überschrift + Kurz-Anreißer, damit ToDo-Board/Termine/Dokumente ohne
 * Scrollen sichtbar bleiben (Nutzer-Feedback: der vorherige, vollständig
 * ausgeschriebene Zeitungsabschnitt hat den Rest des Dashboards zu weit nach
 * unten gedrückt). Der volle Lesekomfort (Zeitungslayout, Tage-Navigation)
 * lebt jetzt in PresseschauReaderModal, das beim Klick auf die Karte als
 * fokussierter Reader über dem Dashboard erscheint. Nur sichtbar, wenn
 * profiles.presseschau_aktiv gesetzt ist (siehe Settings.tsx).
 */
export function PresseschauSection() {
  // Nur (id, datum) initial laden - der eigentliche Text kommt erst je
  // ausgewähltem Eintrag nach, damit ein wachsender Bestand an Presseschauen
  // nicht komplett in den Speicher geladen wird.
  const [dates, setDates] = useState<{ id: string; datum: string }[]>([])
  const [index, setIndex] = useState(0)
  const [current, setCurrent] = useState<PresseschauRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [readerOpen, setReaderOpen] = useState(false)

  useEffect(() => {
    supabase
      .from('presseschauen')
      .select('id, datum')
      .order('datum', { ascending: false })
      .then(({ data }) => {
        setDates(data ?? [])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    const entry = dates[index]
    if (!entry) {
      setCurrent(null)
      return
    }
    supabase
      .from('presseschauen')
      .select('*')
      .eq('id', entry.id)
      .single()
      .then(({ data }) => setCurrent(data ?? null))
  }, [dates, index])

  if (loading) return null
  if (dates.length === 0 || !current) return null

  const isNeuest = index === 0
  const isAeltest = index === dates.length - 1

  function openReader() {
    setReaderOpen(true)
  }

  return (
    <section className="mb-8">
      <div
        role="button"
        tabIndex={0}
        onClick={openReader}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openReader()
          }
        }}
        className="group cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-[#fbf9f4] to-[#f4f1ea] shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.995]"
      >
        <div className="flex items-center justify-between gap-3 border-b-4 border-double border-slate-800 px-5 pb-2.5 pt-3.5 sm:px-6">
          <div className="flex items-center gap-2">
            <Newspaper className="h-4 w-4 shrink-0 text-slate-700" />
            <h2 className="font-serif text-lg font-bold tracking-tight text-slate-900">Presseschau</h2>
          </div>
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setIndex((i) => Math.min(i + 1, dates.length - 1))}
              disabled={isAeltest}
              className="mc-btn-ghost !px-1.5 !py-1"
              title="Älterer Eintrag"
              aria-label="Älterer Eintrag"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[6rem] text-center text-xs font-medium text-slate-500">
              {formatDate(current.datum)}
              {isNeuest && ' · neueste'}
            </span>
            <button
              type="button"
              onClick={() => setIndex((i) => Math.max(i - 1, 0))}
              disabled={isNeuest}
              className="mc-btn-ghost !px-1.5 !py-1"
              title="Neuerer Eintrag"
              aria-label="Neuerer Eintrag"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-serif text-base font-semibold text-slate-900 sm:text-lg">
              {current.titel ?? `Presseschau vom ${formatDate(current.datum)}`}
            </h3>
            <p className="mt-1 line-clamp-2 text-sm leading-snug text-slate-600">{extractTeaser(current.inhalt)}</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-full bg-slate-900/5 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors group-hover:bg-primary group-hover:text-white sm:self-center">
            Ganz lesen
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>

      {readerOpen && (
        <PresseschauReaderModal
          current={current}
          isNeuest={isNeuest}
          isAeltest={isAeltest}
          onPrev={() => setIndex((i) => Math.min(i + 1, dates.length - 1))}
          onNext={() => setIndex((i) => Math.max(i - 1, 0))}
          onClose={() => setReaderOpen(false)}
        />
      )}
    </section>
  )
}
