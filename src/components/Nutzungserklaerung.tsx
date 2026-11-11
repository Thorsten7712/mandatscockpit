import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useSpeicherHinweisAusblenden } from '../lib/speicherHinweis'

/**
 * Fassung der Nutzungserklärung. Bei einer inhaltlichen Änderung des Textes
 * unten hochzählen: Alle Konten, die eine ältere Fassung bestätigt haben,
 * werden beim nächsten Aufruf erneut gefragt (ProtectedRoute vergleicht mit
 * profiles.nutzungserklaerung_version, siehe 0064).
 */
export const NUTZUNGSERKLAERUNG_VERSION = 1

/** Der Text selbst - auch öffentlich unter /nutzungserklaerung lesbar. */
export function NutzungserklaerungText() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-slate-700">
      <p>
        Das MandatsCockpit ist ein privat betriebenes Arbeitswerkzeug für Mandatsträger*innen. Was du hier
        einstellst, kann – je nach Freigabe – für andere Mitglieder deiner Partei und Ebene sichtbar sein.
        Deshalb gilt für alle Nutzer*innen:
      </p>
      <ol className="list-decimal space-y-3 pl-5">
        <li>
          <strong className="text-slate-900">Keine nichtöffentlichen Unterlagen.</strong> Ich stelle keine
          Unterlagen oder Informationen aus nichtöffentlichen Sitzungen ein – weder als Notiz, Aufgabe oder
          Dokument noch über eine angebundene KI (MCP). Dazu gehören insbesondere nichtöffentliche Vorlagen,
          Niederschriften und Tischvorlagen, Unterlagen aus Aufsichts- und Verwaltungsräten sowie alles, was
          der Verschwiegenheitspflicht nach § 30 GO NRW (für Ratsmitglieder in Verbindung mit § 43 GO NRW)
          oder vergleichbaren Vorschriften unterliegt.
        </li>
        <li>
          <strong className="text-slate-900">Sparsam mit Daten Dritter.</strong> Personenbezogene Daten
          anderer Menschen (zum Beispiel aus Bürgeranfragen) stelle ich nur ein, soweit ich sie für meine
          Mandatsarbeit brauche, und keine besonders schutzwürdigen Angaben wie Gesundheitsdaten.
        </li>
        <li>
          <strong className="text-slate-900">Eigene Verantwortung.</strong> Für die Inhalte, die ich selbst
          oder über meine KI einstelle, bin ich verantwortlich. Bevor ich etwas mit anderen teile, prüfe ich,
          ob es für sie bestimmt ist.
        </li>
        <li>
          <strong className="text-slate-900">Zugänge schützen.</strong> Mein Passwort und meine persönliche
          MCP-Zugangs-URL gebe ich nicht weiter. Wird eines davon bekannt, ändere ich das Passwort bzw. erzeuge
          eine neue URL und melde es dem Betreiber.
        </li>
        <li>
          <strong className="text-slate-900">Folgen bei Verstößen.</strong> Der Betreiber darf Inhalte, die
          gegen diese Erklärung verstoßen, entfernen und Zugänge sperren.
        </li>
      </ol>
      <p className="text-xs text-slate-500">
        Wie das MandatsCockpit mit deinen Daten umgeht, steht in der{' '}
        <Link to="/datenschutz" target="_blank" className="text-primary underline">
          Datenschutzerklärung
        </Link>
        .
      </p>
    </div>
  )
}

/**
 * Blockiert die App beim ersten Login und nach jeder neuen Fassung, bis die
 * Erklärung bestätigt ist (siehe ProtectedRoute.tsx). Wie bei
 * ForcedPasswordChange gibt es kein "Überspringen", nur "Abmelden".
 */
export function NutzungserklaerungBestaetigen({ userId, erneut, onDone }: { userId: string; erneut: boolean; onDone: () => void }) {
  useSpeicherHinweisAusblenden()
  const [gelesen, setGelesen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function bestaetigen() {
    setSaving(true)
    setError(null)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ nutzungserklaerung_version: NUTZUNGSERKLAERUNG_VERSION, nutzungserklaerung_am: new Date().toISOString() })
      .eq('id', userId)
    if (updateError) {
      setError(updateError.message)
      setSaving(false)
      return
    }
    onDone()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="nutzungserklaerung-titel"
        className="mc-animate-pop flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-6 pb-4 pt-6 sm:px-8">
          <h1 id="nutzungserklaerung-titel" className="mc-page-title text-2xl">
            Nutzungserklärung
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {erneut
              ? 'Die Nutzungserklärung wurde geändert. Bitte lies sie und bestätige sie erneut.'
              : 'Bevor du das MandatsCockpit zum ersten Mal nutzt, lies bitte diese Erklärung und bestätige sie.'}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 sm:px-8">
          <NutzungserklaerungText />
        </div>
        <div className="space-y-3 border-t border-slate-100 px-6 pb-6 pt-4 sm:px-8">
          <label className="flex items-start gap-3 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={gelesen}
              onChange={(e) => setGelesen(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span>
              Ich habe die Nutzungserklärung gelesen und halte mich daran. Insbesondere stelle ich keine
              nichtöffentlichen Unterlagen ein.
            </span>
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => supabase.auth.signOut()} className="mc-btn-ghost text-sm">
              Abmelden
            </button>
            <button
              type="button"
              disabled={!gelesen || saving}
              onClick={bestaetigen}
              className="mc-btn-primary py-2.5! disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Speichern...' : 'Bestätigen und weiter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
