import { Link } from 'react-router-dom'

/**
 * Öffentlich (ohne Login) erreichbare Datenschutzerklärung - Pflicht nach
 * Art. 13 DSGVO. Beschreibt die tatsächliche Datenverarbeitung im Cockpit
 * (siehe supabase/migrations/ für das zugrundeliegende Datenmodell). Route
 * liegt bewusst außerhalb von ProtectedRoute (siehe App.tsx).
 */
export default function Datenschutz() {
  return (
    <div className="min-h-screen bg-slate-100">
      <div className="h-1.5 bg-topbar" aria-hidden="true" />
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link to="/login" className="mb-6 inline-block text-sm font-medium text-primary underline">
          ← Zurück zum Login
        </Link>
        <h1 className="mb-6 text-2xl font-bold text-slate-900">Datenschutzerklärung</h1>

        <div className="mc-card space-y-6 p-6 text-sm leading-relaxed text-slate-700">
          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">1. Verantwortlicher</h2>
            <p>
              Thorsten Kois, Auf der Burg 7, 58638 Iserlohn
              <br />
              E-Mail:{' '}
              <a href="mailto:tk.aireply@gmail.com" className="text-primary underline">
                tk.aireply@gmail.com
              </a>
              , Telefon: +49 151 17435467
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">2. Zweck und Nutzerkreis</h2>
            <p>
              MandatsCockpit ist ein Dashboard für die persönliche Mandatsarbeit von Mitgliedern kommunaler
              und anderer Vertretungen. Zugänge werden ausschließlich durch einen Administrator angelegt
              (keine offene Registrierung); es nutzen ausschließlich vom Administrator eingeladene
              Mandatsträger*innen das System.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">3. Welche Daten werden verarbeitet</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Konto/Login:</strong> E-Mail-Adresse und Passwort (als Hash gespeichert), verwaltet über
                Supabase Auth.
              </li>
              <li>
                <strong>Profil:</strong> Name, optional Profilfoto, Partei/Fraktion sowie die von dir selbst
                gepflegten Mandats-Ebenen (Kommune/Kreis/Land/Bund inkl. konkreter Bezeichnung).
              </li>
              <li>
                <strong>Nutzungsdaten:</strong> von dir angelegte ToDos, eigene Termine, Notizen, Kommentare und
                Anträge. Diese Daten sind standardmäßig privat (nur für dich selbst sichtbar) und werden nur
                dann mit Kolleg*innen geteilt, wenn du das über die "Teilen"-Funktion aktiv einrichtest.
              </li>
              <li>
                <strong>Hochgeladene Dokumente:</strong> Dateien, die du an Sitzungen, Terminen, ToDos oder
                Anträgen hochlädst, liegen in einem privaten Speicherbereich, auf den nur du zugreifen kannst
                (bzw. Personen, mit denen du den jeweiligen Eintrag geteilt hast).
              </li>
              <li>
                <strong>Kalenderdaten:</strong> öffentlich zugängliche Sitzungstermine, die aus von dir
                abonnierten ICS-Kalenderquellen importiert werden.
              </li>
              <li>
                <strong>Kontaktformular:</strong> Name, E-Mail-Adresse und Nachrichtentext, wenn du das
                Kontaktformular auf der Impressum-Seite nutzt.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">4. Rechtsgrundlage</h2>
            <p>
              Die Verarbeitung erfolgt zur Bereitstellung des Dashboards im Rahmen des Nutzungsverhältnisses
              (Art. 6 Abs. 1 lit. b DSGVO) bzw. auf Grundlage eines berechtigten Interesses am technischen
              Betrieb (Art. 6 Abs. 1 lit. f DSGVO). Die Nutzung des Kontaktformulars erfolgt auf Grundlage
              deiner Einwilligung durch das Absenden (Art. 6 Abs. 1 lit. a DSGVO).
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">5. Hosting und Auftragsverarbeiter</h2>
            <p>
              Das Frontend wird statisch über GitHub Pages ausgeliefert (GitHub Inc./GitHub B.V.); dabei
              können durch GitHub technisch bedingt Zugriffsdaten (u. a. IP-Adresse) verarbeitet werden. Die
              Datenbank, Authentifizierung und Datei-Speicherung laufen über Supabase, gehostet in einem
              Rechenzentrum in der EU (Frankfurt). Mit beiden Anbietern bzw. deren Nutzungsbedingungen ist
              die Auftragsverarbeitung entsprechend geregelt.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">6. Speicherdauer</h2>
            <p>
              Deine Daten werden gespeichert, solange dein Nutzerkonto besteht. Bei Löschung eines Kontos
              durch den Administrator werden Profil, Nutzungsdaten und hochgeladene Dateien vollständig
              entfernt.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">7. Cookies und lokale Speicherung</h2>
            <p>
              Es werden keine Tracking- oder Analyse-Cookies eingesetzt. Zur Aufrechterhaltung deiner
              Anmeldung speichert der Browser ein technisch notwendiges Sitzungs-Token (über Supabase Auth,
              lokal im Browser).
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">8. Deine Rechte</h2>
            <p>
              Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung,
              Datenübertragbarkeit sowie Widerspruch gegen die Verarbeitung deiner Daten. Wende dich dazu an
              die oben genannte Kontaktadresse. Außerdem steht dir ein Beschwerderecht bei einer
              Datenschutz-Aufsichtsbehörde zu.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
