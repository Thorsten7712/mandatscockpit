import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Newspaper, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type { PresseschauRow } from '../lib/types'
import { formatDate } from '../lib/format'

/** Newspaperartige Übersicht der per MCP-Tool (upload_presseschau) hochgeladenen
 * Presseschauen - nur sichtbar, wenn profiles.presseschau_aktiv gesetzt ist (siehe
 * Settings.tsx, Abschnitt "Presseschau"). Navigation blättert nur zwischen Tagen,
 * für die tatsächlich ein Eintrag existiert (nicht zwischen Kalendertagen), da
 * Presseschauen unregelmäßig hochgeladen werden.
 */
export function PresseschauSection() {
  // Nur (id, datum) initial laden - der eigentliche Text kommt erst je
  // ausgewähltem Eintrag nach, damit ein wachsender Bestand an Presseschauen
  // nicht komplett in den Speicher geladen wird.
  const [dates, setDates] = useState<{ id: string; datum: string }[]>([])
  const [index, setIndex] = useState(0)
  const [current, setCurrent] = useState<PresseschauRow | null>(null)
  const [loading, setLoading] = useState(true)

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
  if (dates.length === 0) return null

  const isNeuest = index === 0
  const isAeltest = index === dates.length - 1

  return (
    <section className="mb-8">
      <div className="overflow-hidden rounded-xl border border-slate-300 bg-[#fbf9f4] shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b-4 border-double border-slate-800 px-5 pb-3 pt-4 sm:px-8">
          <div className="flex items-center gap-2">
            <Newspaper className="h-5 w-5 shrink-0 text-slate-700" />
            <h2 className="font-serif text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Presseschau</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setIndex((i) => Math.min(i + 1, dates.length - 1))}
              disabled={isAeltest}
              className="mc-btn-ghost !px-2 !py-1"
              title="Älterer Eintrag"
              aria-label="Älterer Eintrag"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[7rem] text-center text-xs font-medium text-slate-500">
              {current ? formatDate(current.datum) : ''}
              {isNeuest && dates.length > 0 && ' · neueste'}
            </span>
            <button
              type="button"
              onClick={() => setIndex((i) => Math.max(i - 1, 0))}
              disabled={isNeuest}
              className="mc-btn-ghost !px-2 !py-1"
              title="Neuerer Eintrag"
              aria-label="Neuerer Eintrag"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {current && (
          <div className="px-5 py-5 sm:px-8 sm:py-6">
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
        )}
      </div>
    </section>
  )
}
