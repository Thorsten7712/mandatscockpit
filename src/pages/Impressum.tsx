import { Link } from 'react-router-dom'
import { KontaktFormular } from '../components/KontaktFormular'

/**
 * Öffentlich (ohne Login) erreichbare Impressum-Seite - Pflicht nach § 5
 * DDG (ehemals TMG), da mehrere Personen (Ratsmitglieder) das Cockpit
 * mitnutzen und es damit über eine rein private/familiäre Nutzung
 * hinausgeht. Route liegt bewusst außerhalb von ProtectedRoute (siehe
 * App.tsx).
 */
export default function Impressum() {
  return (
    <div className="min-h-screen bg-slate-100">
      <div className="h-1.5 bg-topbar" aria-hidden="true" />
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link to="/login" className="mb-6 inline-block text-sm font-medium text-primary underline">
          ← Zurück zum Login
        </Link>
        <h1 className="mb-6 text-2xl font-bold text-slate-900">Impressum</h1>

        <section className="mc-card mb-4 space-y-1 p-5 text-sm text-slate-700">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Angaben gemäß § 5 DDG
          </p>
          <p className="font-medium text-slate-900">Thorsten Kois</p>
          <p>Auf der Burg 7</p>
          <p>58638 Iserlohn</p>
          <p className="pt-2">
            E-Mail:{' '}
            <a href="mailto:tk.aireply@gmail.com" className="text-primary underline">
              tk.aireply@gmail.com
            </a>
          </p>
          <p>Telefon: +49 151 17435467</p>
        </section>

        <section className="mc-card mb-4 space-y-1 p-5 text-sm text-slate-700">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV
          </p>
          <p>Thorsten Kois, Anschrift wie oben</p>
        </section>

        <section className="mc-card mb-4 space-y-1 p-5 text-sm leading-relaxed text-slate-700">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Art des Angebots</p>
          <p>
            Das MandatsCockpit ist ein privat und nicht kommerziell betriebenes Arbeitswerkzeug für
            Mandatsträger*innen. Es ist kein Angebot der Stadt Iserlohn, ihres Rates, einer Partei oder einer
            Fraktion. Parteifarben und -logos dienen nur der Orientierung der jeweiligen Nutzer*innen.
          </p>
        </section>

        <section className="mc-card mb-8 space-y-1 p-5 text-sm leading-relaxed text-slate-700">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Inhalte der Nutzer*innen und Kontaktstelle nach Art. 11 und 12 DSA
          </p>
          <p>
            Für Inhalte, die Nutzer*innen einstellen, sind diese selbst verantwortlich (siehe{' '}
            <Link to="/nutzungserklaerung" className="text-primary underline">
              Nutzungserklärung
            </Link>
            ). Hinweise auf rechtswidrige Inhalte und Anfragen von Behörden bitte an{' '}
            <a href="mailto:tk.aireply@gmail.com" className="text-primary underline">
              tk.aireply@gmail.com
            </a>{' '}
            – sie werden umgehend geprüft. Kommunikation auf Deutsch oder Englisch.
          </p>
        </section>

        <h2 className="mb-3 text-lg font-semibold text-slate-900">Kontakt aufnehmen</h2>
        <KontaktFormular />

        <p className="mt-8 text-xs text-slate-400">
          Siehe auch: <Link to="/datenschutz" className="text-primary underline">Datenschutzerklärung</Link>
          {' · '}
          <Link to="/nutzungserklaerung" className="text-primary underline">Nutzungserklärung</Link>
        </p>
      </div>
    </div>
  )
}
