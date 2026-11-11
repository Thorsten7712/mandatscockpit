import { useState, useSyncExternalStore } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { speicherHinweisAbonnieren, speicherHinweisUnterdrueckt } from '../lib/speicherHinweis'

const SCHLUESSEL = 'mc.hinweis.speicher'

function schonGesehen(): boolean {
  try {
    return localStorage.getItem(SCHLUESSEL) !== null
  } catch {
    return false
  }
}

/**
 * Hinweis statt Einwilligungsbanner: Das Cockpit speichert im Browser nur,
 * was technisch nötig ist (Anmeldung) oder ausdrücklich gewünscht
 * (Anzeige-Vorlieben) - das ist nach § 25 Abs. 2 Nr. 2 TDDDG ohne Einwilligung
 * zulässig. Es gibt keine Tracking-, Analyse- oder Werbe-Cookies und keine
 * eingebundenen Dienste Dritter. Ein "Ablehnen"-Knopf wäre deshalb irreführend:
 * es gibt nichts abzulehnen. Sollte je etwas Einwilligungspflichtiges dazukommen
 * (Statistik, eingebettete Karten, Videos), muss hier ein echtes Opt-in hin.
 *
 * Dass der Hinweis gesehen wurde, steht selbst im localStorage (pro Gerät,
 * reine Anzeige-Vorliebe). Klappt das nicht, erscheint er eben erneut.
 */
export function SpeicherHinweis() {
  const [sichtbar, setSichtbar] = useState(() => !schonGesehen())
  const { pathname } = useLocation()
  const ausgeblendet = useSyncExternalStore(speicherHinweisAbonnieren, speicherHinweisUnterdrueckt)

  // Im Sitzungsmodus nicht über die Vorlage legen; dort war man ohnehin schon.
  if (!sichtbar || ausgeblendet || pathname.endsWith('/modus')) return null

  function verstanden() {
    try {
      localStorage.setItem(SCHLUESSEL, new Date().toISOString())
    } catch {
      // Speichern nicht möglich (privates Fenster) - Hinweis gilt für diese Sitzung als gesehen.
    }
    setSichtbar(false)
  }

  return (
    <div
      role="region"
      aria-label="Hinweis zur Speicherung im Browser"
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-[45] mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-4 shadow-lg md:bottom-5 md:left-auto md:right-5 md:mx-0 md:w-[26rem]"
    >
      <p className="text-sm leading-relaxed text-slate-700">
        <strong className="font-semibold text-slate-900">Keine Tracking-Cookies.</strong> Das MandatsCockpit
        speichert in deinem Browser nur, was es zum Funktionieren braucht: deine Anmeldung und ein paar
        Anzeige-Einstellungen. Nichts davon geht an Dritte.
      </p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <Link to="/datenschutz" className="text-xs text-primary underline">
          Mehr in der Datenschutzerklärung
        </Link>
        <button type="button" onClick={verstanden} className="mc-btn-primary px-4! py-1.5! text-sm">
          Verstanden
        </button>
      </div>
    </div>
  )
}
