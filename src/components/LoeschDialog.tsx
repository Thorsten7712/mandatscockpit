import { useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

/**
 * Gemeinsamer Bestätigungsdialog für alle Löschaktionen (Nutzerwunsch: eine
 * einheitliche Rückfrage überall statt window.confirm an der einen und einem
 * Inline-„Sicher?" an der nächsten Stelle).
 *
 * Zwei Ausprägungen, gesteuert allein über `folgen`:
 *
 * - **Betrifft nur mich** (`folgen` leer/weggelassen): schlichte Rückfrage
 *   „Bist du sicher?". Kein Grund, jemanden mit Warnfarben zu behelligen, wenn
 *   nur der eigene Bestand betroffen ist.
 * - **Geteilt** (`folgen` gefüllt): rot abgesetzter Kasten, der die Folgen
 *   benennt (wer es verliert, was mitgelöscht wird), plus eine Checkbox, die
 *   den Löschknopf freigibt. Ein irreversibler Eingriff in fremde Bestände
 *   soll nicht mit einem Reflexklick passieren können.
 *
 * Liegt bewusst als `fixed`-Overlay über allem (z-60): die Aufrufer sitzen
 * teils in scrollenden Modal-Spalten (DetailModalShell), in denen ein absolut
 * positionierter Dialog abgeschnitten würde.
 */
export function LoeschDialog({
  titel,
  was = 'Der Eintrag',
  folgen,
  hinweis,
  bestaetigungsText,
  aktionLabel,
  bestaetigt,
  onBestaetigtChange,
  loeschend = false,
  fehler,
  onAbbrechen,
  onLoeschen,
}: {
  /** Name des betroffenen Objekts, wird in Anführungszeichen angezeigt. */
  titel: string
  /** Gattung für den Standardsatz, z. B. „Das Dokument", „Die Karte". */
  was?: string
  /** Folgen für andere. Leer/weggelassen = betrifft nur mich. */
  folgen?: string[]
  /** Zusatz für die schlichte Variante, z. B. was noch mit verschwindet. */
  hinweis?: string
  bestaetigungsText?: string
  /** Überschreibt die Beschriftung des Bestätigungsknopfes. */
  aktionLabel?: string
  bestaetigt: boolean
  onBestaetigtChange: (wert: boolean) => void
  loeschend?: boolean
  fehler?: string | null
  onAbbrechen: () => void
  onLoeschen: () => void
}) {
  const geteilt = (folgen?.length ?? 0) > 0

  return (
    <div
      className="mc-animate-fade fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onAbbrechen}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="mc-animate-pop w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
            <AlertTriangle size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900">{geteilt ? 'Wirklich für alle löschen?' : 'Bist du sicher?'}</h2>
            <p className="mt-0.5 break-words text-sm text-slate-500">„{titel}"</p>
          </div>
        </div>

        {geteilt ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p className="font-semibold">Das betrifft nicht nur dich.</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {folgen!.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <label className="mt-3 flex items-start gap-2 font-medium">
              <input
                type="checkbox"
                checked={bestaetigt}
                onChange={(e) => onBestaetigtChange(e.target.checked)}
                className="mt-0.5"
              />
              {bestaetigungsText ?? 'Ja, ich möchte das für alle löschen.'}
            </label>
          </div>
        ) : (
          <p className="mb-4 text-sm text-slate-600">
            {was} wird endgültig gelöscht.{hinweis ? ` ${hinweis}` : ''}
          </p>
        )}

        {fehler && <p className="mb-3 text-sm text-red-600">{fehler}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onAbbrechen} className="mc-btn-ghost">
            Abbrechen
          </button>
          <button
            type="button"
            onClick={onLoeschen}
            disabled={loeschend || (geteilt && !bestaetigt)}
            className="mc-btn-danger"
          >
            {loeschend ? 'Lösche...' : aktionLabel ?? (geteilt ? 'Für alle löschen' : 'Löschen')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Was gelöscht werden soll - alles, was der Dialog dafür wissen muss. */
export interface LoeschAnfrage {
  titel: string
  was?: string
  /** Folgen für andere. Leer/weggelassen = betrifft nur mich -> schlichte Rückfrage. */
  folgen?: string[]
  hinweis?: string
  bestaetigungsText?: string
  aktionLabel?: string
  ausfuehren: () => Promise<void> | void
}

/**
 * Hält Rückfrage-Zustand und Dialog zusammen, damit eine Komponente mit
 * mehreren Löschzielen (Karte, Kommentar, Dokument ...) nicht je Ziel eigene
 * States braucht: `fragen({...})` am Knopf, `dialog` einmal ins JSX.
 */
export function useLoeschDialog(): { fragen: (anfrage: LoeschAnfrage) => void; dialog: ReactNode } {
  const [anfrage, setAnfrage] = useState<LoeschAnfrage | null>(null)
  const [bestaetigt, setBestaetigt] = useState(false)
  const [loeschend, setLoeschend] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  function fragen(neu: LoeschAnfrage) {
    setBestaetigt(false)
    setFehler(null)
    setLoeschend(false)
    setAnfrage(neu)
  }

  async function ausfuehren() {
    if (!anfrage) return
    setLoeschend(true)
    setFehler(null)
    try {
      await anfrage.ausfuehren()
      setAnfrage(null)
    } catch (e) {
      // Der Dialog bleibt offen und zeigt den Fehler - sonst sähe ein
      // fehlgeschlagener Löschversuch aus wie ein erfolgreicher.
      setFehler(e instanceof Error ? e.message : 'Löschen fehlgeschlagen.')
    } finally {
      setLoeschend(false)
    }
  }

  const dialog = anfrage ? (
    <LoeschDialog
      titel={anfrage.titel}
      was={anfrage.was}
      folgen={anfrage.folgen}
      hinweis={anfrage.hinweis}
      bestaetigungsText={anfrage.bestaetigungsText}
      aktionLabel={anfrage.aktionLabel}
      bestaetigt={bestaetigt}
      onBestaetigtChange={setBestaetigt}
      loeschend={loeschend}
      fehler={fehler}
      onAbbrechen={() => setAnfrage(null)}
      onLoeschen={ausfuehren}
    />
  ) : null

  return { fragen, dialog }
}
