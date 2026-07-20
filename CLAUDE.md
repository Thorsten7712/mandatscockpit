# Projektkontext für Claude Code

Dieses Repo ist der Starter für **MandatsCockpit**, ein Dashboard für Mitglieder des Stadtrats Iserlohn
(und potenziell weiterer Gremien wie Kreistag/Landtag/Bundestag). Die vollständige Konzeption –
Architektur, Begründungen, offene Fragen – steht in [`docs/KONZEPT.md`](./docs/KONZEPT.md). Bitte diese
Datei zuerst lesen, bevor größere Änderungen gemacht werden; sie ist die Quelle der Wahrheit für
Design-Entscheidungen.

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
- **ToDo-Board:** Kanban-Stil mit frei definierbaren Spalten (`todo_columns`) statt fester Status,
  Drag & Drop via `@dnd-kit/core`.
- **Datenmodell & RLS:** vollständig in `supabase/migrations/0001_init.sql`, kommentiert und 1:1 zu
  KONZEPT.md Abschnitt 7.

## Aktueller Stand (Scaffold, noch nicht produktiv)

Vorhanden:
- Login (Supabase Auth, E-Mail/Passwort) mit Redirect-Schutz (`ProtectedRoute`)
- Dashboard-Seite mit einfacher Kalenderansicht (`CalendarView`) und ToDo-Board (`TodoBoard`)
- Settings-Seite zum An-/Abmelden von Kalenderquellen sowie zum Anlegen/Löschen eigener Quellen
  (`Settings`) – nutzt die bereits bestehenden `calendar_sources_insert_own`/`_delete_own`-Policies.
  Jede Quellenzeile hat einen eigenen „Aktualisieren"-Link, der per Supabase Edge Function
  (`supabase/functions/import-ics-source`) **nur diese eine Quelle** live neu importiert (siehe unten),
  und danach die Gremien-Liste neu lädt sowie prüft, ob angehakte `user_gremien`-Einträge noch in den
  aktuell importierten Sessions vorkommen – falls nicht, Warnhinweis (Häkchen bleibt trotzdem bestehen,
  für den Fall dass das Gremium später wieder importiert wird).
- Vollständiges DB-Schema inkl. RLS-Policies (`supabase/migrations/0001_init.sql`,
  `0002_sessions_ics_uid.sql`, `0003_sessions_ics_uid_constraint.sql`,
  `0004_sessions_source_cascade.sql`, `0005_user_gremien.sql`, `0006_calendar_sources_admin.sql`,
  `0007_fix_profiles_rls_recursion.sql`)
- **Wichtig für neue Policies:** Eine Policy auf `profiles`, die in ihrer eigenen USING-Klausel wieder
  `profiles` abfragt (z. B. `fraktion = (select fraktion from profiles where id = auth.uid())`), verursacht
  "infinite recursion detected in policy" (Postgres 42P17) – siehe `0007_fix_profiles_rls_recursion.sql`
  für den Fix per SECURITY DEFINER-Funktion (`current_user_fraktion()`). Gleiche Vorsicht gilt für jede
  neue Policy, die profiles per Subquery abfragt (z. B. Rollen-Checks wie in
  `0006_calendar_sources_admin.sql`) – funktioniert nur, weil `0007` die profiles-Policy selbst
  entschärft hat.
- Settings-Seite hat außerdem einen „Meine Gremien"-Bereich: Checkliste aller distinct
  `sessions.gremium`-Werte, Auswahl landet in `user_gremien` (user_id, gremium). Der Dashboard-Kalender
  (`CalendarView`) zeigt dadurch nur noch **zukünftige** Sitzungen (`datum >= now()`) der angehakten
  Gremien an – bei keiner Auswahl leer, mit Hinweis auf die Settings-Seite. „Eigene Termine" ist ebenso
  auf `start >= now()` gefiltert.
- Kalenderquellen können jetzt auch bearbeitet werden (Name/Ebene/ICS-URL, Inline-Formular in
  `Settings`), nicht nur angelegt/gelöscht. Nutzer mit `profiles.rolle = 'admin'` dürfen zusätzlich zu
  eigenen auch gemeinsam verwaltete Quellen (`verwaltet_von = null`, z. B. die vorkonfigurierte
  „Stadtrat Iserlohn") sowie fremde bearbeiten/löschen (`0006_calendar_sources_admin.sql`) – vorher war
  das für niemanden möglich, da `verwaltet_von = auth.uid()` bei `null` nie zutrifft. Um sich selbst zum
  Admin zu machen: `update public.profiles set rolle = 'admin' where id = auth.uid();` im SQL Editor.
- GitHub-Actions-Workflows: Deploy nach GitHub Pages, Supabase-Keep-Alive gegen das Auto-Pausieren im
  Free-Tier, **ICS-Import-Job** (`import-ics.yml`, täglich 04:00 UTC + manuell auslösbar) – lädt alle
  `calendar_sources`-Feeds via `node-ical` und upsertet sie in `sessions`
  (Skript: `scripts/import-ics.mjs`, Details in README.md Abschnitt 7). Läuft mit dem
  `SUPABASE_SERVICE_ROLE_KEY`-Secret, da `sessions` keine Insert/Update-Policy für normale Nutzer hat.
  Läuft auf Node 22 (nicht 20) – supabase-js initialisiert intern einen Realtime-Client, der unter
  Node 20 ohne natives WebSocket sofort crasht. Die Gremium-Extraktion aus `SUMMARY` ist an einem
  echten ALLRIS-Feed-Auszug verifiziert (KONZEPT.md Abschnitt 11): `SUMMARY` enthält dort direkt den
  Gremiumsnamen, keine „X – Sitzung"-Heuristik nötig. Ausnahme: manche SUMMARYs tragen eine
  **Anmerkung vor dem Gremiumsnamen** („Verschiebung auf den 12.11.2026 - Aufsichtsrat der
  Schillerplatz GmbH", „keine relevanten TOP´s - Verwaltungsrat Märkischer Stadtbetrieb
  Iserlohn/Hemer") – `extractGremium()` trennt solche bekannten Präfixe (Verschiebung/verschoben/
  keine relevanten TOPs/Absage/entfällt, je gefolgt von `-`) ab, damit daraus keine falschen
  Gremien-Einträge in der Meine-Gremien-Checkliste entstehen. Der `titel` behält bewusst den vollen
  SUMMARY-Text (die Anmerkung ist dort nützlich), nur `gremium` wird bereinigt; bereits falsch
  importierte Zeilen heilt der nächste Import-Lauf über den Upsert per `ics_uid`. Die Präfix-Liste
  (`ANMERKUNG_MIT_GREMIUM`) ist in `scripts/import-ics.mjs` **und**
  `supabase/functions/import-ics-source/index.ts` identisch gepflegt (Logik bewusst dupliziert).
  node-ical liefert Properties mit ICS-Parametern
  (z. B. `SUMMARY;LANGUAGE=de:...`) als `{params, val}`-Objekt statt String – wird über `toText()`
  normalisiert.
- **Supabase Edge Function** (`supabase/functions/import-ics-source/index.ts`, Deno) für den
  Einzel-Quellen-Reimport aus den Settings (siehe oben). Dupliziert die ICS-Parsing-Logik aus
  `scripts/import-ics.mjs` bewusst (Deno/Node-Kompatibilität, kein gemeinsames Build-Tooling). Braucht
  KEIN manuelles Service-Role-Key-Secret – Supabase injiziert `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
  automatisch in jede Edge Function. Deploy läuft über einen eigenen Workflow
  (`.github/workflows/deploy-edge-functions.yml`, nur bei Änderungen unter `supabase/functions/**`) via
  `supabase/setup-cli`, braucht dafür `SUPABASE_ACCESS_TOKEN` (Personal Access Token, nicht der
  Projekt-API-Key!) und `SUPABASE_PROJECT_REF` als Repository Secrets (siehe README.md Abschnitt 3,
  Schritt 6). Lokal mit `deno check --config supabase/functions/import-ics-source/deno.json
  supabase/functions/import-ics-source/index.ts` typprüfbar (Deno separat installieren, ist nicht Teil
  von `npm install`) – das eigene `deno.json` im Funktionsordner ist nötig, weil der Node-`package.json`
  im Repo-Root sonst Deno's Modul-Resolution durcheinanderbringt (`nodeModulesDir: "none"`).
- **Eigene Termine** lassen sich in `CalendarView` anlegen (Formular: Titel, Start, optional Ende,
  optional Ort). Nutzt die bereits bestehenden RLS-Policies `events_insert_own_or_fraktionsbuero`/
  `_update_own`/`_delete_own` – keine neue Migration für die Rechte nötig, nur `events.ort` kam per
  `0008_events_ort.sql` neu dazu (`sessions.ort` gab's schon). Neue Termine werden mit
  `herkunft = 'privat'` (Tabellen-Default) angelegt; vom Fraktionsbüro angelegte Termine
  (`herkunft = 'fraktionsbuero'`) sind laut KONZEPT.md Abschnitt 5.3 vom Mitglied genauso bearbeitbar,
  RLS unterscheidet hier nicht nach `herkunft`, nur nach `user_id = auth.uid()`.
- **„Nächste Termine"**: aggregierte, chronologisch sortierte Ansicht ganz oben in `CalendarView`, die
  `events` und `sessions` client-seitig zusammenführt (Titel, Start als Datum+Uhrzeit, Ort) und per
  ISO-8601-String-Vergleich sortiert (`a.start.localeCompare(b.start)`, funktioniert weil beide Felder
  bereits als ISO-Timestamp vorliegen). Ergänzt, nicht ersetzt die beiden Detail-Sektionen darunter
  („Eigene Termine", „Sitzungstermine").
- **Termindetails** leben als wiederverwendbare Präsentationskomponente in
  `src/components/TerminDetailPanel.tsx` (Props: `kind: 'event'|'session'`, `id`, optional
  `onDeleted`). Zeigt Titel/Start/Ende/Ort/Gremium je nach Typ; bei `kind=event` zusätzlich
  Bearbeiten/Absagen/Löschen (Inline-Formular). Darunter „Verknüpfte Aufgaben" (liest `todos` gefiltert
  nach `event_id`/`session_id` je nach `kind`, Klick öffnet dieselbe `TodoDetailModal` wie das ToDo-Board
  – das Panel hält dafür ein eigenes `openTodoId`-State, unabhängig vom Board) und „Notizen & Dokumente":
  nutzt die `summaries`-Tabelle (mit `event_id`-Spalte, `0009_summaries_termine.sql`) für Freitext-Notizen
  und Datei-Uploads. Dateien landen im privaten Storage-Bucket `zusammenfassungen` unter
  `<user_id>/<dateiname>` (RLS-Policies auf `storage.objects` scopen Zugriff auf den Uploader, per
  `(storage.foldername(name))[1] = auth.uid()::text`). Downloads laufen über `createSignedUrl()`
  (60s gültig), da das Bucket nicht public ist. Zwei Verwendungen:
  - **Inline/Split-View** in `CalendarView.tsx`: Klick auf einen Eintrag in „Nächste Termine" setzt
    `selected` und rendert das Panel in einer zweiten Spalte rechts daneben (kein Navigieren weg vom
    Dashboard), mit einem eigenen „Schließen"-Button oberhalb des Panels, der `selected` wieder auf
    `null` setzt. Einträge mit mindestens einer verknüpften `summaries`-Zeile (Notiz oder Dokument)
    bekommen ein 📎-Icon vor dem Titel – dafür lädt `CalendarView` einmalig alle `event_id`/`session_id`
    aus `summaries` in ein `notizenIds`-Set (`loadNotizenFlags()`, erneut aufgerufen beim Schließen/
    Löschen der Split-View, damit neu hinzugefügte Notizen sich zeitnah im Icon niederschlagen).
  - **Standalone-Seite** `src/pages/TerminDetail.tsx` (Route `/termin/:kind/:id`) als dünner Wrapper
    um dasselbe Panel – bleibt erhalten, weil `TodoDetailModal` (siehe unten) von dort aus auf
    verknüpfte Termine/Sitzungen verlinkt und dafür ein eigenständiges Ziel außerhalb des Modals
    braucht.
- **„Abgesagt" statt Löschen** (`0010_abgesagt_status.sql`): `sessions.status` hat jetzt zusätzlich
  `'abgesagt'`, `events` hat ein neues `status`-Feld (`'geplant'`/`'abgesagt'`, Default `'geplant'`).
  Grund: `summaries.event_id` hat `on delete cascade` – ein hart gelöschter Termin würde seine Notizen
  mitreißen, ein abgesagter nicht. `TerminDetail.tsx` hat für `kind=event` einen „Absagen"/„Reaktivieren"-
  Toggle zusätzlich zu „Löschen" (Absagen bleibt die empfohlene, nicht-destruktive Aktion). Sessions
  können nicht manuell abgesagt werden, nur der Import-Job setzt/entfernt diesen Status:
  - `scripts/import-ics.mjs` und `supabase/functions/import-ics-source/index.ts` laden vor dem Upsert
    die bestehenden `(ics_uid, status)`-Paare der Quelle, um danach zu erkennen, welche UIDs aus dem
    Feed verschwunden sind (= abgesagt) und welche zuvor abgesagten UIDs wieder normal auftauchen
    (= reaktiviert). `STATUS:CANCELLED` im Feed wird zusätzlich ausgewertet, verifiziert an einer
    synthetischen Test-ICS (der reale ALLRIS-Feed nutzt `STATUS` gar nicht, entfernt abgesagte Termine
    offenbar einfach aus dem Feed – „UID verschwunden" ist daher der wichtigere Erkennungsweg).
  - Diese Cancel/Uncancel-Updates laufen bewusst **getrennt** vom Haupt-Upsert (der `status` weiterhin
    nicht mitschickt, um einen manuell gesetzten `'aktiv'`-Status nicht zu überschreiben) – sonst hätte
    jede Zeile im Upsert-Array einen anderen Status gebraucht, was ein einzelner Bulk-Upsert nicht sauber
    abbilden kann.
  - `CalendarView.tsx` zeigt abgesagte Termine/Sitzungen weiterhin an (durchgestrichen, abgedunkelt,
    „· abgesagt"-Tag), blendet sie nicht aus – sonst wäre die Termindetailsicht mit den Notizen nicht
    mehr erreichbar.
- **ToDo-Board vollständig ausgebaut** (`0011_todo_board_ausbau.sql`, `0012_todo_board_settings.sql`):
  Spalten sind per UI anlegbar/umbenennbar (Klick auf Titel)/löschbar (mit Warnhinweis, da `column_id`
  `on delete cascade` hat, also Karten mitreißt)/verschiebbar (◀/▶-Buttons, tauschen `reihenfolge` mit
  dem Nachbarn – bewusst kein Drag-and-Drop für Spalten, um nicht zwei verschiedene
  dnd-kit-Draggable-Typen in einem DndContext mischen zu müssen). Diese Verwaltung sitzt bewusst **nicht**
  in `TodoBoard.tsx` selbst, sondern in einem neuen „ToDo-Board"-Abschnitt in `Settings.tsx` (gemeinsam
  mit den Checkboxen für Karten-Detail-Sichtbarkeit, `todo_board_settings`-Tabelle,
  `zeige_termin`/`zeige_zustaendig`) – das Board zeigt nur noch Spalten+Karten+Drag&Drop+Schnell-
  Erfassung, keine Struktur-Konfiguration mehr. Jeder Nutzer bekommt beim Signup automatisch vier
  Standard-Spalten (`handle_new_user()`-Trigger erweitert), bestehende Nutzer wurden per Migration
  nachgerüstet (nur falls sie noch keine eigenen Spalten hatten).
  - Karten: Schnellerfassung (nur Titel) direkt im Board, volle Bearbeitung als **Overlay/Modal**
    (`src/components/TodoDetailModal.tsx`, Props: `id`, `onClose`, `onChanged`) – öffnet sich bei Klick
    auf eine Karte (kein Navigieren weg vom Dashboard mehr; die frühere Standalone-Seite
    `src/pages/TodoDetail.tsx` unter `/todo/:id` wurde entfernt, es gibt keine Route mehr dafür). Anders
    als bei `TerminDetailPanel` gibt es hier **keinen** Lese-/Bearbeiten-Umschalter mehr – das Modal zeigt
    beim Öffnen direkt das editierbare Formular (Titel, Beschreibung, Zuständigkeit als Inputs), kein
    zusätzlicher „Bearbeiten"-Klick nötig. Inhalt: Titel, Beschreibung, Zuständigkeit (`zustaendig`,
    aktuell **Freitext**, bewusst noch keine echte Nutzer-Zuweisung, siehe unten), Termin-Verknüpfung
    (Radio: kein/Datum/eigener Termin/Sitzung – exklusiv, beim Speichern werden die jeweils anderen
    beiden Felder genullt; darunter ein „Aktuell verknüpft"-Link auf `/termin/:kind/:id`, der den
    **gespeicherten** Link zeigt, unabhängig vom gerade in Bearbeitung befindlichen Radio-Wert – die
    Standalone-Seite bleibt dafür also bewusst bestehen), Kommentare (Tabelle `todo_comments`) und
    Dokumenten-Upload (wiederverwendet `summaries` + Storage-Bucket `zusammenfassungen`, mit `todo_id`-
    Spalte – bewusst nur Datei-Upload, kein Freitext-Feld dort, um nicht mit den Kommentaren zu
    überlappen). Backdrop-Klick schließt das Modal (`stopPropagation` auf dem inneren Panel); Speichern/
    Löschen ruft `onChanged` bzw. schließt via `onClose`, statt zu navigieren. `TodoDetailModal` wird an
    zwei Stellen instanziiert, jeweils mit eigenem `openTodoId`-State: `TodoBoard.tsx` (Kartenklick, lädt
    nach Änderungen per `onChanged={load}` neu) und `TerminDetailPanel.tsx` (Klick auf eine „Verknüpfte
    Aufgabe", siehe oben).
  - Karte springt beim Verknüpfen eines Datums/Termins automatisch von einer Spalte namens „Neu" in
    eine Spalte namens „Geplant" (Titel-Matching, case-insensitive – greift nicht mehr, falls der Nutzer
    die Spalten umbenennt; bewusst so vereinfacht, da Spalten frei umbenennbar sind und es keine
    stabile ID für „die Neu-Spalte" gibt).
  - RLS/Sichtbarkeit bleibt unverändert „rein privat" (`todos_manage_own`), da Zuständigkeit nur
    Freitext ist. `todo_comments`-Policy hängt an der Eigentümerschaft der zugehörigen Karte
    (`exists (select ... from todos where id = todo_id and user_id = auth.uid())`), nicht an einer
    eigenen Nutzer-Referenz.
- **Dashboard-Layout umgebaut** (`Dashboard.tsx`): Kein 2-Spalten-Grid mehr. ToDo-Board sitzt jetzt ganz
  oben, volle Breite. `CalendarView.tsx` wurde radikal eingedampft – zeigt nur noch den
  „Nächste Termine"-Block (die alten Sektionen „Eigene Termine" und „Sitzungstermine (importiert)"
  wurden komplett entfernt, die aggregierte Liste deckt beides ab). Liste ist auf
  `max-h-72 overflow-y-auto` begrenzt (~5 Einträge sichtbar, Rest scrollbar). Termin-Anlegen-Formular
  ist jetzt hinter einem „+ Termin"-Button versteckt (`showAddForm`-Toggle) statt permanent sichtbar.
- **Klick-Interaktionen statt Navigation** (Vorgabe: Karten sollen als Overlay/Modal editierbar sein,
  Termine sollen Details in einer Split-View rechts daneben zeigen, ohne das Dashboard zu verlassen):
  ToDo-Karten öffnen `TodoDetailModal` als Overlay, „Nächste Termine"-Einträge öffnen
  `TerminDetailPanel` in einer zweiten Spalte rechts neben der Liste (`CalendarView.tsx` ist dafür
  `flex gap-6` mit zwei `flex-1 max-w-md`-Spalten; ausgewählter Eintrag bekommt `ring-2` als
  Selektions-Indikator). Details zu beiden Komponenten siehe „Termindetails" und „ToDo-Board vollständig
  ausgebaut" oben.
- **Nutzerprofil** (`0013_profile_foto.sql`): `profiles` hatte bereits `name`, dazu kam `foto_url` (Pfad
  im neuen privaten Storage-Bucket `profilbilder`, gleiches `<user_id>/<dateiname>`-Muster wie
  `zusammenfassungen`, RLS-Policies analog). Profil-Sektion ganz oben in `Settings.tsx`: Avatar (Foto oder
  Initialen-Fallback aus dem ersten Buchstaben des Namens), Datei-Upload mit separatem „Foto hochladen"-
  Button (kein Auto-Upload bei Dateiauswahl), Name-Feld mit eigenem „Speichern". Bei neuem Foto wird die
  alte Datei aus dem Bucket gelöscht (`storage.remove()`), damit dort nicht mehrere alte Profilbilder
  liegen bleiben. `Dashboard.tsx` lädt `name`/`foto_url` schreibgeschützt fürs Header („MandatsCockpit -
  Name" statt nur „MandatsCockpit", kleiner Avatar links daneben) – eigener, unabhängiger Ladeaufruf statt
  einer gemeinsamen Hook/Komponente, konsistent mit dem Rest der Codebase (jede Komponente lädt ihre
  Daten selbst). Signed URLs für Fotos laufen mit 3600s Gültigkeit (länger als die 60s bei
  Dokument-Downloads), weil das Foto dauerhaft als `<img>` im Header/in den Settings sichtbar ist statt
  nur einmalig angeklickt zu werden.

- **Partei-Theming** (`0014_profiles_partei.sql`): Das UI lässt sich je nach Partei des Mandatsträgers
  im Partei-CI darstellen (CDU/SPD/FDP/Grüne/Linke/AfD + neutral). Architektur:
  - `profiles.partei` (Text, nullable, bewusst **ohne** CHECK-Constraint und bewusst getrennt von
    `fraktion`, das RLS-Semantik trägt) speichert die Theme-Id. **Nur Admins setzen sie**, beim Anlegen
    oder Bearbeiten eines Nutzers in der Benutzerverwaltung (`UserManagement.tsx`/`admin-users`-Function)
    – Mitglieder sehen ihre Partei im Profil-Bereich der Settings nur noch als reinen Anzeigetext
    („Wird von einem Admin in der Benutzerverwaltung festgelegt."), ohne Möglichkeit sie selbst zu
    ändern (bewusste Entscheidung: Partei-Zuordnung ist keine Selbstauskunft). `ThemeLoader.tsx` liest
    den Wert weiterhin bei jedem Login unverändert aus dem Profil.
  - Farb-Tokens als CSS-Variablen in `src/index.css` (`:root` = neutral, `[data-theme='cdu']` etc.;
    RGB-Tripel wegen Tailwind-Alpha), Tailwind-Farben `primary`/`primary-hover`/`accent`/`topbar` in
    `tailwind.config.js` via `rgb(var(--mc-*) / <alpha-value>)`. Fokus-Ringe und
    Checkbox/Radio-`accent-color` sind global im `@layer base` von index.css gethemed.
  - `src/lib/themes.ts`: Registry (Id, Label, Logo-Datei) + `applyTheme()` (setzt `data-theme` auf
    `<html>`); `src/components/ThemeLoader.tsx` (in App.tsx gemountet) lädt die Partei einmalig aus dem
    Profil. Neues Theme = CSS-Block + Registry-Eintrag + Logo-SVG, keine Migration nötig.
  - Partei-Logos (von Wikimedia Commons, offizielle SVGs) unter `public/parteilogos/*.svg`, werden
    rechts im Dashboard-Header angezeigt. Farbwerte an den echten Partei-Websites verifiziert
    (cdu-iserlohn.de: Türkis #52b7c1; fdp.de: #2b4b9f/#eb008b/Gelb; SPD-Rot #e3000f). FDP-Topbar ist
    Gelb, AfD-Primary ist gegenüber dem CI-Hellblau abgedunkelt (AA-Kontrast für weiße Button-Texte).
  - Alle Primär-Buttons nutzen `bg-primary hover:bg-primary-hover`, Selektions-Ringe `ring-primary`,
    jede Seite hat eine 1,5px-Akzentleiste (`bg-topbar`) ganz oben.
- **UX-Feinschliff** (zusammen mit dem Theming): Einträge in „Nächste Termine" sind zweizeilig
  (Titel+Tags oben, Datum·Ort darunter, `truncate` statt Umbruch-Chaos); Datums-/Zeitangaben laufen
  zentral über `src/lib/format.ts` (`formatDateTime`/`formatDate`/`formatTime`/`formatDayMonth`,
  ohne Sekunden).
- **UI-Redesign** („Wow"-Polish, nach dem ersten Theming-Wurf): Das Partei-Theme trägt jetzt durchs
  ganze UI, nicht nur Logo+Topbar.
  - **Schrift:** Inter Variable via `@fontsource-variable/inter` (Import in `main.tsx`,
    `fontFamily.sans` in `tailwind.config.js`), wird von Vite mit gebündelt (kein CDN, passt zu
    GitHub-Pages-Hosting).
  - **Gemeinsames Komponenten-Vokabular** in `src/index.css` `@layer components`: `.mc-card`
    (rounded-xl, border, shadow-sm), `.mc-input`, `.mc-btn` (Press-Feedback `active:scale(0.97)` bei
    160ms mit kräftiger ease-out-Kurve `--mc-ease-out`), `.mc-btn-primary`/`-ghost`/`-danger`.
    Kleine Varianten in Listen per `!px-2 !py-1 !text-xs`-Overrides. Bewusst zentral statt
    Utility-Wiederholung in jedem JSX, damit alle Flächen identisch aussehen/reagieren; Layout bleibt
    Utilities im JSX (CLAUDE.md-Konvention „keine CSS-Datei pro Komponente" bleibt gewahrt).
  - **Entrance-Animationen** (`mc-animate-fade/-pop/-slide`, nur transform+opacity, nie aus scale(0),
    220-240ms): Modal poppt (Backdrop `bg-slate-900/50` + `backdrop-blur-[2px]` + Fade), Split-View-
    Panel slidet von rechts ein (per `key` auf dem Panel-Container re-triggert bei Terminwechsel).
    `prefers-reduced-motion` fällt auf reinen Opacity-Fade zurück.
  - **App-Bar:** Alle Seiten (Dashboard, Settings, TerminDetail) haben statt des weißen Headers eine
    Partei-farbige Leiste (`bg-gradient-to-r from-primary to-primary-hover`, weiße Schrift, Avatar mit
    `ring-white/40`, Partei-Logo auf weißem Chip rechts), darüber weiterhin die `bg-topbar`-Akzentlinie
    (FDP: Gelb über Blau). Content in `max-w-7xl mx-auto`.
  - **Terminliste:** Einträge als Karten mit Datums-Chip links (Tag+Kurzmonat, `bg-primary/10
    text-primary`, abgesagt: rot getönt), Titel + SITZUNG/ABGESAGT-Badges, Zeit·Ort-Zeile;
    Selektion `ring-2 ring-primary`. Empty-States als gestrichelte Platzhalterflächen.
  - **Board:** Spalten `bg-slate-200/50 rounded-xl` mit Karten-Count-Badge, Karten mit
    Hover-Schatten-Lift und Chip-Metadaten (📅 Termin primary-getönt, 👤 Zuständig), Drag-Zustand
    `ring-primary/40`; „+ Karte hinzufügen" als gestricheltes Ghost-Input.
  - Modal-/Panel-Innensektionen (Formulare, Kommentar-/Dokument-Listen) als `bg-slate-50`-Karten auf
    weißem Grund; Login als zentrierte Card. Alle sechs Themes + neutral im Browser verifiziert.
- **Settings mit Sidebar-Unternavigation** (`Settings.tsx`): Die Seite ist in Sektionen gegliedert
  (Profil / Kalenderquellen / Meine Gremien / ToDo-Board / Benutzerverwaltung), die über eine linke
  Sidebar (Lucide-Icons via `lucide-react`, aktiver Punkt `bg-primary/10 text-primary`; mobil
  horizontal scrollbar) umgeschaltet werden – reines Conditional-Rendering über ein
  `activeSection`-State, alle Lade-/Speicherlogik blieb unverändert. „Eigene Quelle hinzufügen" lebt
  im Kalenderquellen-Tab (zwei getrennte Conditional-Blöcke im JSX, Quellcode-Reihenfolge ist durchs
  Conditional-Rendering fürs UI egal). „Benutzerverwaltung" erscheint nur bei `profiles.rolle='admin'`.
- **Admin-Benutzerverwaltung** (`src/components/UserManagement.tsx` + Edge Function
  `supabase/functions/admin-users/index.ts`): Anlegen/Bearbeiten/Löschen von Benutzern läuft komplett
  über die Edge Function, weil die Auth-Admin-API den Service-Role-Key braucht (bleibt serverseitig).
  Die Function verifiziert den Caller-JWT und verlangt `profiles.rolle='admin'` (RLS greift bei
  Service-Role nicht – dieser Check ist die Zugriffskontrolle). API: action `list` (auth.users +
  profiles gemerged, inkl. `last_sign_in_at`), `create` (email/password/name, `email_confirm: true`,
  Profil legt der `handle_new_user`-Trigger an, Rolle/Fraktion/Partei werden nachgezogen), `update`
  (Profilfelder + optional E-Mail/Passwort via `updateUserById`; der letzte Admin kann sich nicht
  selbst degradieren), `delete` (verboten für sich selbst; bereinigt vorher
  `calendar_sources.verwaltet_von` → null und biegt `events.erstellt_von` bei Fraktionsbüro-Terminen
  auf den Termininhaber um – beide FKs sind NICHT on delete cascade und würden sonst blocken – und
  löscht die Storage-Dateien des Nutzers aus `profilbilder`/`zusammenfassungen`; Rest cascaded über
  `profiles`). Der Deploy-Workflow (`deploy-edge-functions.yml`) deployt seitdem **alle** Funktionen
  (`supabase functions deploy` ohne Namen). UI: Nutzerliste mit Rollen-Badges
  (Admin=primary-getönt, Fraktionsbüro=amber, Mitglied=slate), Partei-Badge, „Du"-Kennzeichnung,
  Anlege-/Bearbeiten-Formular (`UserForm`, 2-spaltiges Grid), Selbst-Löschen-Button disabled.

- **Quellen-Farben & Ebenen-Kennzeichnung** (`0015_calendar_sources_farbe.sql`):
  `calendar_sources.farbe` speichert eine Token-Id aus der kuratierten Palette in
  `src/lib/sourceColors.ts` (sky/emerald/amber/violet/rose/teal als `SOURCE_COLORS`, bewusst gedeckte
  Töne, die mit jedem Partei-Theme harmonieren; Klassen ausgeschrieben wegen Tailwind-Purge). `null` =
  `THEME_COLOR` (bg-primary/10) – Quellen ohne Farbe und eigene Termine folgen damit automatisch dem
  Partei-CI. Farbwahl per Swatch-Reihe in der Quellenzeile der Settings (nur `canManage`, optimistisches
  Update). In der Dashboard-Terminliste tragen Sitzungen den Datums-Chip und ein **Ebene-Badge**
  (KOMMUNE/KREIS/LAND/BUND aus `EBENE_LABEL`) in der Quellfarbe – die Ebene ist so auf einen Blick
  erkennbar; `CalendarView` lädt dafür zusätzlich alle `calendar_sources`. Die Quellenzeile in den
  Settings ist zweizeilig (Name+Ebene-Badge+Abonniert-Checkbox oben, Farbe+Aktionen unten), damit
  lange Quellnamen nicht abgeschnitten werden.
- **Meine Gremien nach Quellen gruppiert**: `loadDistinctGremien()` liefert distinct
  `(gremium, source_id)`-Paare; die Checkliste rendert pro Quelle eine Gruppe (Header mit Farbpunkt,
  Quellname, Ebene-Badge), nicht zuordenbare Gremien landen in „Ohne Quelle". Die Auswahl selbst
  bleibt gremium-Text-basiert (`user_gremien` unverändert).
- **ToDo-Board ohne Horizontal-Scroll**: Der Spalten-Container ist ein CSS-Grid
  (`repeat(auto-fill, minmax(272px, 1fr))`) statt `flex overflow-x-auto` – viele Spalten brechen in
  weitere Zeilen um, wenige teilen sich die Breite. Drag & Drop über Zeilen hinweg funktioniert, weil
  dnd-kit rein pointer-basiert droppt.
- **Drag & Drop auf Touch-Geräten (iPad)** (`TodoBoard.tsx`): Karten ließen sich auf dem iPad nicht per
  Finger ziehen. Zwei Ursachen behoben: (1) `useSensors` nutzte nur `PointerSensor`, der auf iPadOS
  Safari oft mit der nativen Scroll-Erkennung kollidiert; jetzt `MouseSensor` (Maus, `distance: 8`) +
  `TouchSensor` (Touch, `delay: 200, tolerance: 8`) – Maus- und Touch-Events feuern nie für dieselbe
  Interaktion, daher keine Doppel-Aktivierung, und der `delay` gibt Safari kurz Zeit, zwischen Scrollen
  und Ziehen zu unterscheiden (gleiches Sensor-Paar wie in der offiziellen dnd-kit-Doku für
  Cross-Device-Support empfohlen). (2) Der Karte fehlte `touch-action: none` – ohne das interpretiert
  Safari eine Berührung sofort als Scroll-Geste, bevor der Sensor den Drag überhaupt erkennen kann.
- **Board-Feinschliff** (`TodoBoard.tsx`): Drei Verhaltensänderungen, alle über Titel-Matching der
  Spalten (case-insensitive, gleiches Muster wie der bestehende „Neu"→„Geplant"-Auto-Move in
  `TodoDetailModal.tsx` – greift nicht mehr, falls der Nutzer diese Spalten umbenennt):
  - **Neue Karten nur in der Spalte „Neu"**: Das „+ Karte hinzufügen"-Eingabefeld erscheint nur noch in
    der Spalte, deren Titel „neu" ist (`neuColumn`); ohne passenden Namen fällt es auf die erste Spalte
    nach `reihenfolge` zurück, damit Karten-Erfassung nie ganz verschwindet. Andere Spalten zeigen kein
    Eingabefeld mehr.
  - **Durchgestrichener Titel in „Fertig"**: Jede `Column` weiß über `istFertig` (Titel-Match), ob sie
    die Fertig-Spalte ist, und reicht das an `Card` durch – der Kartentitel wird dann durchgestrichen
    und ausgegraut dargestellt (rein visuell, `todos` selbst hat kein „erledigt"-Feld).
  - **Termin-Label statt „📅 Termin"**: Karten zeigen jetzt Titel + Datum des verknüpften Termins
    (`Sportausschuss · 10.09.2026`) statt eines nichtssagenden Chips. Dafür lädt `TodoBoard` gezielt nur
    die von aktuell sichtbaren Karten referenzierten `events`/`sessions` (per `event_id`/`session_id` in
    einem `useEffect([todos])`, `.in('id', [...])` statt Volltabellen) in `eventById`/`sessionById`-Maps;
    `terminLabelFor()` liefert je nach Verknüpfung `"<Titel> · <Datum>"` oder bei reinem Freitextdatum
    (`faellig_am`, keine Verknüpfung) `"Fällig <Datum>"`.
- **Termin-Filter + Breitenangleich** (`CalendarView.tsx`): Über der „Nächste Termine"-Liste erscheinen
  Filter-Chips – „Alle" immer, „Eigene Termine" nur wenn eigene Termine existieren, je eine Ebene
  (Kommune/Kreis/Land/Bund) nur wenn sie unter den aktuell geladenen Sitzungen tatsächlich vorkommt
  (keine wirkungslosen Filter). Die beiden Spalten (Terminliste + Detail-Panel) haben ihr `max-w-lg`
  verloren und sind jetzt reines `flex-1 min-w-0` – dadurch spannt die Sektion exakt so breit wie das
  ToDo-Board darüber, und die rechte Kante des Detail-Panels liegt auf einer Linie mit der letzten
  Board-Spalte und dem Partei-Logo im Header (gleicher `mx-auto max-w-7xl px-6`-Container).
- **Dokumenten-Vorschau** (`src/components/DocumentPreviewModal.tsx`): Klick auf ein hochgeladenes
  Dokument (in `TodoDetailModal.tsx` und `TerminDetailPanel.tsx`, beide identisch verdrahtet über ein
  `previewDoc`-State) öffnet ein Modal statt eines Downloads/neuen Tabs. Bilder (`png/jpg/jpeg/gif/
  webp/svg`) werden als `<img>` gerendert, PDFs im nativen Browser-PDF-Viewer per `<iframe>`; für alle
  anderen Dateitypen (docx, xlsx, ...) gibt es keine Inline-Vorschau im Browser, stattdessen ein
  „Datei öffnen"-Link. Signierte URL mit 3600s Gültigkeit statt der sonst bei Downloads üblichen 60s,
  weil das Dokument während des Lesens länger geöffnet bleiben kann (gleiche Überlegung wie bei
  Profilfotos). Ersetzt das alte `handleDownload()` (signierte URL + `window.open` in neuem Tab) in
  beiden Komponenten vollständig.
- **Archiv** (`src/pages/Archiv.tsx`, Route `/archiv`, verlinkt im Dashboard-Header neben
  „Einstellungen"): Drei Tabs, kein neues Datenmodell nötig.
  - **Vergangene Sitzungen**: gleiche Query wie `CalendarView` (Sitzungen der „Meine Gremien"-Auswahl),
    nur mit `lt('datum', startOfTodayIso())` statt `gte()` und absteigend sortiert. Identisches
    Karten-Design (Datums-Chip in Quellfarbe, Ebene-Badge, 📎-Notizen-Flag, Abgesagt-Badge) und
    Split-View mit `TerminDetailPanel` (`onDeleted` bewusst weggelassen – im Archiv gibt es keine
    Lösch-Aktion, `TerminDetailPanel` zeigt für `kind='session'` ohnehin keine Bearbeiten/Löschen-Buttons,
    nur für `kind='event'`). `startOfTodayIso()` ist dafür von `CalendarView.tsx` nach `lib/format.ts`
    gewandert (jetzt von beiden importiert, keine Dopplung mehr).
  - **Erledigte Aufgaben**: `todos`, deren `column_id` zu einer Spalte mit Titel „Fertig" gehört
    (gleiches Titel-Matching wie die Fertig-Durchstreichung im Board, siehe oben) – funktioniert ohne
    Migration, weil Karten beim Ziehen auf „Fertig" nicht aus `todos` verschwinden, nur die
    `column_id` ändert sich. Klick öffnet die normale `TodoDetailModal` (volle Bearbeitung inkl.
    Termin-Verknüpfung bleibt möglich, nur die Spalte lässt sich dort nicht ändern – das geht nach wie
    vor nur per Drag & Drop auf dem Board). `TodoRow` hat dafür ein neues `created_at`-Feld im
    TS-Typ bekommen (Spalte existierte in der DB schon immer, war im Typ nur nicht abgebildet) – zeigt
    in der Archiv-Liste als „Erstellt am".
  - **Dokumente**: Übersicht aller `summaries`-Zeilen mit gesetztem `datei_url` (also echte
    Datei-Uploads, keine reinen Text-Notizen), absteigend nach `erstellt_am`. Da `summaries` optional an
    Sitzung, Termin **oder** Aufgabe hängt (`session_id`/`event_id`/`todo_id`), lädt `loadDocuments()`
    für jede in der Liste tatsächlich vorkommende Referenz gezielt die Titel nach (drei kleine
    `.in('id', [...])`-Queries statt eines Joins) und baut daraus ein `docLabels`-Map
    (`"Sitzung: <Titel>"` / `"Termin: <Titel>"` / `"Aufgabe: <Titel>"`, Dokumente ganz ohne Bezug zeigen
    kein Badge). Klick auf ein Dokument öffnet dieselbe `DocumentPreviewModal` wie überall sonst im
    UI. `fileNameFromPath()` ist dafür aus `DocumentPreviewModal.tsx` heraus **exportiert** und wird
    jetzt dort sowie von `TerminDetailPanel.tsx`/`TodoDetailModal.tsx` importiert statt dreifach
    dupliziert zu sein (bei zwei Stellen war die Dopplung tolerierbar, bei drei nicht mehr).
  - Bewusst nicht enthalten: eigene vergangene Termine (`events`) als eigener Tab. Der ursprüngliche
    Wunsch war explizit „zurückliegende Sitzungen und erledigte Tasks"; eigene Termine landen nicht im
    Archiv, um den Scope nicht stillschweigend zu erweitern.
- **GitHub-Pages-Routing-Fix** (`.github/workflows/deploy.yml`): Ein Reload oder Direktaufruf einer
  Unterroute wie `/settings` oder `/archiv` lieferte 404 – GitHub Pages ist ein statischer Host und
  sucht nach einer echten Datei an diesem Pfad, bevor die SPA (und damit React Router) überhaupt lädt.
  Fix: Der Deploy-Workflow kopiert nach dem Build `dist/index.html` nach `dist/404.html` (`cp dist/
  index.html dist/404.html`, direkt vor dem Artifact-Upload). GitHub Pages liefert `404.html` für jeden
  unbekannten Pfad aus; da Vite mit `base: '/mandatscockpit/'` baut, sind alle Asset-Pfade in `index.html`
  absolut und laden unabhängig vom Tiefen-Pfad korrekt – React Router übernimmt danach normal anhand der
  Browser-URL. Kein `HashRouter`/`basename`-Wechsel nötig, nur dieser eine Build-Schritt.
- **MCP-Server für Claude-Steuerung** (`supabase/functions/mcp-server/index.ts`, Route 9 in README.md):
  Dritte Edge Function, implementiert das MCP-JSON-RPC-Protokoll (`initialize`/`tools/list`/
  `tools/call`) von Hand über einen einzigen HTTP-POST-Endpunkt (kein SSE-Streaming nötig, da alle
  Tools synchron antworten) – es gibt kein fertiges Supabase/Deno-MCP-Template dafür. Tools:
  `create_todo` (sucht/legt `todo_columns` per Titel case-insensitive an, hängt hinten in der Spalte
  an), `create_event` (`herkunft = 'privat'`), `list_next_sessions` (zukünftige Sitzungen, optional
  `gremium`-Teilstring-Filter per `ilike`), `create_session_note` (Nutzerwunsch: „ein Sammeldokument
  analysieren und zusammenfassen lassen und dann hochladen zu einer bestimmten Sitzung“ – die
  eigentliche Analyse macht Claude direkt im Chat als LLM, das Tool speichert nur das fertige
  Ergebnis; ursprünglich `create_session_summary` und reiner Freitext, auf Nutzerwunsch umbenannt und
  um Datei-Anhänge erweitert). Insert in `summaries` mit `session_id` + `inhalt` und/oder `datei_url`
  (mindestens eins von beidem erforderlich, gleiche Kombinierbarkeit wie im „Notizen & Dokumente“-
  Formular in `TerminDetailPanel.tsx`). Datei-Anhänge kommen als `dateiname` + `datei_base64`
  (Base64-String) im Tool-Argument an, werden per `atob()` zu `Uint8Array` dekodiert und wie bei den
  Upload-Flows im Frontend unter `<user_id>/<Date.now()>-<dateiname>` in den privaten Storage-Bucket
  `zusammenfassungen` hochgeladen (Service-Role-Client umgeht die Storage-RLS-Policies dabei bewusst,
  gleiches Muster wie überall sonst in dieser Function). Praktisches Limit durch das
  Edge-Function-Request-Limit plus ca. 33 % Base64-Overhead - nicht separat validiert, nur in der
  Tool-Beschreibung erwähnt. Ob Claude beim Chat-Aufruf tatsächlich die Rohbytes einer im Chat
  angehängten Datei als Base64 überträgt, war zum Zeitpunkt der Implementierung nicht verifizierbar
  (kein Testtoken ohne das aktive Nutzer-Token zu gefährden) - noch nicht live erprobt. Prüft vorher
  per Select, ob die `session_id` existiert, für eine verständliche Fehlermeldung statt eines rohen
  FK-Constraint-Fehlers.
  - **Auth bewusst nicht global, sondern pro Nutzer**: Ursprünglich als Einzelnutzer-Lösung mit einem
    einzigen `MCP_ACCESS_TOKEN`-Secret geplant, dann auf Nutzerwunsch umgestellt auf **ein persönliches
    Bearer-Token pro Mitglied**, da die Function für alle Mitglieder nutzbar sein soll, nicht nur für
    den Repo-Owner. Neue Tabelle `mcp_tokens` (`0016_mcp_tokens.sql`, `user_id` Primary Key, RLS
    `user_id = auth.uid()` **ohne** die Fraktions-Ausnahme von `profiles_select_own_or_same_fraktion` –
    ein Fraktionsbüro darf zwar Termine für Kolleg*innen anlegen, aber nicht deren MCP-Token einsehen).
    Gespeichert wird nur `token_hash` (SHA-256), nie der Klartext – die Function hasht das eingehende
    Bearer-Token identisch (`crypto.subtle.digest`) und schlägt damit den Nutzer nach; alle
    DB-Operationen laufen danach über `SUPABASE_SERVICE_ROLE_KEY` im Namen dieses einen Nutzers (RLS
    wird hier also bewusst durch den Token-Lookup ersetzt, gleiches Muster wie `admin-users`).
  - **Selbstbedienung in Settings** (`Settings.tsx`, Sidebar-Sektion „MCP Connection“ (ursprünglich
    „Claude-Integration“, auf Nutzerwunsch umbenannt), Icon
    `Bot`): Jedes Mitglied erzeugt/erneuert sein Token selbst (`crypto.getRandomValues` → `mck_`-Präfix
    + Base64url, gleiche `sha256Hex()`-Funktion wie in der Edge Function dupliziert – bewusst wie bei
    der ICS-Parsing-Logik, da Browser- und Deno-Crypto-API zwar ähnlich, aber unterschiedliche Module
    sind). Der Klartext-Token wird nur direkt nach dem Erzeugen einmalig angezeigt (State
    `mcpGeneratedToken`, nicht persistiert) – ein Neuladen der Seite zeigt ihn nicht erneut, nur noch
    das Erzeugungsdatum. Ein neues Token zu erzeugen macht das alte sofort ungültig (Primary Key
    `user_id`, `upsert` überschreibt den Hash).
  - Setup/Custom-Connector-Anleitung für Nutzer in README.md Abschnitt 9. Deploy läuft ohne weitere
    Anpassung über den bestehenden `deploy-edge-functions.yml`-Workflow mit (deployt alle Functions
    unter `supabase/functions/` ohne Namen) – bewusst **keine** zweite Workflow-Datei angelegt, das
    hätte nur doppelte Deploy-Läufe erzeugt.
  - **Drei Produktivfehler nach dem ersten Rollout entdeckt und behoben (2026-07-20), alle beim ersten
    echten Connector-Versuch aufgefallen:**
    1. Supabase prüft den `Authorization`-Header von Edge Functions standardmäßig selbst als
       Supabase-Auth-JWT, bevor die Function überhaupt läuft (`verify_jwt`, Default `true`) – jedes
       eigene Token wurde dadurch schon vom API-Gateway mit `UNAUTHORIZED_INVALID_JWT_FORMAT`
       abgewiesen. Fix: `supabase/config.toml` mit `[functions.mcp-server] verify_jwt = false` (nur für
       diese eine Function – `admin-users`/`import-ics-source` bleiben beim Default, da sie mit dem
       echten Nutzer-JWT aus dem Frontend aufgerufen werden). Per curl gegen die deployte Function
       verifiziert (`UNAUTHORIZED_INVALID_JWT_FORMAT` vom Gateway davor vs. eigene Fehlermeldung der
       Function danach).
    2. **Falsche Annahme im ursprünglichen Auftrag** („Connectors → Custom Connector → Funktions-URL +
       Bearer-Token“) stimmte nicht mit der echten Claude-UI überein: Der Custom-Connector-Dialog hat
       nur ein **einzelnes URL-Feld**, kein separates Token-/API-Key-Feld (nur eine optionale
       OAuth-Client-ID für Server, die echtes OAuth 2.1 mit Dynamic Client Registration sprechen – ein
       voller OAuth-Server ist für den Scope hier bewusst nicht gebaut worden). Fix: Das Token wird
       jetzt als `?token=...`-Query-Parameter direkt in die URL codiert; `mcp-server/index.ts` liest es
       dort aus (Header bleibt zusätzlich als Fallback unterstützt, falls ein anderer MCP-Client ihn
       setzen kann – Header hat Vorrang). `Settings.tsx` zeigt entsprechend die **komplette Connector-URL
       mit eingebettetem Token** an (`mcpConnectorUrl()`), nicht mehr den nackten Token – Nutzer fügen
       diese eine URL 1:1 in das URL-Feld des Custom Connectors ein.
    3. Trotz korrekter URL+Token weiterhin derselbe Fehler in Claude: „Registrierung beim Anmeldedienst
       von MandatsCockpit fehlgeschlagen“. Ursache: Claudes MCP-Client startet einen
       OAuth-Registrierungsversuch, sobald der Server **irgendwann** mit HTTP 401 antwortet (Standard-
       verhalten laut MCP-Authorization-Spezifikation, unabhängig davon, ob ein späterer Aufruf mit
       gültigem Token funktioniert hätte) – vermutlich bei einem initialen Capability-Check, der die
       Query-String-URL nicht wie erwartet weiterreicht. Die Function gab bei fehlendem/ungültigem
       Token bis dahin `401` + `WWW-Authenticate: Bearer` zurück, was genau dieses OAuth-Discovery
       auslöst; ein eigener OAuth-Server ist für diesen Scope bewusst nicht gebaut. Fix: `mcp-server`
       gibt bei Auth-Fehlern jetzt **nie mehr HTTP 401**, sondern immer HTTP 200 mit einem
       JSON-RPC-Fehler (`code: -32001`) im Body – Body-Parsing läuft daher jetzt **vor** dem
       Auth-Check (wird für die `id` im Fehlerobjekt gebraucht). Per curl gegenverifiziert: alle
       Antworten (fehlendes Token, ungültiges Token, GET-Probe) liefern seitdem keinen 401/
       `WWW-Authenticate` mehr.

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

## Setup

Siehe [README.md](./README.md) für Installation, Umgebungsvariablen und Deployment.
