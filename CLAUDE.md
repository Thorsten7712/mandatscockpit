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

- **Frontend:** React 18 + Vite 8 + TypeScript + Tailwind 4 + React Router 7, komplett statisch,
  gehostet auf GitHub Pages.
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
  **Nichtöffentliche Gremien** (Kleine Kommissionen, Verwaltungs- und Aufsichtsräte) werden
  importiert wie alle anderen und stehen als Kalendereintrag zur Verfügung – sie bekommen nur
  keinen Inhalt, weil ALLRIS zu ihnen weder Tagesordnung noch Vorlagen veröffentlicht. Ein
  Import-Filter dafür war kurzzeitig eingebaut (0047) und ist wieder entfernt (0048); die
  Entscheidung lautet: Termin ja, Inhalt nein.
- **ToDo-Board:** Kanban-Stil mit frei definierbaren Spalten (`todo_columns`) statt fester Status,
  Drag & Drop via `@dnd-kit/core`.
- **Datenmodell & RLS:** vollständig in `supabase/migrations/0001_init.sql`, kommentiert und 1:1 zu
  KONZEPT.md Abschnitt 7. Aktueller Stand über alle ~43 Migrationen: siehe `supabase/migrations/`.

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
- **Dokumente** (`/dokumente`, eigener Reiter neben dem Archiv): Top-Level-Dokumente sind immer
  "geteilt" (sichtbar für alle Mitglieder derselben Partei UND derselben Ebene/Gliederung, z. B.
  "Kommune Iserlohn", getaggt mit Ebene + freien Tags, z. B. hochgeladene Sitzungsvorlagen). Klick auf
  ein Dokument öffnet `DokumentDetailModal.tsx`: dort lassen sich eigene Notizen/Analysen anhängen
  (`dokumente.parent_id`), wahlweise "persönlich", Ebene-weit geteilt oder mit einzelnen ausgewählten
  Personen geteilt (`dokument_shares`-Tabelle, Muster von `antrag_shares`). Alles auch über den
  MCP-Server befüllbar (`create_document`/`list_documents` - der Server läuft über den
  Service-Role-Client, RLS greift dort nicht, die Sichtbarkeitsprüfung passiert deshalb explizit im
  Tool-Code, siehe `darfSehen()` in `tools/dokumente.ts`). Ebene-/Tag-Filterchips, client-seitige
  Volltextsuche (Titel/Inhalt/Tags/Autor der Top-Level-Dokumente) und Farbmarkierungen
  (`EBENE_COLOR`/`tagColor()` in `src/lib/sourceColors.ts`). `DokumentDetailModal.tsx` nutzt die
  gemeinsame `DetailModalShell` (2-Spalten). Gelesen/Ungelesen manuell umschaltbar über einen farbigen
  Punkt-Indikator (kein Umschlag-Icon). Eigener Storage-Bucket
  `dokumente`, RLS-Sichtbarkeit über `current_user_gliederung_matches()`/`dokument_ist_geteilt_mit()`
  (`supabase/migrations/0033_dokumente.sql`, `0034_dokumente_kommentare.sql`). Top-Level-Dokumente
  lassen sich zusätzlich mit **mehreren Sitzungen** (n:m-Jointabelle `sitzung_dokumente`,
  `0042_sitzung_dokumente.sql` – die frühere Spalte `dokumente.session_id` ist entfallen, weil eine
  Vorlage typischerweise erst den Fachausschuss und dann den Rat durchläuft) und mit beliebig vielen
  ToDo-Karten verknüpfen (`todo_dokumente`, `0037_todo_dokumente.sql`). Beide Verknüpfungen sind im
  Detail-Modal auf beiden Seiten sichtbar/editierbar und über den MCP-Server steuerbar
  (`link_document_session`/`unlink_document_session`, `link_todo_document`/`unlink_todo_document`).
  Die Verknüpfungszeile **ist** zugleich der **Tagesordnungspunkt** (`top_nummer`, `top_titel`,
  `reihenfolge`, `ergebnis`; `0043`/`0044`) – dasselbe Dokument kann in zwei Sitzungen unter
  verschiedenen Nummern stehen. `reihenfolge` gibt es zusätzlich zu `top_nummer`, weil Text falsch
  sortiert („3.10" vor „3.2"). `dokument_id` ist seit `0044_tagesordnungspunkte.sql` **nullable**:
  rund ein Viertel der Punkte einer Ratstagesordnung hat keine Drucksache („Eröffnung der Sitzung",
  „Einwohnerfragestunde"), und ohne sie springt die Nummerierung. `ergebnis` ist die Spalte
  „Zuständigkeit" aus ALLRIS („ungeändert beschlossen", „abgelehnt") – Freitext, weil die Wertemenge
  ALLRIS gehört und ein unbekannter Wert keinen Import abbrechen darf; sie gehört an den TOP und
  nicht ans Dokument, weil dieselbe Vorlage im Ausschuss empfohlen und im Rat beschlossen wird.
  Geschrieben wird die Tagesordnung ausschließlich über den MCP-Server (`set_session_agenda`, aus
  dailyallris heraus; die Sitzung lässt sich dort über `session_id`, `ics_uid` oder `gremium`+`datum`
  benennen – Letzteres für die von Hand nachgetragenen Sitzungen ohne ALLRIS-Kennung, siehe
  `0045_sitzungen_nachtragen.sql`); Punkte ohne Dokument lassen sich per RLS nur an **selbst nachgetragenen**
  Sitzungen anlegen, weil es dort kein Dokument gibt, an dem die Berechtigung hängen könnte.
  Eindeutigkeit und Idempotenz des Imports hängen an einem partiellen Unique-Index auf
  (`session_id`, `top_nummer`) – ohne ihn hätte ein zweiter Lauf alle Punkte ohne Drucksache
  verdoppelt (NULL ist in Postgres zu jedem anderen NULL ungleich, `unique (session_id,
  dokument_id)` greift dort also nicht).
  **Archiv:** Ein Dokument gilt als archiviert, wenn entweder die **letzte** verknüpfte Sitzung
  vorbei ist (nicht irgendeine – sonst verschwände eine Vorlage nach dem Fachausschuss, während der
  Rat noch entscheidet) oder
  `dokumente.archiviert_am` gesetzt wurde (`0038_dokumente_archiv.sql`, Regel in
  `src/lib/dokumenteArchiv.ts`). Archiviertes ist in der Liste ausgeblendet (Chip „Archiv (n)" blendet
  es ein), wird von der Suche aber **immer** mitdurchsucht. Es erscheint zusätzlich im „Dokumente"-
  Reiter des Archivs, gemischt mit den `summaries`-Datei-Uploads. Dazu: Paginierung mit wählbarer
  Seitengröße (10/25/50/100/Alle) und ein Schnellfilter „Meine Gremien" (über die Sitzung des
  Dokuments, `user_gremien`). **Löschen nur im Detail-Modal**, nicht aus der Liste heraus: bei einem
  geteilten Dokument verlangt der Dialog eine ausdrückliche Bestätigung per Checkbox, weil es für
  alle verschwindet und `parent_id` (ON DELETE CASCADE) auch fremde Notizen mitnimmt.
  **Leseansicht (Variante A):** Seit der Markdown-Umstellung von dailyallris liegt der Text der
  ALLRIS-Vorlagen in `dokumente.inhalt`. `DokumentDetailModal.tsx` nutzt deshalb **nicht** mehr
  `DetailModalShell`, sondern ein eigenes Layout: Metadatenband über die volle Breite (Titel,
  Ebene, Tags, Sitzungs- und ToDo-Chips, Aktionen), darunter links das gerenderte Dokument
  (`VorlageAnsicht.tsx`) und rechts die Notizen. Tags/Sitzung/ToDos werden im Band nur angezeigt;
  die Eingabefelder klappen über „Verknüpfungen" darunter auf. Markdown-Aufbereitung in
  `src/lib/vorlageMarkdown.ts`, Prosa-Styles als `mc-dokument-content` in `index.css`.
  `prosaGlaetten()` entfernt dort nur noch Mehrfach-Leerzeichen und führt **keine Absätze mehr
  zusammen** – seit dailyallris die Prosa bei der Extraktion normalisiert, verklebte diese
  Heuristik Feldwerte („## Verfasser") mit dem Folgeabsatz.
  **Drei Leselayouts**, umschaltbar im Kopf des Modals und pro Gerät in
  `localStorage` gemerkt: A = Dokument + Notizen, B = zusätzlich eine linke Spalte, C = Lesemodus
  (68 Zeichen Zeilenbreite, Notizen einklappbar). In B steht links die **Tagesordnung** der Sitzung,
  aus der heraus geöffnet wurde – ein Klick wechselt das Dokument. Eine **Sitzung** hat nur noch
  **diese eine Ansicht**: `TerminDetailPanel` schlägt beim Laden ein Dokument auf und rendert dann
  *kein eigenes Chrome mehr* (`imLeser` – es genügt irgendein verknüpftes Dokument, eine
  importierte Tagesordnung ist nicht nötig) – die frühere Listenansicht
  lag sonst nach dem Schließen wieder frei, obwohl sie gerade übersprungen worden war. Die Sitzung
  selbst – Kopfdaten, Aufgaben, Anträge, Notizen, Dateien – ist dort der **erste Eintrag über der
  Tagesordnung** (`uebersicht`/`uebersichtTitel`); im Übersichts-Modus zeigt der Kopf den
  Sitzungstitel und nur noch das Schließen-X, die Spalten werden zu Navigation + Sitzung.
  Ohne TOP-Nummern startet der Leser in der **Übersicht** (`starteInUebersicht`) und beschriftet
  die Spalte „Verknüpfte Dokumente" – „das erste Dokument" hätte dort keine Bedeutung. Rückfall
  auf die Liste bleibt nur, wo es nichts zu lesen gibt: eigene Termine und Sitzungen ganz ohne
  verknüpftes Dokument. Bis die Verknüpfungen geladen sind, rendert das Modal **nichts**
  (`dokumenteGeladen`) – sonst blitzt die Liste auf und der Leser legt sich darüber. Das Modal-Chrome (Overlay, Kopfzeile, Schließen) liegt deshalb in
  `TerminDetailPanel` (`layout="modal"`) statt in `TerminDetailModal` – nur die Komponente weiß,
  ob sie überhaupt eines braucht; `TerminDetailModal` ist nur noch der Einstiegspunkt für die drei
  Aufrufer. Auf der eigenen Seite `/termin/:kind/:id` springt nichts automatisch auf, sonst läge
  sofort ein Overlay über der gerade aufgerufenen Seite; Punkte ohne Drucksache stehen
  kursiv und grau da, es gibt nichts zu öffnen. Zwei `localStorage`-Schlüssel, weil die beiden
  Aufrufwege verschiedene Vorlieben haben: aus dem Hub heraus (`mc.dokument.variante`) wäre die
  linke Spalte leer, Standard sind dort zwei Spalten; aus einer Sitzung heraus
  (`mc.sitzung.variante`) ist die Tagesordnung der Einstieg, Standard sind drei Spalten. Beim
  Wechsel über die Tagesordnung scrollt der aktive Punkt wieder in den sichtbaren Bereich – der
  Remount setzt die Spalte sonst an den Anfang zurück, was bei 84 Punkten stört. Die Auswahl besitzt der Aufrufer
  (`TerminDetailPanel`) und remountet das Modal per `key`: die lokalen Spiegel im Modal (Tags,
  Archiv-Status, Freigaben) werden nur beim Mounten aus der Prop aufgesetzt.
  Die **Listenansicht** zeigt nur `vorschau()` – zwei Zeilen reiner Text, bevorzugt der
  Beschlussvorschlag. Niemals `inhalt` ungekürzt rendern: das sind pro Vorlage rund 9.000 Zeichen.
- **Zahlen & Fakten** (`/fakten`, eigener Reiter in der Kopfleiste): Argumentationshilfen,
  Sprachregelungen und belegte Kennzahlen als eigene Tabelle `fakten` (`0039_fakten.sql`) – bewusst
  **nicht** als Tag-Sicht auf `dokumente`, Begründung im Migrationskopf. Drei Kategorien-Reiter,
  `kategorie='zahl'` als Kachelraster mit herausgestelltem Wert (`kennzahl` ist `text`, nicht
  `numeric`: „rund 1.200", „8–12"), die beiden Textkategorien als Fließtext-Liste. Belegpflicht
  sichtbar gemacht: fehlt `quelle`/`stand`, steht dort „Keine Quelle hinterlegt" in Amber.
  **Immer Ebenen-Material**: es gibt keine privaten Fakten
  (`0040_fakten_immer_geteilt.sql` schränkt `sichtbarkeit` auf `'geteilt'` ein und macht `ebene`
  zur Pflicht) – wer etwas nur für sich notieren will, nutzt den Dokumenten-Hub. Das Formular fragt
  deshalb nur noch, für welche der eigenen Ebenen der Fakt gilt. RLS spiegelt exakt die vier
  `dokumente`-Policies. Kein MCP-Tool dafür.
- **Kopfleiste des Dashboards**: die drei inhaltlichen Ziele in fester Reihenfolge – Dokumente,
  Zahlen & Fakten, Archiv. Einstellungen und Abmelden liegen in einem Klappmenü hinter dem eigenen
  Profilbild links (schließt per Klick daneben und per Escape).
- **Öffentliche Seiten** (außerhalb `ProtectedRoute`): Impressum, Datenschutzerklärung mit
  Kontaktformular (anonymer Insert, Honeypot-Feld).
- **Edge Functions** (`supabase/functions/`, Deno): `import-ics-source` (Einzelquellen-Reimport),
  `admin-users` (Benutzerverwaltung), `mcp-server` (MCP-JSON-RPC-Endpunkt für Claude, 35 Tools über
  ToDos/Termine/Sitzungen/Anträge/Notizen/Presseschau/Dokumenten-Hub – volle Liste + Details in
  README.md Abschnitt 9 und `docs/CHANGELOG.md`). `list_documents` kennt das Dokumenten-Archiv
  (Parameter `archiv`, Standard „ohne" wie in der Web-UI) und einen Titel-Filter (`titel`, greift
  in der DB-Abfrage, damit das Limit ältere Drucksachen nicht verdeckt), `update_document_archiv` legt ein
  Dokument von Hand hinein bzw. holt es zurück. `delete_document` ist der einzige
  Löschweg für Hub-Dokumente, seit der Bestand dem technischen Import-Konto gehört und in der
  Web-UI niemand mehr Eigentümer ist. Admins dürfen dort zusätzlich die Dokumente der
  Automatik-Konten (`profiles.technisch`) löschen – ohne das käme an den Hub-Bestand niemand mehr
  heran außer dem Konto selbst mit seinem Token aus der GitHub-Action. Fremde **persönliche**
  Notizen bleiben auch für Admins unantastbar. `set_session_agenda` schreibt die ganze Tagesordnung einer
  Sitzung in einem Aufruf (Punkte mit und ohne Drucksache, Reihenfolge, Ergebnis; Drucksachennummern
  werden zum Hub-Dokument aufgelöst, fehlende nennt die Antwort, damit dailyallris sie nachlädt),
  `list_session_agenda` liest sie zurück. `update_document_inhalt` setzt den Markdown-Text
  nachträglich (für dailyallris, das bereits hochgeladene Vorlagen nachrüstet) – mit
  `modus="anhaengen"` auch stückweise, weil ein einzelner MCP-Aufruf ab ca. 13 KB unzuverlässig wird. Die Archiv-Regel ist in `tools/dokumente.ts`
  bewusst gespiegelt statt geteilt (kein gemeinsames Build-Tooling zwischen Deno und Frontend).
- **GitHub-Actions-Workflows**: Deploy nach GitHub Pages (inkl. `404.html`-Kopie fürs SPA-Routing),
  Supabase-Keep-Alive, täglicher ICS-Import (`import-ics.yml`, 04:00 UTC), Edge-Function-Deploy
  (`deploy-edge-functions.yml`, deployt bei jeder Änderung unter `supabase/functions/**` alle
  Functions).

Volle Details zu jedem Punkt (Datenmodell, Komponenten-Props, exakte RLS-Policy-Namen) stehen im Code
selbst bzw., wo die Begründung nicht aus dem Code hervorgeht, in [`docs/CHANGELOG.md`](./docs/CHANGELOG.md).

### Technische Fallstricke & Muster (aus der Historie gelernt)

- **SECURITY-DEFINER-Funktionen brauchen `set search_path = public, pg_temp`** (seit
  `0049_search_path_fixieren.sql`, Befund des Supabase-Linters). Ohne festen Suchpfad lösen sie
  ihre Tabellen über den Pfad des Aufrufers auf – bei Funktionen, die mit erhöhten Rechten laufen
  und an denen die gesamte RLS hängt, ist das eine offene Flanke. `pg_temp` gehört **ans Ende**:
  sonst wird es implizit zuerst durchsucht und eine temporäre Tabelle könnte die echte verdecken.
  Die Migration hat ein Sicherheitsnetz, das abbricht, sobald eine neue Funktion ohne Suchpfad
  dazukommt – neue Helfer also gleich mit `set search_path` anlegen.
- **RLS-Rekursion**: Eine Policy, die in ihrer eigenen USING-Klausel dieselbe Tabelle per Subquery
  abfragt (z. B. `profiles`-Policy fragt `profiles` ab), verursacht „infinite recursion detected in
  policy" (Postgres 42P17). Fix: SECURITY DEFINER-Helper-Funktion, die die Tabelle direkt abfragt
  (Beispiele: `current_user_fraktion()`, `antrag_gehoert_nutzer()`). `language sql`-Funktionen werden
  beim `CREATE FUNCTION` sofort gegen das Schema geparst (nicht erst beim Aufruf) – referenzierte
  Tabellen müssen in derselben Migration also **vorher** angelegt sein.
- **Deploy ist zweistufig**: Eine Migration wirkt sofort auf die Live-DB, das Frontend/die Edge
  Functions gehen aber erst mit `git push` live (separater Workflow-Trigger). Eine fertige
  DB-Migration ohne Push zeigt sich also noch nicht auf der Produktivseite.
- **Migrationen in der Cloud-Sitzung laufen über den Supabase-Connector, nicht `supabase db push`**:
  Der Container darf nach außen nur HTTPS, Postgres kommt weder direkt noch durch den Proxy durch
  (getestet). Ablauf: Datei committen, dann per `execute_sql` in einem `begin … commit` den
  Dateiinhalt ausführen **und** `insert into supabase_migrations.schema_migrations (version, name,
  statements)` unter der Dateinummer. **Nie `apply_migration`** – es trägt einen Zeitstempel statt
  der Nummer ein, und der nächste `supabase db push` vom Mac bricht dann ab. Keine
  DB-Zugangsdaten in die Cloud-Umgebung. Details: `docs/UEBERGABE-CLOUD.md`, Teil 2, Abschnitt 3.
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
- **Zeitstempel-Vergleiche client-seitig immer numerisch**: PostgREST liefert `timestamptz` als
  `...+00:00`, `startOfTodayIso()` erzeugt `...Z` – ein String-Vergleich derselben Zeitpunkte in den
  zwei Schreibweisen ist falsch. `Date.parse(a) < Date.parse(b)` verwenden (siehe
  `src/lib/dokumenteArchiv.ts`). Server-seitig ist `.lt('datum', ...)` unproblematisch.
- **`Number(localStorage.getItem(...))` ist `0`, wenn nichts gespeichert ist** – tückisch, wenn `0`
  ein gültiger Wert der Einstellung ist (in `Dokumente.tsx` bedeutet 0 „Alle anzeigen"). Immer erst
  explizit auf `null` prüfen. `localStorage` wird im Projekt nur an dieser einen Stelle genutzt, für
  eine reine Anzeige-Vorliebe pro Gerät; alles, was geräteübergreifend gelten muss, gehört in die DB.
- **Zwei zusammengehörige States immer im selben Tick setzen**: `loadDocuments()` in `Dokumente.tsx`
  setzt erst die Sitzungs-Map und dann die Dokumente. Umgekehrt rendert React einmal mit voller
  Dokumentenliste und leerer Sitzungs-Map – und dann gilt kein Dokument als archiviert, das Archiv
  ist für einen Moment sichtbar in der Liste. Alles nach demselben `await` wird gebatcht, davor nicht.
- **Fehler bei Hilfsabfragen nicht verschlucken**: `ladeSessionInfos()` meldet Fehler und
  unvollständige Ergebnisse zurück, weil ohne Sitzungsdaten stillschweigend *jedes* Dokument als
  nicht archiviert gilt – das sähe aus wie ein kaputter Archiv-Filter statt wie ein Ladefehler.
- **Abgeleitete Zustände nicht materialisieren, wenn sie nur an einer Zeit hängen**: Die Archiv-Regel
  „verknüpfte Sitzung ist vorbei" steht bewusst in keiner Spalte – sie ist eine Funktion aus
  `sessions.datum` und bräuchte sonst einen täglichen Job. Folge: sie ist in PostgREST nicht
  filterbar, die Liste wird geladen und beim Rendern gefiltert (`Dokumente.tsx`, `Archiv.tsx`).
- **Titel-basiertes Spalten-Matching**: Sonderverhalten für ToDo-Spalten wie „Neu"/„Fertig" läuft über
  case-insensitiven Titel-Vergleich, nicht über stabile IDs – bricht, wenn der Nutzer die Spalte
  umbenennt (bewusster Trade-off, da Spalten frei umbenennbar sind).
- **Teilen/Kandidatensuche** (ToDos, Anträge): grobe Vorfilterung per RLS
  (`profiles_select_same_partei_ebene`), exakter Abgleich (Partei + Ebene + Gliederung) läuft
  clientseitig in `loadCandidates()`. Konten mit `profiles.technisch = true` (Automatik-Konten wie
  der ALLRIS-Import von dailyallris) fallen dort heraus – an allen drei Stellen im Frontend und in
  `resolveTeilenMitNamen()` im MCP-Server. Das ist Aufräumen der Oberfläche, keine Zugriffsgrenze.
  Setzbar in der Benutzerverwaltung (Checkbox), siehe `0041_profiles_technisch.sql`.
- **Detail-Modals**: gemeinsame Hülle `src/components/DetailModalShell.tsx` (2-Spalten-Layout,
  `headerActions`-Slot) – für neue Entity-Detail-Modals wiederverwenden statt eigenes Chrome zu bauen.
- **Formularblöcke vs. Blocksatz unterscheiden sich an der Lückenbreite**: Beim PDF-Auszug der
  ALLRIS-Vorlagen erzeugen beide Mehrfach-Leerzeichen, brauchen aber das Gegenteil voneinander –
  beim Formular trägt die Spaltenausrichtung Bedeutung, beim Fließtext ist sie Müll. Gemessen an
  DS11/1113: Formularblöcke haben Leerzeichen-Läufe von 6 bis 49, Blocksatz-Fließtext nie mehr
  als 5. `FORMULAR_LUECKE = 6` in `src/lib/vorlageMarkdown.ts` trennt daran. Eine frühere Schwelle
  von 3 hat den halben Sachverhalt fälschlich als Formular gerendert.
- **Löschen läuft überall über `src/components/LoeschDialog.tsx`** – kein `window.confirm` und kein
  eigenes Inline-„Sicher?" mehr. Der Hook `useLoeschDialog()` liefert `fragen({...})` für den Knopf
  und `dialog` fürs JSX; eine Komponente mit mehreren Löschzielen braucht dadurch nur eine Instanz.
  Entscheidend ist `folgen`: leer = schlichte Rückfrage „Bist du sicher?", gefüllt = roter Kasten mit
  den Konsequenzen und eine Checkbox, die den Knopf erst freigibt. `folgen` füllen, sobald das
  Löschen **andere** trifft (Ebene-weit geteilt, mit Einzelpersonen geteilt, auf fremden Boards,
  gemeinsam verwaltete Kalenderquelle, fremde Notizen per ON DELETE CASCADE). Der Dialog liegt als
  `fixed`-Overlay (z-60), weil Aufrufer teils in scrollenden Modal-Spalten sitzen. Löschfunktionen
  **werfen** jetzt bei Fehlern, statt sie in einen eigenen State zu schreiben – der Dialog zeigt sie
  an und bleibt offen, sonst sähe ein Fehlschlag wie ein Erfolg aus.
- **Login-Tests**: Passwort-Eingabe im Browser ist tabu (Sicherheitsregel), daher keine echten
  Login-Rundgänge – Verifikation läuft über `npm run lint` + `npm run build` (`tsc -b`/`vite build`)
  + statische Test-Harnesses. Beide laufen ohne eine einzige Meldung durch; neue Warnungen beheben
  statt sie stehen zu lassen. Nur
  Seiten ohne Login (Impressum/Datenschutz) lassen sich echt im Browser testen.
- **Tailwind 4 hat keine `tailwind.config.js` mehr**: Theme-Tokens (Schrift, Partei-Farben) stehen
  im `@theme`-Block von `src/index.css`, die `mc-*`-Bausteine als `@utility`. Dort steht auch ein
  Kompatibilitätsblock, der drei v3-Standards zurückholt (Rahmenfarbe gray-200, Placeholder gray-400,
  Hand-Cursor auf Buttons) – ohne ihn sähe jedes `border` ohne Farbklasse dunkel aus. Klassennamen
  haben sich verschoben: v3-`shadow-sm` heißt jetzt `shadow-xs`, `rounded` heißt `rounded-sm`, das
  `!important` steht hinten (`px-2!`).
- **Seiten hinter dem Login werden per `React.lazy` nachgeladen** (`App.tsx`): als ein einziges
  Bundle lag die App über Vites 500-kB-Warnschwelle. Neue geschützte Seiten ebenso einbinden.
- **GitHub Pages SPA-Routing**: Deploy-Workflow kopiert `dist/index.html` nach `dist/404.html`, sonst
  404 bei Reload/Direktaufruf einer Unterroute.
- **ICS-Import**: läuft auf Node 22 (nicht 20, wegen supabase-js Realtime-Client). URLs mit
  `webcal://`/`webcals://` müssen vor dem Fetch auf `https://` normalisiert werden
  (`normalizeIcsUrl()`) – native `fetch` kennt das Schema sonst nicht.
- **MCP-Connector-Tool-Liste ist pro Claude-Unterhaltung eingefroren**: `tools/list` wird offenbar nur
  beim Verbindungsaufbau einer Unterhaltung abgefragt, nicht laufend neu. Ein bereits offener Chat
  sieht deshalb weiterhin die alten Tool-Namen (inkl. Aufrufe auf inzwischen umbenannte/entfernte
  Tools, die serverseitig mit „Unbekanntes Tool" fehlschlagen), selbst wenn der Connector im
  Hintergrund neu verbindet und selbst wenn Claudes eigene Connector-Einstellungsseite bereits die
  aktuelle Liste zeigt (die fragt offenbar bei jedem Aufruf frisch ab). Nach einer Tool-Änderung im
  MCP-Server also nicht in derselben Unterhaltung auf Sichtbarkeit der Änderung warten – dafür einen
  neuen Chat starten.

## Geplante nächste Schritte

1. **Echte Nutzer-Zuweisung für ToDo-Zuständigkeit** statt Freitext (`todos.zustaendig`) – laut
   Nutzerentscheidung bewusst für später zurückgestellt. Würde eine neue Spalte (z. B.
   `zustaendig_user_id`) sowie eine RLS-Erweiterung brauchen, damit die zugewiesene Person die Karte
   auch sieht/bearbeiten kann – das ToDo-Board ist aktuell komplett privat (`todos_manage_own`).
2. **Fraktionsbüro-Variante der Termin-Erstellung**: eigene Termine anlegen/bearbeiten/löschen ist
   fertig (siehe oben), es fehlt noch die Rolle „Fraktionsbüro", die ein Zielmitglied aus der eigenen
   Fraktion auswählen und für dieses einen Termin (`herkunft = 'fraktionsbuero'`) anlegen kann.
3. **RIS-Dokumenten-Import** (Phase 2, KONZEPT.md Abschnitt 5.1): automatischer Import öffentlicher
   Ratsinformationssystem-Dokumente (Anträge/Vorlagen) in die weiterhin ungenutzte `documents`-Tabelle
   (0001_init.sql) - nicht zu verwechseln mit dem neuen `/dokumente`-Reiter (Tabelle `dokumente`,
   0033_dokumente.sql), der geteilte/persönliche, selbst hochgeladene Dokumente verwaltet und davon
   unabhängig ist.
4. **iCal-Export** des zusammengeführten persönlichen Kalenders.
5. **Bilder in Vorlagen**: Markdown kann Bilder referenzieren, aber der Storage-Bucket ist privat
   und die Lese-Policy hängt an `dokumente.datei_url` – ein eingebettetes Bild wäre nur für den
   Hochladenden sichtbar. Nötig wären eine Jointabelle `dokument_anhaenge` plus ein zweiter
   `exists`-Zweig in `dokumente_storage_select_own_or_shared`. `VorlageAnsicht.tsx` rendert
   Bild-Referenzen bis dahin als Link und lädt bewusst keine fremden URLs (die würden IP und
   Zeitpunkt jedes lesenden Mitglieds an einen fremden Server melden).
6. **MCP-Tools für „Zahlen & Fakten"** (`fakten`, 0039): bislang nur über die Web-UI pflegbar. Ein
   `list_fakten`/`create_fakt` nach dem Muster von `tools/dokumente.ts` wäre additiv – dabei die
   Sichtbarkeitsprüfung wie dort explizit im Tool-Code nachbauen, der MCP-Server umgeht RLS.

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

