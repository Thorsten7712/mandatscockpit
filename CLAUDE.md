# Projektkontext für Claude Code

Dieses Repo ist der Starter für **MandatsCockpit**, ein Dashboard für Mitglieder des Stadtrats Iserlohn
(und potenziell weiterer Gremien wie Kreistag/Landtag/Bundestag). Die vollständige Konzeption –
Architektur, Begründungen, offene Fragen – steht in [`docs/KONZEPT.md`](./docs/KONZEPT.md). Bitte diese
Datei zuerst lesen, bevor größere Änderungen gemacht werden; sie ist die Quelle der Wahrheit für
Design-Entscheidungen.

Die vollständige, chronologische Entstehungsgeschichte jedes Features (inkl. aller Nutzerwünsche,
Nachbesserungen und Bug-Root-Causes) steht in [`docs/CHANGELOG.md`](./docs/CHANGELOG.md). Dieses
CLAUDE.md hält nur den aktuellen Stand + gelernte Fallstricke knapp fest – im CHANGELOG nachschlagen,
wenn eine bestehende Design-Entscheidung unklar ist, bevor sie geändert wird.

## Kurzfassung der Architektur

- **Frontend:** React + Vite + TypeScript + Tailwind, komplett statisch, gehostet auf GitHub Pages.
- **Backend:** Supabase (Postgres + Auth + Storage, Free-Tier, EU-Region). Kein eigener Server.
- **Keine KI-API-Integration im System.** Mitglieder nutzen ihre eigene (meist kostenlose) KI komplett
  außerhalb des Dashboards und laden nur das fertige Ergebnis als Datei/Text hoch. Das ist eine bewusste
  Entscheidung (siehe KONZEPT.md Abschnitt 5.2) – bitte keine API-Key-Verwaltung oder direkten
  KI-Provider-Calls einbauen, außer das wird explizit gewünscht.
- **Kalender:** kombiniert automatisch importierte Sitzungstermine (aus frei konfigurierbaren ICS-Feeds,
  Tabelle `calendar_sources`) mit frei eingetragenen persönlichen Terminen. Termine können auch vom
  Fraktionsbüro für Mitglieder der eigenen Fraktion angelegt werden (Tabelle `events`, Spalte `herkunft`).
  Jede Quelle hat eine `art`: `sitzung` (Gremien-gefiltert via `user_gremien`) oder `termin` (reiner
  Terminkalender, alle Einträge ungefiltert). Import-Horizont: `MIN_IMPORT_DATUM = 2025-11-11`
  (ältere Feed-Einträge werden nicht importiert, ältere DB-Bestände bleiben unangetastet erhalten).
- **ToDo-Board:** Kanban-Stil mit frei definierbaren Spalten (`todo_columns`) statt fester Status,
  Drag & Drop via `@dnd-kit/core`.
- **Datenmodell & RLS:** vollständig in `supabase/migrations/0001_init.sql`, kommentiert und 1:1 zu
  KONZEPT.md Abschnitt 7. Aktueller Stand über alle ~27 Migrationen: siehe `supabase/migrations/`.

## Aktueller Stand

Kein reines Scaffold mehr, aber noch nicht produktiv für den vollen Nutzerkreis. Vorhanden:

- **Login/Auth**: Supabase Auth, Redirect-Schutz (`ProtectedRoute`), erzwungener Passwortwechsel beim
  ersten Login bzw. nach Admin-Reset (`ForcedPasswordChange`).
- **Dashboard**: optionaler „Presseschau"-Abschnitt (newspaperartige Darstellung hochgeladener
  Presseschauen, Tage-Navigation, nur sichtbar wenn `profiles.presseschau_aktiv` gesetzt ist,
  strikt privat pro Nutzer), ToDo-Board (frei definierbare Spalten, Drag & Drop, Teilen mit Partei-/
  Ebenen-/Gliederungs-Kolleg*innen), „Meine Dokumente" (Anträge + Sitzungs- + ToDo-Dokumente in einer
  Liste, filterbar nach Sitzung), „Nächste Termine" (eigene Termine + importierte Sitzungen
  zusammengeführt, mit Detail-Modal).
- **Settings** (Sidebar-Navigation): Profil (Foto/Name), Kalenderquellen (eigene + gemeinsam
  verwaltete, strikt privat pro Nutzer getrennt), Meine Gremien/Ebenen/Gliederung, ToDo-Board-Struktur,
  Antrags-Fristen, MCP Connection (persönliches Bearer-Token), Benutzerverwaltung + Kontaktanfragen
  (nur `rolle = 'admin'`).
- **Archiv**: vergangene Sitzungen (inkl. manuell nachtragbar, z. B. für Gremien ohne ICS-Feed - nur
  der erstellende Nutzer darf seine eigene nachgetragene Sitzung bearbeiten/löschen), erledigte
  Aufgaben, hochgeladene Dokumente, entschiedene Anträge.
- **Öffentliche Seiten** (außerhalb `ProtectedRoute`): Impressum, Datenschutzerklärung mit
  Kontaktformular (anonymer Insert, Honeypot-Feld).
- **Edge Functions** (`supabase/functions/`, Deno): `import-ics-source` (Einzelquellen-Reimport),
  `admin-users` (Benutzerverwaltung), `mcp-server` (MCP-JSON-RPC-Endpunkt für Claude, 18 Tools über
  ToDos/Termine/Sitzungen/Anträge/Notizen/Presseschau – volle Liste + Details in README.md
  Abschnitt 9 und `docs/CHANGELOG.md`).
- **GitHub-Actions-Workflows**: Deploy nach GitHub Pages (inkl. `404.html`-Kopie fürs SPA-Routing),
  Supabase-Keep-Alive, täglicher ICS-Import (`import-ics.yml`, 04:00 UTC), Edge-Function-Deploy
  (`deploy-edge-functions.yml`, deployt bei jeder Änderung unter `supabase/functions/**` alle
  Functions).

Volle Details zu jedem Punkt (Datenmodell, Komponenten-Props, exakte RLS-Policy-Namen) stehen im Code
selbst bzw., wo die Begründung nicht aus dem Code hervorgeht, in [`docs/CHANGELOG.md`](./docs/CHANGELOG.md).

### Technische Fallstricke & Muster (aus der Historie gelernt)

- **RLS-Rekursion**: Eine Policy, die in ihrer eigenen USING-Klausel dieselbe Tabelle per Subquery
  abfragt (z. B. `profiles`-Policy fragt `profiles` ab), verursacht „infinite recursion detected in
  policy" (Postgres 42P17). Fix: SECURITY DEFINER-Helper-Funktion, die die Tabelle direkt abfragt
  (Beispiele: `current_user_fraktion()`, `antrag_gehoert_nutzer()`). `language sql`-Funktionen werden
  beim `CREATE FUNCTION` sofort gegen das Schema geparst (nicht erst beim Aufruf) – referenzierte
  Tabellen müssen in derselben Migration also **vorher** angelegt sein.
- **Deploy ist zweistufig**: `supabase db push` bringt Migrationen sofort auf die Live-DB, das
  Frontend/die Edge Functions gehen aber erst mit `git push` live (separater Workflow-Trigger). Eine
  fertige DB-Migration ohne Push zeigt sich also noch nicht auf der Produktivseite.
- **Edge Functions**: eigenes `deno.json` pro Funktionsordner nötig für lokales `deno check`
  (Repo-Root-`package.json` bringt sonst Denos Modulauflösung durcheinander). `SUPABASE_URL`/
  `SUPABASE_SERVICE_ROLE_KEY` werden automatisch injiziert. Default `verify_jwt = true` prüft den
  `Authorization`-Header als Supabase-Auth-JWT, bevor die Function läuft – bei eigenem Auth-Schema
  (z. B. `mcp-server`) `verify_jwt = false` in `supabase/config.toml` für genau diese Function setzen.
- **CORS bei browserseitig aufgerufenen Functions**: fehlendes `Access-Control-Allow-Methods` im
  Preflight blockiert den echten Request nur im Browser, nicht bei `curl` – ein funktionierender
  curl-Test beweist also nicht, dass es aus dem Browser heraus geht. Bei Clients, die auf jeden
  Non-200-Status besonders reagieren (z. B. OAuth-Discovery bei jedem 401), immer HTTP 200 mit dem
  Fehler im JSON-Body zurückgeben statt echter HTTP-Fehlercodes.
- **Storage**: private Buckets (`zusammenfassungen`, `profilbilder`), Pfad-Muster
  `<user_id>/<dateiname>`, RLS via `(storage.foldername(name))[1] = auth.uid()::text`. Signed URLs:
  60s für einmalige Downloads, 3600s für dauerhaft sichtbare Inhalte (Fotos, offene Dokumentvorschau).
- **Bewusste Code-Duplikation**: ICS-Parsing, Hash-Helper, `createNote()`-Konfiguration etc. sind
  zwischen Deno (Edge Functions) und Node (Scripts) bzw. zwischen ähnlichen Entitäten (Todo/Antrag)
  bewusst dupliziert – kein gemeinsames Backend/Build-Tooling, das eine Abstraktion rechtfertigen
  würde. Faustregel im Projekt: 2 Vorkommen sind tolerierbar, beim 3. wird in eine gemeinsame Stelle
  extrahiert (Beispiel: `fileNameFromPath`, `DetailModalShell`).
- **Titel-basiertes Spalten-Matching**: Sonderverhalten für ToDo-Spalten wie „Neu"/„Fertig" läuft über
  case-insensitiven Titel-Vergleich, nicht über stabile IDs – bricht, wenn der Nutzer die Spalte
  umbenennt (bewusster Trade-off, da Spalten frei umbenennbar sind).
- **Teilen/Kandidatensuche** (ToDos, Anträge): grobe Vorfilterung per RLS
  (`profiles_select_same_partei_ebene`), exakter Abgleich (Partei + Ebene + Gliederung) läuft
  clientseitig in `loadCandidates()`.
- **Detail-Modals**: gemeinsame Hülle `src/components/DetailModalShell.tsx` (2-Spalten-Layout,
  `headerActions`-Slot) – für neue Entity-Detail-Modals wiederverwenden statt eigenes Chrome zu bauen.
- **Login-Tests**: Passwort-Eingabe im Browser ist tabu (Sicherheitsregel), daher keine echten
  Login-Rundgänge – Verifikation läuft über `tsc -b`/`vite build` + statische Test-Harnesses. Nur
  Seiten ohne Login (Impressum/Datenschutz) lassen sich echt im Browser testen.
- **GitHub Pages SPA-Routing**: Deploy-Workflow kopiert `dist/index.html` nach `dist/404.html`, sonst
  404 bei Reload/Direktaufruf einer Unterroute.
- **ICS-Import**: läuft auf Node 22 (nicht 20, wegen supabase-js Realtime-Client). URLs mit
  `webcal://`/`webcals://` müssen vor dem Fetch auf `https://` normalisiert werden
  (`normalizeIcsUrl()`) – native `fetch` kennt das Schema sonst nicht.

## Geplante nächste Schritte

1. **Echte Nutzer-Zuweisung für ToDo-Zuständigkeit** statt Freitext (`todos.zustaendig`) – laut
   Nutzerentscheidung bewusst für später zurückgestellt. Würde eine neue Spalte (z. B.
   `zustaendig_user_id`) sowie eine RLS-Erweiterung brauchen, damit die zugewiesene Person die Karte
   auch sieht/bearbeiten kann – das ToDo-Board ist aktuell komplett privat (`todos_manage_own`).
2. **Fraktionsbüro-Variante der Termin-Erstellung**: eigene Termine anlegen/bearbeiten/löschen ist
   fertig (siehe oben), es fehlt noch die Rolle „Fraktionsbüro", die ein Zielmitglied aus der eigenen
   Fraktion auswählen und für dieses einen Termin (`herkunft = 'fraktionsbuero'`) anlegen kann.
3. **Dokumenten-Hub** (Phase 2): Liste/Suche für `documents`, zunächst manuell gepflegt. Zusammenfassungs-
   Upload + Sitzungsdetailsicht sind bereits fertig (siehe „Termindetailsicht" oben, KONZEPT.md
   Abschnitt 5.5) – es fehlt nur noch die Verknüpfung mit echten `documents`-Einträgen (Dokumenten-Hub
   existiert noch nicht).
4. **iCal-Export** des zusammengeführten persönlichen Kalenders.

Bekannte offene Frage bei der Quellen-UI: aktuell kann jedes Mitglied jede selbst angelegte Quelle auch
wieder löschen (`calendar_sources_delete_own`-Policy), auch wenn andere Mitglieder sie bereits
abonniert haben – das kollidiert nicht mit RLS, ist aber UX-mäßig nicht ideal (verwaiste Subscriptions).
Kein Blocker für den MVP, aber im Hinterkopf behalten.

## Offene Design-Entscheidungen

Diese Punkte sind in KONZEPT.md Abschnitt 11 aufgeführt und noch nicht entschieden. Bei Unsicherheit
lieber nachfragen als eine der Optionen fest einzubauen:

- Sollen Zusammenfassungen standardmäßig privat oder teilbar sein?
- Darf das Fraktionsbüro Termine nach dem Anlegen auch noch bearbeiten/löschen?
- Sollen ToDo-Boards mit Standard-Spalten vorbelegt werden?
- Wie wird die „aktive Sitzung" bestimmt (manuell vs. automatisch anhand des Datums)?

## Konventionen

- Deutsche Feld-/Tabellennamen in der Datenbank (passend zum Rest des Projekts: `titel`, `fällig_am`,
  `erstellt_am` etc.), englische Namen im Frontend-Code selbst sind okay, aber Props/Variablen, die
  direkt DB-Felder spiegeln, sollten die deutschen Feldnamen übernehmen (siehe `src/lib/types.ts`).
- Tailwind-Utility-Klassen direkt in JSX, keine separate CSS-Datei pro Komponente.
- Supabase-Zugriffe zentral über `src/lib/supabaseClient.ts`.
- RLS ist die einzige Zugriffskontrolle – es gibt keine zusätzliche Backend-Schicht. Neue Tabellen
  brauchen also immer eine durchdachte Policy, nicht nur `enable row level security`.
- Für wiederkehrende Prozeduren gibt es Skills unter `.claude/skills/`: `supabase-migration` (neue
  Migration/RLS-Policy), `edge-function` (neue/geänderte Supabase Edge Function), `document-feature`
  (Notizen-/Datei-Upload an einer neuen Entität nach dem `summaries`-Muster). Vor entsprechenden
  Aufgaben aufrufen statt die Konventionen aus diesem File neu herzuleiten.

## Setup

Siehe [README.md](./README.md) für Installation, Umgebungsvariablen und Deployment.

