import { useEffect, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
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

/** "Presseschau" auf der Startseite: Überschrift + Kurz-Anreißer, damit der
 * Rest von "Heute" ohne Scrollen sichtbar bleibt. Der volle Lesekomfort
 * (Zeitungslayout, Tage-Navigation) lebt in PresseschauReaderModal, das der
 * Knopf "Presseschau lesen" öffnet. Nur sichtbar, wenn
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

  // Band zwischen Begrüßung und den Spalten (Richtung A, 08.11.2026): links
  // Titel und Ausgabe mit Blättern, Mitte Überschrift und Kernaussage, rechts
  // ein eigener Knopf – kein ganzer Block als Link mehr.
  return (
    <section
      aria-label="Presseschau"
      className="grid grid-cols-1 items-center gap-x-7 gap-y-3 rounded-[14px] border border-slate-200 bg-white px-5 py-4 lg:grid-cols-[210px_minmax(0,1fr)_auto] lg:px-6"
    >
      <div className="flex items-center justify-between gap-2 border-slate-200 lg:flex-col lg:items-start lg:border-r lg:pr-6">
        <h2 className="font-display text-2xl font-semibold tracking-[-0.01em]">Presseschau</h2>
        <div className="flex items-center gap-1 text-[13px] text-slate-600">
          <button
            type="button"
            onClick={() => setIndex((i) => Math.min(i + 1, dates.length - 1))}
            disabled={isAeltest}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100 disabled:opacity-40"
            aria-label="Ältere Ausgabe"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="whitespace-nowrap text-center font-mono" title={isNeuest ? 'Neueste Ausgabe' : undefined}>
            {formatDate(current.datum)}
          </span>
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(i - 1, 0))}
            disabled={isNeuest}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100 disabled:opacity-40"
            aria-label="Neuere Ausgabe"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        {current.titel && <h3 className="truncate font-display text-lg leading-snug font-semibold">{current.titel}</h3>}
        <p className="line-clamp-2 font-display text-[17px] leading-snug text-slate-700">{extractTeaser(current.inhalt)}</p>
      </div>
      <button
        type="button"
        onClick={openReader}
        className="inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded-full border border-primary px-4.5 text-sm font-semibold text-primary transition-colors duration-150 hover:bg-primary hover:text-white active:scale-[0.98] lg:justify-self-end"
      >
        Presseschau lesen
        <ArrowRight className="h-4 w-4" />
      </button>

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
