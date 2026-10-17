import { useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink, Gavel } from 'lucide-react'
import { vorlageAufbereiten } from '../lib/vorlageMarkdown'

/**
 * Leseansicht eines Dokuments im Dokumenten-Hub: die von dailyallris erzeugte
 * Markdown-Fassung einer ALLRIS-Vorlage, aufbereitet für langes Lesen.
 *
 * Drei Eingriffe gegenüber dem rohen Markdown (Begründung in
 * src/lib/vorlageMarkdown.ts):
 *  - Die Kopfdaten-Aufzählung entfällt, weil das Metadatenband im Modal
 *    dieselben Angaben besser zeigt.
 *  - Der Beschlussvorschlag steht als eigener Kasten ganz oben statt
 *    eingeklemmt zwischen zwei Formularblöcken - er ist der Satz, über den
 *    abgestimmt wird.
 *  - Die beim PDF-Auszug zerfallenen Formularblöcke behalten ihre Ausrichtung.
 *
 * Dokumente ohne Markdown-Struktur (Alt-Bestand, von Hand angelegte Notizen)
 * fallen auf einfache Textdarstellung zurück.
 */
export function VorlageAnsicht({ inhalt, zentriert = false }: { inhalt: string | null; zentriert?: boolean }) {
  const { koerper, beschlussvorschlag, abschnitte } = useMemo(() => vorlageAufbereiten(inhalt), [inhalt])
  const [aktiv, setAktiv] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  if (!inhalt || !inhalt.trim()) {
    return (
      <p className="px-5 py-8 text-center text-sm text-slate-400">
        Für dieses Dokument liegt noch kein Text vor. Das Original-PDF lässt sich über die Kopfleiste öffnen.
      </p>
    )
  }

  function springeZu(id: string) {
    const ziel = scrollRef.current?.querySelector(`#${id}`)
    if (ziel) {
      ziel.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setAktiv(id)
    }
  }

  // Laufende Nummer, damit Überschrift und Sprungziel dieselbe Id bekommen -
  // die Überschriftentexte selbst wären als Anker unzuverlässig (Umlaute,
  // Schrägstriche, Wiederholungen wie "Anlage/n").
  let ueberschriftIndex = 0

  return (
    <div ref={scrollRef} className="flex h-full min-h-0 flex-col">
      {abschnitte.length > 0 && (
        <nav
          aria-label="Abschnitte"
          className="sticky top-0 z-10 flex shrink-0 gap-1.5 overflow-x-auto border-b border-slate-100 bg-white/95 px-5 py-2 backdrop-blur-sm"
        >
          {beschlussvorschlag && (
            <button
              type="button"
              onClick={() => springeZu('beschlussvorschlag')}
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                aktiv === 'beschlussvorschlag'
                  ? 'border-primary bg-primary text-white'
                  : 'border-slate-200 text-slate-600 hover:border-primary/40 hover:text-slate-900'
              }`}
            >
              Beschlussvorschlag
            </button>
          )}
          {abschnitte.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => springeZu(a.id)}
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                aktiv === a.id
                  ? 'border-primary bg-primary text-white'
                  : 'border-slate-200 text-slate-600 hover:border-primary/40 hover:text-slate-900'
              }`}
            >
              {a.titel}
            </button>
          ))}
        </nav>
      )}

      <div className={`min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-4 ${zentriert ? 'mx-auto w-full max-w-[68ch]' : ''}`}>
        {beschlussvorschlag && (
          <section
            id="beschlussvorschlag"
            className="mb-5 rounded-xl border border-accent/45 bg-accent/10 p-3.5 scroll-mt-14"
          >
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-primary">
              <Gavel size={13} />
              Beschlussvorschlag
            </h3>
            <div className="mc-dokument-content text-[15px] font-medium leading-relaxed text-slate-900">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{beschlussvorschlag}</ReactMarkdown>
            </div>
          </section>
        )}

        <div className="mc-dokument-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h2: ({ children }) => {
                const id = `abschnitt-${ueberschriftIndex++}`
                return <h2 id={id} className="scroll-mt-14">{children}</h2>
              },
              // Tabellen dürfen breiter sein als die Spalte, aber nur in ihrem
              // eigenen Scrollbereich - sonst schiebt die Beratungsfolge das
              // ganze Modal auseinander.
              table: ({ children }) => (
                <div className="mc-tabellenrahmen">
                  <table>{children}</table>
                </div>
              ),
              // Bis es Dokument-Anhänge gibt, kann keine Bildquelle aufgelöst
              // werden: der Storage-Bucket ist privat und Signed URLs hängen an
              // einer dokumente-Zeile. Fremde URLs werden bewusst NICHT geladen
              // - das würde beim Öffnen einer Vorlage IP und Zeitpunkt jedes
              // lesenden Mitglieds an einen fremden Server melden.
              img: ({ src, alt }) => (
                <a
                  href={typeof src === 'string' ? src : '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary underline"
                >
                  <ExternalLink size={13} />
                  {alt || 'Bild'} (extern, wird nicht geladen)
                </a>
              ),
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {koerper}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
