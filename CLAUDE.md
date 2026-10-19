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
  Terminkalender, alle Einträge ungefiltert). **Öffentlich + persönlich** (seit `0062`): Die
  gemeinsame Quelle „Stadtrat Iserlohn" liest den **öffentlichen** ALLRIS-Feed (`/public/ics/`),
  daraus wählt jedes Mitglied seine Gremien. Sein **persönliches** ALLRIS-Abo (`/personal/ics/…?bid=
  …&sid=…`) hinterlegt jedes Mitglied als eigene, nur für sich sichtbare Quelle mit
  `nur_ergaenzend = true`: der Import übernimmt daraus nur Termine, deren UID in keiner gemeinsamen
  Quelle derselben Ebene steht – nichtöffentliche Gremien, Vertretungen, Fraktion –, und deren
  Gremien sind unter „Meine Gremien" auswählbar. Der Tagesimport läuft deshalb in zwei Runden
  (erst alle anderen, dann die ergänzenden). Bis 0062 hing die gemeinsame Quelle am persönlichen
  Abo eines Mitglieds, sichtbar für alle samt `sid`. **Die Feed-URL nie ins Protokoll schreiben**
  (`ohneUrl()` in beiden Importern), `quelle_url` nur ohne Query. Import-Horizont: `MIN_IMPORT_DATUM = 2025-11-11`
  (ältere Feed-Einträge werden nicht importiert, ältere DB-Bestände bleiben unangetastet erhalten).
  **Nichtöffentliche Gremien** (Kleine Kommissionen, Verwaltungs- und Aufsichtsräte) werden
  importiert wie alle anderen und stehen als Kalendereintrag zur Verfügung – sie bekommen nur
  keinen Inhalt, weil ALLRIS zu ihnen weder Tagesordnung noch Vorlagen veröffentlicht. Ein
  Import-Filter dafür war kurzzeitig eingebaut (0047) und ist wieder entfernt (0048); die
  Entscheidung lautet: Termin ja, Inhalt nein.
- **ToDo-Board:** Kanban-Stil mit vier **festen** Spalten – Neu, Geplant, Ergebnis erstellt, Fertig
  (seit `0060`; vorher frei konfigurierbar). Je Konto vier Zeilen in `todo_columns`, nur lesbar,
  angelegt mit dem Konto (`handle_new_user`), Constraint `todo_columns_feste_spalten`. Drag & Drop
  via `@dnd-kit/core`.
- **Datenmodell & RLS:** vollständig in `supabase/migrations/0001_init.sql`, kommentiert und 1:1 zu
  KONZEPT.md Abschnitt 7. Aktueller Stand über alle 63 Migrationen: siehe `supabase/migrations/`.

## Aktueller Stand

Kein reines Scaffold mehr, aber noch nicht produktiv für den vollen Nutzerkreis. Vorhanden:

- **Login/Auth**: Supabase Auth, Redirect-Schutz (`ProtectedRoute`), erzwungener Passwortwechsel beim
  ersten Login bzw. nach Admin-Reset (`ForcedPasswordChange`).
- **Startseite „Heute"** (`src/pages/Dashboard.tsx`, Daten in `src/lib/heute.ts`, seit dem
  UI-Umbau 18.10.2026): Begrüßung, drei Kacheln (nächste Sitzung, fällig in 7 Tagen/überfällig,
  Anzahl „Neu für dich"), optional die Presseschau (nur wenn `profiles.presseschau_aktiv`, strikt
  privat), darunter drei Karten: **Diese Woche** (Sitzungen meiner Gremien und aus
  Terminkalender-Quellen plus eigene Termine, 7 Tage, nach Tagen gruppiert, mit TOP-Zahl),
  **Meine Aufgaben** (offene Karten meines Boards, mit Termin zuerst; Haken = nach „Fertig" wie
  Ziehen im Board; Zähler je Spalte) und **Neu für dich** (`src/lib/neuigkeiten.ts`,
  `0057_neuigkeiten.sql`: Zuweisungen, mit mir geteilte Karten, Notizen anderer an meinen Karten,
  neue Tagesordnungspunkte kommender Sitzungen meiner Gremien, seit 19.10.2026 auch neue
  Drucksachen **meiner Gremien** (Tag mit dem Gremiennamen oder Sitzung eines meiner Gremien) –
  bis 8 einzeln, darüber eine Sammelzeile – und Notizen anderer an
  Dokumenten, jeweils seit dem letzten „Alles gesehen"; die Kachel „Nächste Sitzung" sucht ohne
  7-Tage-Grenze (`ladeNaechsteSitzung()`);
  Stand in der eigenen Tabelle `neuigkeiten_stand`, nicht in `profiles` – dort für Kolleg*innen
  lesbar; beim ersten Besuch gilt nichts als neu). Das ToDo-Board liegt auf `/aufgaben` (feste
  Spalten, Drag & Drop, Teilen mit Partei-/Ebenen-/Gliederungs-Kolleg*innen; ab 1024 px öffnet
  eine Karte rechts neben dem Board – `TodoBoard` mit `onAuswahl`, `TodoDetailModal`/
  `DetailModalShell` mit `eingebettet` –, schmaler im Fenster; Schalter „Nur mir zugewiesen";
  darunter „Meine Notizen" – `NotizenSection.tsx`). Der Kalender liegt auf `/kalender`
  (`src/pages/Kalender.tsx`, Daten aus `ladeTermine()` in `src/lib/termine.ts`, das auch „Diese
  Woche" speist): Woche als sieben Spalten mit vor/zurück oder Liste der nächsten 90 Tage (Handy:
  Liste), Filter Eigene Termine/Ebene/Gremium, „+ Termin" für eigene Termine. Sitzungen springen
  in die Sitzungsansicht, eigene Termine öffnen im Fenster.
- **Settings** (Sidebar-Navigation): Profil (Foto/Name), Kalenderquellen (eigene + gemeinsam
  verwaltete, strikt privat pro Nutzer getrennt), Meine Gremien/Ebenen/Gliederung, ToDo-Board (Anzeigeoptionen; die Spalten sind fest),
  MCP Connection (persönliches Bearer-Token), Benutzerverwaltung, Kontaktanfragen und Speicher-
  belegung gegen die Free-Tier-Grenzen (nur `rolle = 'admin'`).
- **Archiv**: vergangene Sitzungen (inkl. manuell nachtragbar, z. B. für Gremien ohne ICS-Feed - nur
  der erstellende Nutzer darf seine eigene nachgetragene Sitzung bearbeiten/löschen), erledigte
  Aufgaben, hochgeladene Dokumente. Das Antragswesen (Anträge, Freigaben, Fristen) ist seit `0061`
  entfallen – Anträge der Fraktion liegen als Hub-Dokumente mit Tag „Antrag".
- **Dokumente** (`/dokumente`, eigener Reiter neben dem Archiv): Top-Level-Dokumente sind immer
  "geteilt" (sichtbar für alle Mitglieder derselben Partei UND derselben Ebene/Gliederung, z. B.
  "Kommune Iserlohn", getaggt mit Ebene + freien Tags, z. B. hochgeladene Sitzungsvorlagen). Klick auf
  ein Dokument öffnet `DokumentDetailModal.tsx` (ab 1024 px rechts neben der Liste in derselben
  Karte, `eingebettet`; die Liste zieht „ungelesen" über `onGelesenGeaendert` nach): dort lassen sich eigene Notizen/Analysen anhängen
  (`dokumente.parent_id`), wahlweise "persönlich", Ebene-weit geteilt oder mit einzelnen ausgewählten
  Personen geteilt (`dokument_shares`-Tabelle). Alles auch über den
  MCP-Server befüllbar (`create_document`/`list_documents` - der Server läuft über den
  Service-Role-Client, RLS greift dort nicht, die Sichtbarkeitsprüfung passiert deshalb explizit im
  Tool-Code, siehe `darfSehen()` in `tools/dokumente.ts`). Ebene-/Tag-Filterchips, Volltextsuche in der Datenbank
  (Titel/Inhalt/Tags, `0058`; Autor im Browser) und Farbmarkierungen
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
  es ein), wird von der Suche aber **immer** mitdurchsucht, und **gilt als gelesen** (seit
  19.10.2026: viertes Argument `archiviert` von `istDokumentUngelesen()`, abgeleitet statt in
  `dokument_gelesen` geschrieben – kommt eine Vorlage auf eine neue Tagesordnung, ist sie nicht
  mehr archiviert, steht wieder in der Liste und zeigt ihren echten Lesestand; nach dieser
  Sitzung wandert sie von selbst zurück). Der Kopf der Liste zählt „offen / ungelesen / im
  Archiv", der Zähler in der Leiste nur Ungelesenes außerhalb des Archivs (neu gezählt beim
  Start und bei `LESESTAND_GEAENDERT`, das `markiereGelesen()`/`markiereUngelesen()` feuern). Es erscheint zusätzlich im „Dokumente"-
  Reiter des Archivs. Dazu: Paginierung mit wählbarer
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
  `supabase/functions/_shared/vorlageMarkdown.ts` (über `src/lib/vorlageMarkdown.ts` eingebunden), Prosa-Styles als `mc-dokument-content` in `index.css`.
  `prosaGlaetten()` entfernt dort nur noch Mehrfach-Leerzeichen und führt **keine Absätze mehr
  zusammen** – seit dailyallris die Prosa bei der Extraktion normalisiert, verklebte diese
  Heuristik Feldwerte („## Verfasser") mit dem Folgeabsatz.
  **Zwei Leselayouts** im Hub, umschaltbar im Kopf des Modals und pro Gerät in `localStorage`
  (`mc.dokument.variante`) gemerkt: A = Dokument + Notizen, C = Lesemodus (68 Zeichen
  Zeilenbreite, Notizen einklappbar). Das frühere B mit der Tagesordnung links ist seit dem
  UI-Umbau die **Sitzungsansicht** selbst: `/sitzungen/:id` (`src/pages/Sitzungen.tsx`) zeigt oben
  die kommenden Sitzungen der eigenen Gremien als Leiste und darunter **eine Karte**
  (`TerminDetailPanel`, `layout="eingebettet"`): links „Übersicht & Vorbereitung" und die
  Tagesordnung (Kennzeichen je Punkt: Drucksachennummer, neu/ungelesen, Karten, „Enthält Bilder",
  Notizen; Filter „Nur mit Drucksache" und „Ungelesen"), rechts entweder die Übersicht (Karten
  der Sitzung samt Fortschritt und „Karte zu dieser Sitzung", Kopfdaten mit Bearbeiten/Löschen
  bei nachgetragenen Sitzungen, Notizen der verknüpften Karten und Dokumente) oder der gewählte
  Punkt – `DokumentDetailModal` mit `eingebettet`: ohne Overlay, ohne Schließen, ohne
  Layout-Umschalter, Notizen ab `xl` daneben. Vor/zurück springt zwischen Punkten mit Drucksache.
  Auf dem Handy steht entweder die Tagesordnung oder der Punkt da (Zurück-Knopf). **Eine Sitzung
  öffnet sich nirgends mehr als Fenster**: `TerminDetailModal` mit `kind="session"` leitet auf
  `/sitzungen/:id` um, `/termin/session/:id` ebenso; Fenster gibt es nur noch für eigene Termine.
  Ohne `:id` ist die nächste nicht abgesagte Sitzung gewählt; eine vergangene (aus Archiv oder
  Kalender) steht dann vorn in der Leiste. Das Dokument wird per `key` remountet, wenn der Punkt
  wechselt: die lokalen Spiegel im Modal (Tags, Archiv-Status, Freigaben) werden nur beim Mounten
  aus der Prop aufgesetzt.
  **Bilder** aus den Original-PDFs (Lagepläne, Karten, Diagramme, Scans) gibt es im Markdown nicht;
  stattdessen trägt ein Dokument den Tag **„Enthält Bilder"**, wenn sich der Blick ins PDF lohnt
  (Entscheidung 18.10.2026 statt eines Anhang-Systems). Gesetzt einmalig für den Bestand von
  `scripts/wartung-bilder.py` (`wartung.yml`, skript=bilder), seither von dailyallris beim Import,
  das dabei auch die **Anlagen** der Vorlage in ALLRIS prüft (die liegen nicht im Hub; Bestand
  nachgetragen: 131 statt 17). Regel überall gleich: mind. 300×200 px, mind. 10 % der Seite,
  kein wiederkehrendes Logo. Das Wartungsskript **setzt den Tag nur, entfernt ihn nie** – es sieht
  die Anlagen nicht und würde sonst die Befunde von dailyallris löschen.
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
  `dokumente`-Policies. MCP-Tools `list_fakten`/`create_fakt`/`update_fakt` (`tools/fakten.ts`) bauen
  diese Sichtbarkeit im Code nach (`darfFaktSehen()`); Löschen nur in der Web-UI.
- **App-Rahmen** (`src/components/AppLayout.tsx`, UI-Umbau seit 18.10.2026): alle Seiten hinter
  dem Login hängen als verschachtelte Routen an **einer** Layout-Route in `App.tsx`. Links eine
  Leiste (Heute, Kalender, Sitzungen, Aufgaben, Dokumente mit Ungelesen-Zähler, Zahlen & Fakten,
  Archiv; unten Profil → Einstellungen, Abmelden, Einklappen 240 ↔ 72 px), auf dem Handy statt
  dessen eine Tab-Leiste unten (Heute, Sitzungen, Aufgaben, Dokumente, Mehr). Inhalt höchstens
  1440 px breit, oben ein 4-px-Streifen in der Parteifarbe (`bg-topbar`). Seiten bringen **kein
  eigenes Chrome** mit, nur ein `h1` mit `mc-page-title` und ihren Inhalt. Schrift IBM Plex Sans,
  Datum/Uhrzeit/Drucksachennummern in IBM Plex Mono (`font-mono`). Freigegebener Entwurf:
  Design-Canvas „MandatsCockpit – UI-Struktur" (A+B kombiniert). Reiter mit Unterstrich über
  `mc-tab` + `aria-selected` (Archiv, Zahlen & Fakten); Filter-Chips aktiv schwarz, sonst weiß
  mit Rahmen (Kalender, Dokumente). Ändern die Einstellungen Name oder Foto, feuern sie
  `PROFIL_GEAENDERT` auf `window`, die Leiste lädt nach. **Muster „Liste + Detail in einer
  Karte"** ab 1024 px, darunter Fenster: Sitzungen (TOP), Aufgaben (Karte), Dokumente (Leser) –
  jeweils dieselbe Detailkomponente mit `eingebettet`, keine zweite Ansicht.
- **Öffentliche Seiten** (außerhalb `ProtectedRoute`): Impressum, Datenschutzerklärung mit
  Kontaktformular (anonymer Insert, Honeypot-Feld).
- **Edge Functions** (`supabase/functions/`, Deno): `import-ics-source` (Einzelquellen-Reimport),
  `admin-users` (Benutzerverwaltung), `mcp-server` (MCP-JSON-RPC-Endpunkt für Claude, 32 Tools über
  ToDos/Termine/Sitzungen/Notizen/Presseschau/Dokumenten-Hub/Zahlen & Fakten – volle Liste + Details in
  README.md Abschnitt 9 und `docs/CHANGELOG.md`). `get_document` liefert den Markdown-Text eines Hub-Dokuments (in Abschnitten bis 20.000
  Zeichen) – `list_documents` lädt den Text bewusst nicht. `list_documents` kennt das Dokumenten-Archiv
  (Parameter `archiv`, Standard „ohne" wie in der Web-UI) und einen Titel-Filter (`titel`, greift
  in der DB-Abfrage, damit das Limit ältere Drucksachen nicht verdeckt) und `seit` (Upload-Zeitpunkt, für den
  täglichen Scan nach neuen Drucksachen), `update_document_archiv` legt ein
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
  Functions), Prüfung jedes PRs (`pruefung.yml`), nächtliches verschlüsseltes DB-Backup als
  Artefakt (`backup.yml`, 14 Tage, Secrets `SUPABASE_DB_PASSWORD`/`BACKUP_PASSWORT`).

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
  (Beispiele: `private.current_user_fraktion()`, `private.dokument_ist_geteilt_mit()`). `language sql`-Funktionen werden
  beim `CREATE FUNCTION` sofort gegen das Schema geparst (nicht erst beim Aufruf) – referenzierte
  Tabellen müssen in derselben Migration also **vorher** angelegt sein.
- **Muster für neue Policies und RLS-Helfer** (seit `0050_rls_helfer_privat.sql`, sonst kommen
  drei Linter-Befunde zurück): (1) Helfer gehören ins Schema **`private`**, nicht nach `public` –
  alles in `public` liefert PostgREST als `/rest/v1/rpc/<name>` aus, auch an nicht angemeldete
  Aufrufer. Aufruf in Policies als `private.<name>(...)`. **Nicht** `revoke execute` als Ersatz:
  Policies laufen mit den Rechten des Aufrufers, `authenticated` braucht EXECUTE. (2) **`(select
  auth.uid())`** statt `auth.uid()`, ebenso `(select private.current_user_partei())` für Helfer
  ohne Argumente – sonst wird pro Zeile statt pro Abfrage ausgewertet. Ausnahme `x = ANY (...)`:
  dort *kein* `select`, Postgres liest es sonst als Ergebnismenge (`text = text[]`-Fehler). (3)
  **`to authenticated`** an jede Policy, die nicht ausdrücklich für anon gedacht ist – ohne
  Rollenangabe gilt sie auch für Aufrufer mit dem öffentlichen anon-Key.
- **RLS-Änderungen vorher und nachher mit einer Sichtbarkeits-Momentaufnahme prüfen**: für jedes
  Konto und anon die über RLS sichtbaren Zeilen je Tabelle zählen (`set_config('role', ...)` +
  `request.jwt.claims` in einer `pg_temp`-Funktion) und den Fingerabdruck vergleichen. Die ganze
  Migration samt Messung vorher läuft als Generalprobe in einem `execute_sql`-Aufruf, der am Ende
  absichtlich abbricht – ein Aufruf ist eine Transaktion, es bleibt nichts zurück. Vorlage und
  Ablauf im CHANGELOG-Eintrag zu 0050.
- **Ein Notiz-System** (seit `0055_notizen_nur_todo.sql`): Notizen gibt es nur an ToDo-Karten
  (`summaries.todo_id`, sichtbar für alle, auf deren Board die Karte liegt) und an Hub-Dokumenten
  (`dokumente.parent_id`). Keine Kommentare, keine Notizen an Sitzungen oder Terminen –
  die Sitzungsansicht zeigt die Notizen ihrer verknüpften Karten und Dokumente nur an. Die
  RLS-Bedingung steht in `summaries_manage_own` (WITH CHECK), im MCP-Server gespiegelt in
  `tools/notes.ts`. Die Kommentar-Tabellen sind seit `0059` gelöscht.
- **Das Repository ist öffentlich** – damit auch die Protokolle der Actions-Läufe und ihre
  Artefakte (jeder angemeldete GitHub-Nutzer kann sie herunterladen). Workflows, die mit echten
  Daten arbeiten, schreiben keine Inhalte ins Protokoll und laden Artefakte nur verschlüsselt hoch
  (`gpg --symmetric` mit dem Secret `BACKUP_PASSWORT`, siehe `backup.yml`,
  früher `wartung-dateien.yml`). Ein unverschlüsseltes Artefakt aus dem ersten Wartungslauf am 17.10.
  musste von Hand gelöscht werden.
- **Deploy ist zweistufig**: Eine Migration wirkt sofort auf die Live-DB, das Frontend/die Edge
  Functions gehen aber erst mit `git push` live (separater Workflow-Trigger). Eine fertige
  DB-Migration ohne Push zeigt sich also noch nicht auf der Produktivseite.
- **Migrationen: zwei Wege, beide ohne Mac** (gearbeitet wird ausschließlich in Claude-Code-Cloud-
  Sitzungen). Der Container darf nach außen nur HTTPS, Postgres kommt dort nicht durch.
  (1) **Supabase-Connector** für alles, was der Code im selben PR braucht: vor dem Merge per
  `execute_sql` in einem `begin … commit` den Dateiinhalt ausführen **und** `insert into
  supabase_migrations.schema_migrations (version, name, statements)` unter der Dateinummer
  (md5-Abgleich gegen die Datei, Muster in den Einträgen ab 0054). (2) **Workflow
  `migrationen.yml`** (`supabase db push` vom GitHub-Runner, Secret `SUPABASE_DB_PASSWORD`): im PR
  ein Trockenlauf, nach dem Merge spielt er ein, was noch fehlt – Pflichtweg für `DROP`/`DELETE`,
  die über den Connector hängen, und Sicherheitsnetz für vergessene Dateien. Eine über den Connector
  eingespielte Datei sieht `db push` als erledigt an. **Nie `apply_migration`** – es trägt einen
  Zeitstempel statt der Nummer ein, und `db push` bricht dann ab. Keine DB-Zugangsdaten in die
  Cloud-Umgebung. Details: `docs/UEBERGABE-CLOUD.md`, Teil 2, Abschnitt 3.
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
- **Nutzer laden keine Dateien hoch** (seit `0052_uploads_sperren.sql`): Notizen sind reiner Text.
  Nur das technische Konto (`profiles.technisch`, Helfer `private.ist_technisch()`) darf in den
  Bucket `dokumente` schreiben – ohne Größengrenze. `zusammenfassungen` nimmt nichts Neues an
  (Policy mit `with check (false)`, bestehende Dateien bleiben lesbar). Ausnahme Profilbilder:
  2 MB, nur JPG/PNG/WebP/GIF, am Bucket erzwungen. Der MCP-Server umgeht die Policies und prüft
  deshalb selbst (`darfDateienHochladen()` in `shared.ts`). Keine Upload-Felder mehr in der
  Oberfläche einbauen.
- **Löschprotokoll** (`0053_loeschprotokoll.sql`): Jede gelöschte Zeile der Inhaltstabellen (seit 0061 zwölf)
  landet per Trigger in `private.protokoll` (wer, wann, über welchen Weg, ganze Zeile als JSON) –
  für Nutzer unsichtbar, einsehbar im Supabase-Dashboard (Schema `private`) bzw. per SQL. Wer
  löscht, bestimmt `private.protokoll_herkunft()`: `auth.uid()` aus der Web-Oberfläche; bei der
  Service-Role der Header `x-mc-user` (MCP-Server, eigener Client je Aufruf in `index.ts`) bzw.
  `x-mc-quelle` (Wartungsskripte). Neue Inhaltstabellen in die Trigger-Liste aufnehmen; neue
  Service-Role-Skripte mit `x-mc-quelle` anlegen.
- **`DROP` über den Supabase-Connector hängt**: `execute_sql` hält destruktive Anweisungen für
  eine Bestätigung zurück, die in der Cloud-Sitzung nicht ankommt – der Aufruf läuft nach 60 s
  in einen Timeout, ohne dass etwas passiert (Statement-/Lock-Timeouts greifen nicht, es wartet
  nicht die Datenbank). Policies daher mit `alter policy ... with check (false)` sperren statt
  löschen, oder das `DROP` als Migration über den Workflow `migrationen.yml` einspielen (erstmals
  `0059`). Dasselbe gilt für `DELETE` –
  auch innerhalb eines `do`-Blocks. Generalproben deshalb so bauen, dass sie ohne Löschung prüfen
  (Beispiel: `private.protokoll_herkunft()` direkt aufrufen statt eine Zeile zu löschen).
- **Storage**: private Buckets (`dokumente`, `profilbilder`; `zusammenfassungen` seit 0060 entfernt), Pfad-Muster
  `<user_id>/<dateiname>`, RLS via `(storage.foldername(name))[1] = ((select auth.uid()))::text`. Signed URLs:
  60s für einmalige Downloads, 3600s für dauerhaft sichtbare Inhalte (Fotos, offene Dokumentvorschau).
- **Bewusste Code-Duplikation**: ICS-Parsing, Hash-Helper, `createNote()`-Konfiguration etc. sind
  zwischen Deno (Edge Functions) und Node (Scripts) bzw. zwischen ähnlichen Entitäten (ToDo/Dokument)
  bewusst dupliziert – kein gemeinsames Backend/Build-Tooling, das eine Abstraktion rechtfertigen
  würde. Faustregel im Projekt: 2 Vorkommen sind tolerierbar, beim 3. wird in eine gemeinsame Stelle
  extrahiert (Beispiel: `fileNameFromPath`, `DetailModalShell`).
- **`dokumente` nie mit `select('*')` lesen** (seit `0058_dokumente_suche_vorschau.sql`): die
  generierte Spalte `suchtext` ist eine zweite Kopie des ganzen Textes. Spaltenlisten
  `DOKUMENT_SPALTEN`/`DOKUMENT_LISTEN_SPALTEN` und `ladeDokument()` in `src/lib/dokumentSpalten.ts`;
  Listen laden ohne `inhalt` und zeigen `vorschau`. Gesucht wird in der Datenbank
  (`sucheDokumente()`, ILIKE auf `suchtext` mit Trigramm-Index). `vorschau` muss jeder Schreibweg
  mitsetzen – die Funktion liegt in `supabase/functions/_shared/vorlageMarkdown.ts`, die Frontend
  und MCP-Server gemeinsam importieren.
- **PostgREST liefert höchstens 1.000 Zeilen pro Abfrage und schneidet stillschweigend ab**
  (Supabase-Voreinstellung „Max rows"). Bei 1.141 Drucksachen fehlten `list_documents` dadurch
  zufällige Dokumente, darunter die neuesten. Jede Abfrage, die potenziell den ganzen Hub oder
  alle `sitzung_dokumente` lädt, braucht eine stabile Sortierung und seitenweises Laden
  (`alleZeilen()` in `mcp-server/tools/dokumente.ts`); lange Id-Listen für `.in()` in Stücken
  (`inStuecken()`), weil sie in der URL landen. Im Frontend dieselben Helfer in
  `src/lib/alleZeilen.ts` (Hub-Liste, Archiv, Sitzungen je Dokument, Notiz-Lesestatus).
- **Zeitstempel-Vergleiche client-seitig immer numerisch**: PostgREST liefert `timestamptz` als
  `...+00:00`, `startOfTodayIso()` erzeugt `...Z` – ein String-Vergleich derselben Zeitpunkte in den
  zwei Schreibweisen ist falsch. `Date.parse(a) < Date.parse(b)` verwenden (siehe
  `src/lib/dokumenteArchiv.ts`). Server-seitig ist `.lt('datum', ...)` unproblematisch.
- **`Number(localStorage.getItem(...))` ist `0`, wenn nichts gespeichert ist** – tückisch, wenn `0`
  ein gültiger Wert der Einstellung ist (in `Dokumente.tsx` bedeutet 0 „Alle anzeigen"). Immer erst
  explizit auf `null` prüfen. `localStorage` nutzt das Projekt nur für reine Anzeige-Vorlieben pro
  Gerät (Seitengröße im Hub, Leselayout im Dokument-Modal, eingeklappte Leiste in `AppLayout`, dort
  in try/catch); alles, was geräteübergreifend gelten muss, gehört in die DB.
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
- **Spalten über den Titel finden**: Sonderverhalten für ToDo-Spalten (neue und geteilte Karten nach
  „Neu", mit Termin nach „Geplant") findet die Spalte über ihren Namen. Seit `0060` sind die Namen
  fest und per Constraint erzwungen, das ist also verlässlich. Der MCP-Server nimmt für `spalte`
  nur noch die vier Namen an (`festeSpalte()` in `tools/todos.ts`).
- **ToDo-Zuweisung** (`0056_todo_zuweisung.sql`): `todos.zustaendig_user_id` statt des Freitexts
  `zustaendig` (bleibt stehen, wird nicht mehr beschrieben). Zuständig sein kann nur, wer die Karte
  angelegt hat oder auf dem Board hat – das erzwingt der Trigger `pruefe_zustaendigkeit`, und das
  Entziehen der Freigabe löst die Zuständigkeit mit. Sehen und Bearbeiten laufen dadurch über die
  vorhandene Platzierung, Partei und Ebene prüft weiterhin nur `share-todo`. Die Oberfläche teilt
  die Karte beim Zuweisen mit, wenn nötig (nur der Ersteller); der MCP-Server (`update_todo`,
  `zustaendig` = Name) weist nur unter Personen zu, die die Karte schon haben.
- **Teilen/Kandidatensuche** (ToDos, Dokumente): grobe Vorfilterung per RLS
  (`profiles_select_same_partei_ebene`), exakter Abgleich (Partei + Ebene + Gliederung) läuft
  clientseitig in `loadCandidates()`. Konten mit `profiles.technisch = true` (Automatik-Konten wie
  der ALLRIS-Import von dailyallris) fallen dort heraus – an allen drei Stellen im Frontend und in
  `resolveTeilenMitNamen()` im MCP-Server. Das ist Aufräumen der Oberfläche, keine Zugriffsgrenze.
  Setzbar in der Benutzerverwaltung (Checkbox), siehe `0041_profiles_technisch.sql`. **Technische
  Konten lassen sich nicht löschen** (`0061`, Trigger `technisches_konto_schuetzen` auf `profiles`,
  dazu Sperre in `admin-users`): `dokumente.user_id` cascaded, mit dem ALLRIS-Konto verschwände der
  ganze Hub. Beim Löschen eines normalen Kontos gehen seine Dokumente mit (Zeilen per Cascade,
  Dateien im Bucket `dokumente` räumt `admin-users` vorher ab).
- **Harness für Seiten hinter dem Login**: `.harness/` (nicht eingecheckt, in
  `.git/info/exclude`) – eigene Vite-Konfiguration, die `supabaseClient` durch ein Mock mit
  Beispieldaten ersetzt, damit sich Layouts im Browser per Playwright ansehen lassen, ohne
  Passwort-Eingabe. Gibt es in einer neuen Sitzung nicht – bei Bedarf nach dem Muster neu anlegen
  (Proxy-Builder, der je Tabelle Fixtures liefert und Filter ignoriert).
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
- **Typen und Datenbank laufen nicht mehr still auseinander**: `src/lib/database.types.ts` ist aus
  der Datenbank erzeugt (in der Cloud über den Connector `generate_typescript_types`,
  `npm run typen` dort, wo die Supabase-CLI angemeldet ist), `src/lib/typenPruefung.ts` vergleicht beim Build jeden Zeilentyp aus
  `types.ts` damit (fehlende/erfundene Spalten, fehlendes `null`, zu weiter Typ). Nach einer
  Migration also die Typen neu erzeugen – tsc nennt dann, was in `types.ts` fehlt. Beim Einführen
  fehlten sieben Spalten (u. a. `sessions.ics_uid`, `todos.zustaendig_seit`).
- **Tests** (`npm test`, Vitest, `src/lib/__tests__/`) für die reinen Hilfsfunktionen: Archiv-Regel,
  Gelesen-Status, Vorlagen-Aufbereitung, Gliederung. Laufen in der PR-Prüfung mit.
- **Login-Tests**: Passwort-Eingabe im Browser ist tabu (Sicherheitsregel), daher keine echten
  Login-Rundgänge – Verifikation läuft über `npm run lint` + `npm test` + `npm run build` (`tsc -b`/`vite build`)
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

Derzeit keine fest geplanten. Optional: OAuth für den MCP-Server, damit das Token auch bei claude.ai
nicht mehr in der Connector-URL steht (siehe README Abschnitt 9).

## Entschiedene Design-Fragen (17.10.2026)

Die früher offenen Punkte aus KONZEPT.md Abschnitt 11 sind entschieden:

- **Zusammenfassungen** werden nicht mehr gebraucht – es gibt nur Notizen (Text) an ToDos und
  Dokumenten. Den Speicherbereich `zusammenfassungen` gibt es nicht mehr.
- **ToDo-Spalten** sind fest: Neu, Geplant, Ergebnis erstellt, Fertig.
- **Keine Bilder im Hub** (Entscheidung 18.10.2026): statt eines Anhang-Systems der Tag „Enthält
  Bilder" mit Verweis aufs Original-PDF, siehe Dokumente oben.
- **Keine Rolle „Fraktionsbüro"** (Entscheidung 18.10.2026, gestrichen): `events.herkunft` und
  `erstellt_von` bleiben, es gibt aber keine Oberfläche, mit der jemand Termine für andere anlegt.
- **Kalender-Abos entfallen** (`0063`): der Kalender zeigt alles aus gemeinsamen und eigenen Quellen,
  gefiltert über „Meine Gremien". Gemeinsame Quellen ändern/löschen nur Admins, eigene sieht nur ihr
  Besitzer – verwaiste Abos kann es nicht mehr geben. Der Einzel-Reimport (`import-ics-source`)
  lädt nur Quellen, die der Aufrufer sieht.
- **Kein iCal-Export** (Entscheidung 18.10.2026): der zusammengeführte Kalender bleibt im Cockpit.
- **Aktive Sitzung**: wird manuell aufgerufen. Kein automatisch bestimmter Sitzungsfokus, keine
  vom Ratsbüro gesetzte Markierung – die Sitzungen stehen im Kalender und in „Demnächst".

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
  (überholt seit 0055, siehe Warnung im Skill). Vor entsprechenden
  Aufgaben aufrufen statt die Konventionen aus diesem File neu herzuleiten.

## Setup

Siehe [README.md](./README.md) für Installation, Umgebungsvariablen und Deployment.

