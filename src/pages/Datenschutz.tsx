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
                <strong>Profil:</strong> Name, optional Profilfoto, Partei/Fraktion, die von dir selbst
                gepflegten Mandats-Ebenen (Kommune/Kreis/Land/Bund inkl. konkreter Bezeichnung) und deine
                Gremien sowie Zeitpunkt und Fassung deiner Bestätigung der 
                <Link to="/nutzungserklaerung" className="text-primary underline">
                  Nutzungserklärung
                </Link>
                .
              </li>
              <li>
                <strong>Nutzungsdaten:</strong> von dir angelegte Aufgaben, eigene Termine und Notizen, dein
                Lesestand bei Dokumenten, deine Kalenderquellen (eine persönliche Kalender-Adresse sieht nur
                du) und ein Kennwert deiner persönlichen MCP-Zugangs-URL (nur als Hash). Aufgaben und Notizen
                sind privat, bis du sie aktiv teilst oder einer Person zuweist.
              </li>
              <li>
                <strong>Gemeinsame Inhalte:</strong> Sitzungsvorlagen und andere Dokumente im Dokumenten-Hub
                sowie „Zahlen &amp; Fakten“ sind für die Mitglieder derselben Partei und Ebene sichtbar. Sie
                stammen aus öffentlich zugänglichen Ratsinformationssystemen oder werden von Mitgliedern
                eingestellt.
              </li>
              <li>
                <strong>Kalenderdaten:</strong> Sitzungstermine, die aus öffentlichen Kalenderquellen
                (ICS-Feeds) der Ratsinformationssysteme und aus deinen eigenen Kalenderquellen importiert werden.
              </li>
              <li>
                <strong>Kontaktformular:</strong> Name, E-Mail-Adresse und Nachrichtentext, wenn du das
                Kontaktformular auf der Impressum-Seite nutzt.
              </li>
            </ul>
            <p className="mt-2">
              Dateien laden Nutzer*innen nicht hoch – mit Ausnahme des eigenen Profilfotos.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">4. Rechtsgrundlage</h2>
            <p>
              Die Verarbeitung erfolgt zur Bereitstellung des Cockpits im Rahmen des Nutzungsverhältnisses
              (Art. 6 Abs. 1 lit. b DSGVO) bzw. auf Grundlage eines berechtigten Interesses am sicheren
              technischen Betrieb (Art. 6 Abs. 1 lit. f DSGVO), etwa beim Löschprotokoll und bei
              Sicherungskopien. Anfragen über das Kontaktformular werden auf Grundlage des berechtigten
              Interesses an ihrer Beantwortung verarbeitet (Art. 6 Abs. 1 lit. f DSGVO).
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">5. Hosting und Auftragsverarbeiter</h2>
            <p>
              Das Frontend wird statisch über GitHub Pages ausgeliefert (GitHub Inc., USA); dabei verarbeitet
              GitHub technisch bedingt Zugriffsdaten wie die IP-Adresse. Die Datenbank, die Anmeldung und die
              Datei-Speicherung laufen über Supabase (Supabase Inc.) in einem Rechenzentrum in der EU
              (Frankfurt). Soweit dabei Daten in die USA gelangen können, stützt sich die Übermittlung auf das
              EU-US Data Privacy Framework bzw. auf die EU-Standardvertragsklauseln der Anbieter. Schriften
              und alle übrigen Bestandteile der Seite werden vom Cockpit selbst ausgeliefert; es werden keine
              Dienste Dritter (etwa Google Fonts, Karten oder Videos) eingebunden.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">6. Eigene KI über die MCP-Schnittstelle</h2>
            <p>
              Das Cockpit selbst nutzt keine KI. Du kannst aber über deine persönliche MCP-Zugangs-URL einen
              KI-Assistenten deiner Wahl anbinden. Inhalte, die dein Assistent dabei abruft, werden an dessen
              Anbieter übermittelt. Das geschieht in deiner Verantwortung und nach den Bedingungen deines
              Anbieters; der Betreiber des Cockpits hat darauf keinen Einfluss. Die URL kannst du in den
              Einstellungen jederzeit neu erzeugen, die alte wird damit ungültig.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">7. Speicherdauer</h2>
            <p>
              Deine Daten werden gespeichert, solange dein Nutzerkonto besteht. Bei Löschung eines Kontos
              durch den Administrator werden Profil, eigene Inhalte und Profilfoto entfernt. Gelöschte Einträge
              hält ein nur für den Betreiber einsehbares Löschprotokoll 90 Tage lang fest, damit sich
              versehentliche Löschungen nachvollziehen und rückgängig machen lassen; danach werden sie
              automatisch endgültig entfernt. Verschlüsselte Sicherungskopien der
              Datenbank werden nach 14 Tagen automatisch gelöscht.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">8. Cookies und Speicherung im Browser</h2>
            <p>
              Es werden keine Tracking-, Analyse- oder Werbe-Cookies eingesetzt. Im Speicher deines Browsers
              (localStorage) legt das Cockpit nur ab, was für den Dienst nötig ist oder was du selbst
              einstellst:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>das Anmelde-Token, damit du angemeldet bleibst (Supabase Auth),</li>
              <li>
                Anzeige-Einstellungen auf diesem Gerät: eingeklappte Seitenleiste, Zahl der Einträge pro
                Seite im Dokumenten-Hub, gewähltes Leselayout,
              </li>
              <li>dass du den Hinweis zur Speicherung im Browser gesehen hast.</li>
            </ul>
            <p className="mt-2">
              Diese Speicherung ist für den von dir gewünschten Dienst unbedingt erforderlich und deshalb
              ohne Einwilligung zulässig (§ 25 Abs. 2 Nr. 2 TDDDG). Du kannst sie jederzeit über die
              Einstellungen deines Browsers löschen; danach musst du dich neu anmelden.
            </p>
          </section>

          <section>
            <h2 className="mb-1 text-base font-semibold text-slate-900">9. Deine Rechte</h2>
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
