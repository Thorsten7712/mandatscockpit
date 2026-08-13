# Entwicklungshistorie

Chronologisches Protokoll aller Features, Bugfixes und Entscheidungen im MandatsCockpit-Projekt,
jeweils inklusive Begründung (Nutzerwunsch, Bug-Root-Cause, Nachbesserungen). Diese Datei ist das
Gedächtnis des Projekts für **warum** etwas so gebaut wurde, wie es gebaut wurde – bei Unsicherheit
über eine bestehende Design-Entscheidung hier nachschlagen, bevor sie geändert wird.

Der aktuelle, knapp gehaltene Architektur-/Feature-Überblick sowie die daraus destillierten
technischen Fallstricke und Konventionen stehen in [`CLAUDE.md`](../CLAUDE.md) – diese Datei muss
für die tägliche Arbeit **nicht** gelesen werden, außer die Historie zu einem konkreten Punkt ist
gefragt.

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
  FK-Constraint-Fehlers), sowie `create_event_note`/`create_todo_note` (Nutzerwunsch: dieselbe
  Notiz-/Datei-Anhang-Funktionalität auch für eigene Termine und ToDo-Karten, nicht nur Sitzungen -
  spiegelt genau, was `TerminDetailPanel.tsx`/`TodoDetailModal.tsx` in der Web-UI schon können). Die
  drei Note-Tools teilen sich eine gemeinsame `createNote()`-Hilfsfunktion (`NoteTargetConfig` mit
  `idArgName`/`table`/`idColumn`/`ownerScoped`/`label`), um die Text-/Datei-Validierung und den
  Storage-Upload nicht dreifach zu duplizieren. Wichtiger Unterschied zu `create_session_note`:
  `events`/`todos` gehören einem einzelnen Nutzer (RLS `events_select_own`/`todos_manage_own`), der
  Service-Role-Client umgeht diese RLS aber komplett - `createNote()` filtert deshalb bei
  `ownerScoped: true` zusätzlich per `.eq('user_id', userId)` beim Ziel-Lookup, sonst könnte ein Nutzer
  über eine erratene UUID Notizen an fremde Termine/ToDos hängen. `sessions` bleibt bei
  `ownerScoped: false`, da Sitzungen laut `sessions_select_all` ohnehin für alle eingeloggten Nutzer
  lesbar sind.
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
  - **Fünf Produktivfehler nach dem ersten Rollout entdeckt und behoben (2026-07-20), alle beim ersten
    echten Connector-Versuch bzw. bei erneutem Verbinden aufgefallen:**
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
    4. Nach Hinzufügen von `create_session_note` funktionierte das erneute Verbinden trotz nachweislich
       korrektem Server wieder nicht (per curl mit dem echten Nutzer-Token direkt gegen die deployte
       Function verifiziert: `initialize`/`tools/list` liefen einwandfrei). Ursache diesmal:
       `resources/list`, `prompts/list` und andere von uns nicht unterstützte JSON-RPC-Methoden (die
       Claude beim Verbinden offenbar unabhängig von den in `initialize` deklarierten `capabilities`
       abfragt) gaben **HTTP 404** zurück – derselbe Fehlerklassen-Bug wie bei Punkt 3 (HTTP-Statuscode
       an der falschen Stelle bricht die Connector-Verbindung ab, obwohl der JSON-RPC-Fehler im Body
       korrekt war), nur an einer anderen Stelle im Code. Fix: **jede** Antwort nach erfolgreichem
       JSON-Parsing liefert jetzt HTTP 200, auch „Invalid Request“, „unbekanntes Tool“ und „Methode
       nicht gefunden“ – Non-200 bleibt nur für echte Transport-Fehler (falsche HTTP-Methode, kaputtes
       JSON) reserviert. Per curl mit allen denkbaren Discovery-Methoden (`resources/list`,
       `prompts/list`, `completion/complete`, `logging/setLevel`) gegenverifiziert: alle liefern jetzt
       HTTP 200.
    5. Verbinden schlug **trotzdem weiterhin** fehl, mit identischer Fehlermeldung. Diagnose-Experiment
       (temporärer, nicht committeter Rollback): der exakt gleiche Code-Stand wie beim einzigen
       erfolgreichen Connector-Versuch (Commit `f5b8ec3`, per `git checkout f5b8ec3 --
       supabase/functions/mcp-server/index.ts` + Redeploy, danach wieder auf `HEAD` zurückgesetzt) wurde
       erneut deployt und schlug beim Nutzer **ebenfalls** fehl – das widerlegte sowohl die
       „stale Client-Cache"- als auch die „create_session_note-Schema"-Hypothese endgültig, da hier
       nachweislich exakt der einmal funktionierende Stand erneut nicht funktionierte. Der eigentliche
       Fund danach: Die `corsHeaders` hatten **kein `Access-Control-Allow-Methods`**. Der POST mit
       `Content-Type: application/json` ist keine CORS-„simple request" (nicht-simpler Content-Type),
       Browser lösen deshalb einen Preflight (OPTIONS) aus – ohne `Allow-Methods` in dessen Antwort
       blockiert der Browser den eigentlichen POST komplett, obwohl OPTIONS selbst mit 200 antwortet.
       **`curl` simuliert diese Browser-CORS-Prüfung nicht** und hat den Bug deshalb über die gesamte
       bisherige Diagnose hinweg unsichtbar gemacht – das erklärt zugleich, warum es einmalig „im Chat"
       funktionierte: Die dort sichtbaren `mcp__...`-Tools kamen aus **dieser Claude-Code-CLI-Session**,
       einem serverseitigen/nicht-Browser-Client ohne CORS-Durchsetzung, während die claude.ai-Web-/
       Desktop-App den Aufruf browserseitig macht und daher exakt an dieser Lücke scheiterte. Fix:
       `Access-Control-Allow-Methods: POST, OPTIONS` (+ `Access-Control-Max-Age`) ergänzt. Per curl mit
       expliziten Preflight-Headern (`Origin`, `Access-Control-Request-Method`,
       `Access-Control-Request-Headers`) gegenverifiziert – bringt aber naturgemäß keine
       Curl-basierte Erfolgsgarantie mehr, da genau diese Prüfung zuvor blind war; die eigentliche
       Bestätigung musste ein echter Verbindungsversuch in Claude liefern. **Bestätigt (2026-07-20):**
       Nach dem Deploy verband sich der Connector selbstständig neu (kein manuelles Reconnect nötig -
       das wiederholte `booted`/`shutdown`-Muster in den Supabase-Function-Logs im
       ~1-Minuten-Abstand deutete auf periodische Reconnect-Versuche von Claude im Hintergrund hin),
       alle vier Tools erschienen in einer Claude-Code-Session und `list_next_sessions` lieferte über
       die echte Claude-MCP-Infrastruktur (nicht curl) reale Sitzungsdaten zurück. Der fehlende
       `Access-Control-Allow-Methods`-Header war damit der tatsächliche Rootcause des gesamten
       Connector-Problems, nicht die vorherigen (ebenfalls echten, aber unzureichenden) Fixes 1–4.

- **Eigene Anträge** (`0017_antraege.sql`, seit 2026-07-20): Neue Sektion "Meine Anträge" für selbst
  verfasste/eingebrachte Anträge – bewusst getrennt vom `documents`-Konzept aus KONZEPT.md Abschnitt 5.1
  (dort geht es um extern importierte Vorlagen/Anträge aus dem Ratsinformationssystem, hier um eigene,
  noch unveröffentlichte Anträge mit Workflow-Status). Rein privat (`antraege_manage_own`, gleiches
  RLS-Muster wie `todos_manage_own`) – bewusste Nutzerentscheidung, keine Fraktions-Sichtbarkeit für den
  ersten Wurf.
  - Felder: `titel`, `status` (`entwurf`→`eingereicht`→`in_beratung`→`vertagt`|`beschlossen`|
    `abgelehnt`|`zurueckgezogen`, zentrales Vokabular in `src/lib/antragStatus.ts` – Label + Badge-Farbe
    + welche Werte als "aktiv" vs. "abgeschlossen" gelten), `ausschuss` (Freitext mit Autovervollständigung
    aus den "Meine Gremien"-Einträgen des Nutzers via `<datalist>`, keine feste Werteliste), `inhalt`
    (Antragstext/Begründung), `mitantragsteller` (Freitext), `session_id` (optionale Verknüpfung zu der
    Sitzung, in der der Antrag behandelt wird – analog zur Sitzungs-Verknüpfung bei `todos`),
    `eingereicht_am`.
  - Kommentare (`antrag_comments`) und Dokumenten-Upload (`summaries.antrag_id`, Storage-Bucket
    `zusammenfassungen`) sind 1:1 nach dem `todo_comments`/`summaries.todo_id`-Muster aus `0011`
    dupliziert (bewusst, gleiche Begründung wie bei den anderen dokumentierten Dopplungen in diesem
    Projekt: kein gemeinsames Backend, das eine Abstraktion rechtfertigen würde).
  - **Dashboard** (`AntraegeSection.tsx`, zwischen ToDo-Board und "Nächste Termine"): Status-Filter-Chips
    (nur die im Bestand tatsächlich vorkommenden, gleiches Muster wie die Ebene-Filter in
    `CalendarView`), zeigt nur "aktive" Anträge. Ein Link ("N entschiedene im Archiv") verweist auf die
    abgeschlossenen.
  - **Nachträgliche Klarstellung (noch 2026-07-20):** "Meine Anträge" ist bewusst eine
    *dokumentenzentrierte* Übersicht – Kernobjekt ist das hochgeladene Antragsdokument (Word/PDF/...),
    getaggt mit Metadaten wie dem Ausschuss, nicht ein Text-Datensatz mit optional angehängtem Dokument.
    Deshalb: Titel, Ausschuss **und** Datei sind in der Schnellerfassung Pflichtfelder (kein reines
    Zweistufen-Muster wie beim ToDo-Board mehr); jede Kachel in der Liste zeigt das erste hochgeladene
    Dokument direkt als anklickbaren Chip (öffnet `DocumentPreviewModal` sofort, per `stopPropagation`
    getrennt vom Klick auf die restliche Kachel, der weiterhin das volle `AntragDetailModal` öffnet) statt
    nur ein 📎-Vorhanden-Flag. Zusätzlich zum Status-Filter gibt es jetzt einen zweiten Filter nach
    Ausschuss (ebenfalls nur tatsächlich vorkommende Werte) – macht die Übersicht faktisch zu einem
    privaten Pendant des in KONZEPT.md Abschnitt 5.1 beschriebenen, nie gebauten Dokumenten-Hubs
    ("filterbar nach Ausschuss"), nur für eigene statt extern importierte Dokumente. Der Archiv-Tab
    "Anträge" zeigt das erste Dokument je entschiedenem Antrag nach demselben Muster.
  - **Archiv** bekommt einen vierten Tab "Anträge" (Icon `Gavel`) für `beschlossen`/`abgelehnt`/
    `zurueckgezogen` – gleiches Modal (`AntragDetailModal`), damit auch entschiedene Anträge weiterhin
    vollständig einsehbar/nachträglich korrigierbar bleiben (kein separater Read-only-Modus, analog zu
    "Erledigte Aufgaben").
  - **Sitzungsdetailsicht** (`TerminDetailPanel`, nur `kind='session'`): neue Sektion "Verknüpfte
    Anträge" neben "Verknüpfte Aufgaben" – Klick auf eine Sitzung zeigt damit ToDos *und* Anträge dazu
    auf einen Blick, ohne dass die Sitzungsdetailsicht selbst etwas von `antraege` wissen muss (rein
    lesende `.eq('session_id', id)`-Query).
  - Migration wurde direkt gegen das Live-Supabase-Projekt gepusht (`supabase db push`, additiv: neue
    Tabellen + eine neue Spalte, keine Drops) und per REST-Smoke-Test verifiziert. **Wichtig:** Der
    Code-Push nach GitHub triggert den Deploy erst separat – ohne `git push` bleibt die Produktivseite
    auf dem alten Stand, auch wenn die DB-Migration schon lokal getestet wurde (genau das ist beim
    ersten Rollout dieser Sektion passiert: DB war fertig, GitHub Pages zeigte trotzdem noch die alte
    Version, bis Code committed und gepusht wurde).
- **Anträge: Workflow, Teilen, Fristen** (`0023_antraege_sharing_status_fristen.sql`, seit 2026-07-20):
  Nutzerentscheidung nach dem ersten Rollout - Anlage sollte wieder leichtgewichtig sein (Titel +
  optional die vorgesehene Sitzung, Status startet immer bei "Entwurf"), Ausschuss+Dokument sind
  keine Pflichtfelder mehr bei der Anlage. Stattdessen mehrere gezielte Ausbauten:
  - **Status-Vokabular überarbeitet**: `eingereicht` → `gestellt` (Standard-Sprachgebrauch "einen
    Antrag stellen"), `beschlossen`/`abgelehnt` → ein gemeinsamer Status `abgestimmt` mit separatem
    `ergebnis`-Feld (`positiv`/`negativ`) statt zwei Statuswerten - beide waren dieselbe Phase ("im
    Ausschuss abgestimmt"), unterschieden sich nur im Ausgang. Badge-Farbe (rot/grün) hängt deshalb vom
    Ergebnis ab, nicht mehr vom Status direkt - `antragBadgeClasses()`/`antragStatusLabel()` in
    `antragStatus.ts` ersetzen den direkten Map-Zugriff überall. Migration backfillt `ergebnis` aus den
    alten Statuswerten, bevor sie umbenannt werden (Reihenfolge kritisch). Der Check-Constraint-Name
    aus `0017` war nicht bekannt (implizit von Postgres vergeben) - per `pg_constraint`/`do $$`-Block
    dynamisch gefunden statt geraten.
  - **Dokument-Pflicht verschoben**: nicht mehr bei der Anlage, sondern rein clientseitig erzwungen
    beim Speichern mit Status `gestellt` (`AntragDetailModal.tsx`, kein DB-Trigger - bewusst wie die
    übrigen Business-Regeln in dieser App nur clientseitig, kein adversarielles Nutzerumfeld).
  - **Ebene je Antrag** (`antraege.ebene`) dient zwei Zwecken gleichzeitig: Kandidatenfilter beim
    Teilen (siehe unten) UND Nachschlage-Schlüssel für die Einreichungsfrist - wird beim Verknüpfen
    einer Sitzung automatisch aus deren `ebene`/`gremium` in Ausschuss übernommen (nur wenn noch leer,
    bleibt frei überschreibbar), keine doppelte Ebenen-Abfrage nötig.
  - **Teilen mit Kolleg*innen** (`antrag_shares`, exakt gleiches Partei+Ebene-Modell wie
    `todo_placements`/Teilen bei ToDo-Karten, siehe `0021_todo_erledigt_sharing.sql` und
    `TodoDetailModal.tsx`): volle Gleichberechtigung (jede geteilte Person liest/bearbeitet/kommentiert
    mit, nur der Ersteller löscht komplett oder ändert die Ebene/Freigabeliste). Anders als beim
    ToDo-Teilen (dortige `share-todo` Edge Function) reicht hier eine **direkte RLS-Insert-Policy ohne
    Edge Function** - Anträge haben keine Kanban-Spalten, es muss also keine private
    Board-Struktur der Ziel-Person aufgelöst werden (das war der einzige Grund für Service-Role bei
    ToDos). `profiles_select_same_partei_ebene` (0020) reicht dem Ersteller, um Zielprofile für die
    Kandidatensuche zu lesen. SECURITY DEFINER-Helper (`antrag_gehoert_nutzer`/`antrag_ist_geteilt_mit`)
    von Anfang an eingebaut, um die in `0021`→`0022` durchlaufene "infinite recursion detected in
    policy"-Falle (zirkuläre RLS-Abfrage zwischen zwei Tabellen) von vornherein zu vermeiden - inklusive
    einer Falle beim ersten Anlauf: die Helper-Funktionen sind `language sql` (nicht `plpgsql`) und
    werden deshalb **beim `CREATE FUNCTION` sofort gegen das Schema geparst**, nicht erst beim ersten
    Aufruf - `antrag_ist_geteilt_mit` referenzierte `antrag_shares`, das in der ersten Fassung der
    Migration erst *danach* angelegt wurde (`relation "antrag_shares" does not exist`, Migration lief
    transaktional komplett zurück, DB blieb sauber). Fix: Tabelle vor den Funktionen anlegen.
  - **Einreichungsfristen** (`antrag_deadline_settings`, rein privat pro Nutzer+Ebene, Settings-Sektion
    "Antrags-Fristen"): Tage-vor-der-Sitzung je Ebene (z. B. Kommune = 14), `src/lib/antragDeadline.ts`
    berechnet daraus `Sitzungsdatum − Tage` für Anträge mit verknüpfter Sitzung + gesetzter Ebene.
    Anzeige in `AntraegeSection`/`AntragDetailModal` mit Überfällig-Warnung (rot), wenn die Frist
    verstrichen ist und der Antrag noch im Status "Entwurf" hängt. Bewusst **pro Betrachter** berechnet
    (die eigenen Settings des gerade eingeloggten Nutzers, nicht die des Ersteller) - bei geteilten
    Anträgen kann die angezeigte Frist deshalb je nach Person leicht abweichen, das ist beabsichtigt
    (jede*r hat ggf. andere interne Vorlaufzeiten).
  - **UI-Feinschliff nach dem Rollout** (`0024_antraege_drop_mitantragsteller.sql`, noch 2026-07-20):
    Nutzerentscheidung, das Freitext-Feld `mitantragsteller` und das jetzt redundante, manuell
    editierbare Ausschuss-Textfeld aus dem Formular zu entfernen. Begründung: die Teilen-Funktion
    (`antrag_shares`) deckt "Mitantragsteller" jetzt strukturiert ab statt als Freitext - der
    "Teilen"-Bereich im Modal heißt deshalb konsequent "Mitantragsteller" (nicht mehr "Teilen"),
    Wording durchgängig angepasst ("Du bist Mitantragsteller*in..." statt "wurde mit dir geteilt").
    Die Spalte wurde komplett gedroppt statt nur im Frontend ausgeblendet (kein totes DB-Feld). Das
    Ausschuss-Feld (`antraege.ausschuss`) bleibt als Spalte bestehen (weiterhin für Badges/Filter in
    `AntraegeSection`/Archiv genutzt) - nur das manuelle Text-Eingabefeld im Formular ist weg, da der
    Wert inzwischen zuverlässig aus der verknüpften Sitzung übernommen wird (`handleSessionChange`).

- **Kalenderquellen nach Nutzern getrennt** (`0018_calendar_sources_privat.sql`, seit 2026-07-20): Bug
  behoben, der KONZEPT.md Abschnitt 5.1/7 widersprach ("gemeinsame Grundausstattung vom Ratsbüro" +
  "Mitglied kann zusätzlich eigene Quellen hinzufügen" – letztere sollten nie fremden Mitgliedern
  sichtbar sein). `calendar_sources_select_all` (0001_init.sql, `using (true)`) machte bislang
  **jede** Quelle für **jeden** eingeloggten Nutzer sichtbar, auch privat angelegte
  (`verwaltet_von = <anderer User>`) – dadurch tauchten fremde Quellen in der Kalenderquellen-Liste
  UND (über die daraus abgeleiteten `sessions.gremium`-Werte) in "Meine Gremien" auf, und deren
  Sitzungen ließen sich sogar abonnieren. Neue Policy `calendar_sources_select_shared_or_own`:
  sichtbar sind nur noch gemeinsam verwaltete Quellen (`verwaltet_von is null`, z. B. "Stadtrat
  Iserlohn") sowie die eigenen; Admins sehen weiterhin alle (konsistent mit den bereits bestehenden
  `update`/`delete`-Policies aus `0006_calendar_sources_admin.sql`, die Admins schon vorher erlaubten,
  fremde Quellen zu verwalten). `sessions_select_all` musste dieselbe Regel erben (neue Policy
  `sessions_select_visible_source`, Join auf `calendar_sources.verwaltet_von`) – sonst wären die
  Quellen zwar in den Einstellungen versteckt, ihre importierten Sitzungen aber weiterhin für alle im
  Kalender sichtbar gewesen.
  - **Tägliche Aktualisierung brauchte keine Änderung**: Der bestehende ICS-Import-Job
    (`scripts/import-ics.mjs`, GitHub Action täglich 04:00 UTC) und die Einzelquellen-Refresh-Function
    (`import-ics-source`) laufen beide mit dem Service-Role-Key direkt gegen `calendar_sources` bzw.
    einen mitgegebenen `source_id` – das umgeht RLS ohnehin komplett und war nie an eine
    Nutzer-Sichtbarkeit gekoppelt. Private, gemeinsame und admin-verwaltete Quellen werden also
    weiterhin alle täglich importiert, unabhängig davon, wer sie sehen darf.
  - **Eine Stelle brauchte trotzdem eine manuelle Anpassung**: `mcp-server/index.ts` liest
    `sessions`/`calendar_sources` ebenfalls über den Service-Role-Client (siehe oben im MCP-Abschnitt),
    RLS greift dort also grundsätzlich nicht. `listNextSessions()` filtert seit diesem Fix zusätzlich
    manuell auf die für die aufrufende `userId` sichtbaren `source_id`s (gleiche Regel wie
    `calendar_sources_select_shared_or_own`, per `.or('source_id.is.null,source_id.in.(...)')`
    nachgebildet) – sonst hätte `list_next_sessions` per Claude-Chat weiterhin private Sitzungen
    fremder Mitglieder ausgegeben, obwohl das Web-UI sie längst korrekt versteckt.
  - **Nachgebessert (noch 2026-07-20, `0019_calendar_sources_strict_privat.sql`):** 0018 hatte für
    Admins noch eine Sichtbarkeits-Ausnahme auf fremde private Quellen (konsistent mit den
    bestehenden update/delete-Policies aus 0006). Live-Test durch den admin-Account (Thorsten Kois)
    zeigte, dass das nicht gewünscht war – die Trennung soll **strikt** sein, auch für Admins. Fix:
    SELECT-Policies verlieren die Admin-Ausnahme komplett; die update/delete-Policies aus 0006 behalten
    eine Admin-Ausnahme **nur noch für die gemeinsam verwaltete Quelle** (`verwaltet_von is null`, z. B.
    "Stadtrat Iserlohn" – die kann sonst niemand bearbeiten), nicht mehr für fremde private Quellen
    anderer Mitglieder. Grund für die Mitänderung der write-Policies: nach der strengeren SELECT-Regel
    wäre die alte "Admin darf jede fremde Quelle bearbeiten/löschen"-Berechtigung nur noch unsichtbar,
    aber technisch weiterhin nutzbar gewesen (Schreibzugriff per bekannter/erratener UUID, obwohl die
    Quelle in der UI nicht mehr auftaucht) – das wäre eine stille Sicherheitslücke geblieben.

- **UI-Redesign: einheitliche breite Detail-Modals + Anträge/Termine nebeneinander** (2026-07-21,
  Nutzerfeedback nach Review): Die ToDo-/Antrag-Modals waren `max-w-lg` (512px) und stapelten
  Bearbeiten-Formular → Teilen → Kommentare → Dokumente komplett vertikal in einem Scroll-Bereich;
  Sitzungstermine öffneten sich zudem als Inline-Split-View statt als Modal wie ToDos/Anträge
  (Konsistenz-Verstoß). Neue gemeinsame Hülle `src/components/DetailModalShell.tsx`
  (`h-[85vh] max-w-5xl`, 2-Spalten-Grid `grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]`,
  jede Spalte eigenes `overflow-y-auto` – Kernfelder links bleiben ohne Scrollen sichtbar, nur die
  Aktivität rechts scrollt) wird von `TodoDetailModal.tsx` und `AntragDetailModal.tsx` genutzt (drittes
  Vorkommen des Chrome-Musters wäre laut Projekt-Konvention nicht mehr tolerierbar, siehe
  `fileNameFromPath`-Beispiel oben). Rechte Spalte bekam zusätzlich einen lokalen Tab-Umschalter
  (Kommentare/Dokumente mit Zählern) statt beide Listen dauerhaft übereinander zu zeigen.
  - **Termine als Modal statt Split-View**: `TerminDetailPanel.tsx` bekam eine neue optionale Prop
    `layout?: 'stacked' | 'columns'` (Default `'stacked'` – die Standalone-Seite `TerminDetail.tsx`
    bleibt unverändert). Neues `src/components/TerminDetailModal.tsx` ist ein dünner Wrapper (eigenes
    Chrome statt `DetailModalShell`, da der Header hier generisch "Sitzung"/"Termin" bleibt – der
    echte Titel steht bereits als erste Zeile im Panel-Body). Verschachtelte Modals (Todo/Antrag/
    Dokument-Vorschau, geöffnet aus "Verknüpfte Aufgaben/Anträge" heraus) bleiben unverändert als
    Siblings im `TerminDetailPanel`-Return gerendert – per Browser-Test verifiziert, dass
    `backdrop-filter` auf einem Ancestor **keinen** Containing Block für `position: fixed`-Nachfahren
    erzeugt (anders als `filter`/`transform`), sie also trotz der neuen Modal-Verschachtelung weiterhin
    viewport-weit statt nur im Ancestor-Bereich rendern. `CalendarView.tsx` und `Archiv.tsx`
    ("Vergangene Sitzungen") nutzen jetzt beide `TerminDetailModal` statt der alten Zwei-Spalten-Flex-
    Split-View.
  - **Dashboard-Layout**: `Dashboard.tsx` zeigt "Meine Anträge" und "Nächste Termine" jetzt
    nebeneinander (`grid grid-cols-1 lg:grid-cols-2 gap-6`, ToDo-Board bleibt oben in voller Breite für
    die Spalten-Grid). `AntraegeSection.tsx`s Liste bekam zur Höhen-Angleichung dasselbe
    `max-h-[26rem] overflow-y-auto` wie `CalendarView.tsx`s Terminliste.
  - Verifiziert per `tsc -b`/`vite build` (fehlerfrei) sowie einem statischen Test-Harness mit der
    tatsächlich kompilierten CSS (unabhängiges Scrollen der Modal-Spalten und Dashboard-Grid per
    `getBoundingClientRect()`/`scrollHeight` gegengemessen) – ein Login-Test im echten Dev-Server war
    nicht möglich, da das Eintragen von Passwörtern grundsätzlich tabu ist; ein echter Login-Rundgang
    im Browser steht daher noch aus.
  - **Nachbesserung nach Nutzer-Feedback (noch 2026-07-21):** Drei Punkte. (1) Dashboard-Reihenfolge
    getauscht – `CalendarView` (Termine) steht jetzt links, `AntraegeSection` (Anträge) rechts (vorher
    umgekehrt), reine JSX-Reihenfolge im Grid in `Dashboard.tsx`. (2) Die linke Spalte von
    `TodoDetailModal`/`AntragDetailModal` musste trotz des 2-Spalten-Umbaus noch scrollen, sobald
    "Teilen"/"Mitantragsteller" (Ebene-Select + Kolleg*innen-Chips + Such-Dropdown) sichtbar war – der
    Block wurde deshalb komplett aus der linken Formular-Spalte in einen dritten Tab der rechten
    Aktivitäts-Spalte verschoben (`activityTab: 'kommentare' | 'dokumente' | 'teilen'` bzw.
    `'mitantragsteller'`, Tab-Button zeigt die Anzahl der bereits Geteilten als Badge). Damit enthält
    die linke Spalte nur noch das reine Bearbeiten-Formular (Titel/Beschreibung/Zuständig/Termin bzw.
    Titel/Status/Inhalt/Sitzung) und bleibt in der Praxis immer ohne Scrollen sichtbar – per statischem
    Test-Harness gegengemessen (`scrollHeight === clientHeight`, `needsScroll: false`). (3) Anlegen
    eines neuen Antrags ist jetzt wie bei Terminen (`CalendarView.tsx`s "+ Termin") ein Button
    ("+ Antrag"), der ein `mc-animate-pop`-Formular ein-/ausblendet, statt einer permanent sichtbaren
    Inline-Zeile in `AntraegeSection.tsx` – `showAddForm`-State, Formular schließt sich nach
    erfolgreichem Anlegen automatisch (gleiches Verhalten wie `handleAddEvent`).
  - **Zweite Nachbesserung (noch 2026-07-21):** Nutzer mochte den Kommentare/Dokumente/Teilen-Tab-
    Umschalter aus der ersten Nachbesserung nicht (per `AskUserQuestion` geklärt: "Kommentare &
    Dokumente wieder untereinander, Teilen separat"). `DetailModalShell.tsx` bekam eine neue
    `headerActions`-Prop (Slot im Header neben "Schließen"), `TodoDetailModal.tsx`/
    `AntragDetailModal.tsx` verschieben Speichern+Löschen dorthin (Formular bekam dafür `id`, der
    Speichern-Button nutzt das HTML-`form`-Attribut, um trotz Position außerhalb des `<form>`-Elements
    weiter dessen `onSubmit` auszulösen). Rechte Spalte zeigt jetzt wieder alle drei Bereiche
    permanent untereinander (Kommentare → Dokumente → Teilen/Mitantragsteller), kein `activityTab`-
    State mehr - die Spalte scrollt dafür bei vielen Kommentaren/Dokumenten wieder als Ganzes, was der
    Nutzer explizit so wollte (nur das Umschalten störte, nicht das Scrollen der rechten Spalte an
    sich). Zusätzlich zwei Felder aus den Formularen entfernt, die laut Nutzer nicht gebraucht werden:
    `AntragDetailModal.tsx` verlor das "Antragstext / Begründung"-Textarea (Anträge werden als Word/PDF
    hochgeladen, nicht im UI getippt), `TodoDetailModal.tsx` verlor das "Zuständig"-Eingabefeld. Beide
    Felder wurden bewusst nur aus dem UI entfernt, nicht aus der Datenbank gedroppt (anders als z. B.
    `mitantragsteller` in `0024`) - der Nutzer bat nur ums Entfernen des Formularfelds, ein
    Spalten-Drop mit Datenverlust für ggf. bereits befüllte Zeilen ist eine andere, riskantere
    Entscheidung, die nicht ungefragt getroffen wurde; `todos.zustaendig` wird zudem an anderer Stelle
    (Board-Karten-Chip, Archiv) weiterhin gelesen und angezeigt.
  - **Dritte Nachbesserung (noch 2026-07-21):** Nutzer wollte "Teilen"/"Mitantragsteller" doch wieder
    zurück auf die linke Seite ("da ist Platz") - nachdem Antragstext/Zuständig aus den Formularen
    entfernt wurden, ist die linke Spalte inzwischen kurz genug, dass der ursprüngliche Scroll-Grund
    für den Umzug (siehe erste Nachbesserung oben) nicht mehr greift. `teilenTab`/
    `mitantragstellerTab` mussten dafür in beiden Modals vor `leftColumn` deklariert werden (die
    Konstanten wurden vorher zwischen `headerActions` und `rightColumn` gebaut, ein direktes Referenzieren
    aus `leftColumn` heraus hätte einen Temporal-Dead-Zone-Fehler geworfen, da `const`-Deklarationen in
    JS nicht wie Funktionsdeklarationen gehoisted werden). Rechte Spalte zeigt jetzt nur noch
    Kommentare + Dokumente untereinander.
  - **Vierte Nachbesserung (noch 2026-07-21):** Recherche über den 21st.dev-Connector
    ("dropdown menu with inline delete confirmation", "animated toggle switch") plus `impeccable`-
    Produkt-Register-Prinzipien ("Error Prevention: Bestätigung vor destruktiven Aktionen", "gleiche
    Aktion = gleiche UI") flossen in vier gezielte Verbesserungen:
    - **Dokumente vor Kommentare**: rechte Spalte in `TodoDetailModal.tsx`/`AntragDetailModal.tsx`
      vertauscht (Nutzerwunsch, keine tiefere Begründung nötig).
    - **Header-Aktionen neu**: "Speichern"/"Löschen"/"Schließen" als drei gleichwertige Text-Buttons
      nebeneinander wirkten zusammengewürfelt. Jetzt: "Speichern" bleibt primärer Text-Button, "Löschen"
      wird ein zurückhaltender Icon-Button (`lucide-react` `Trash2`, rot erst im Hover), "Schließen" wird
      ein `X`-Icon-Button, per `border-r` optisch von den Inhalts-Aktionen abgesetzt - gleiches Muster in
      `DetailModalShell.tsx` (neue `headerActions`-Umrandung), `TerminDetailModal.tsx` und
      `DocumentPreviewModal.tsx` übernommen, damit alle vier Modals im Projekt dasselbe Kopfzeilen-
      Vokabular teilen (vorher hatte nur `DocumentPreviewModal.tsx` schon ein eigenes, jetzt
      vereinheitlichtes Muster).
    - **Löschen fragt nach**: Klick auf den Trash-Icon-Button lässt ihn inline zu "Sicher? Abbrechen /
      Löschen" aufklappen (`confirmDelete`-State, per `mc-animate-pop`), statt sofort zu löschen oder
      ein natives `window.confirm()` zu nutzen (wie in `UserManagement.tsx` - dort bewusst nicht
      angeglichen, das ist ein anderer, älterer Teil der App und nicht Teil dieser Modal-Überarbeitung).
      `confirmDelete` wird bei jedem `id`-Wechsel per `useEffect` zurückgesetzt, damit ein Reopen mit
      einer anderen Karte nicht versehentlich im aufgeklappten Zustand startet.
    - **"Erledigt" als Toggle-Switch** (nur `TodoDetailModal.tsx`, Anträge haben kein Erledigt-Feld):
      die native Checkbox wirkte klein/beliebig neben ihrem Label. Ersetzt durch einen selbstgebauten
      iOS-artigen Switch (`role="switch"`, `aria-checked`, 200ms `translate-x`-Animation, Füllfarbe folgt
      `bg-primary` und damit automatisch dem Partei-Theme) - kein neues Package, reines Tailwind wie der
      Rest der Komponenten-Bibliothek.
    - Verifiziert per `tsc -b`/`vite build` sowie einem interaktiven statischen Test-Harness (Toggle-Klick
      und Löschen-Klick per `element.click()` ausgelöst, Zustandswechsel per Screenshot bestätigt) - ein
      Login-Rundgang im echten Dev-Server bleibt weiterhin offen (Passwort-Eingabe ist tabu).

- **Erzwungener Passwortwechsel + Gliederung (welche Kommune/welcher Kreis/welches Land)**
  (`0025_profiles_muss_passwort_aendern.sql`, `0026_profiles_gliederung.sql`, seit 2026-07-21):
  - **Passwortzwang**: `profiles.muss_passwort_aendern` (Default `true`, bei der Migration für
    bestehende Nutzer einmalig auf `false` zurückgesetzt - niemand wird rückwirkend gezwungen, nur
    neue oder per Admin zurückgesetzte Passwörter). `admin-users`-Edge-Function setzt es bei
    `action: 'create'` implizit über den Spalten-Default und bei `action: 'update'` explizit wieder auf
    `true`, sobald ein neues `password` mitgeschickt wird (ein Admin-Reset zählt also wie ein
    Start-Passwort). Neue Komponente `src/components/ForcedPasswordChange.tsx` (Login.tsx-Optik,
    zwei Passwortfelder, min. 8 Zeichen, `supabase.auth.updateUser()` + `profiles`-Update in einem
    Rutsch) wird von `ProtectedRoute.tsx` **vor** den eigentlichen Kindern gerendert, sobald das Flag
    gesetzt ist - blockt dadurch jede geschützte Route unabhängig von der angefragten URL. Bewusst
    kein Dead-End: ein dezenter "Abmelden"-Link bleibt als Ausweg.
  - **Gliederung**: `profiles.ebenen` (0020) markierte bisher nur grob die Ebene
    (kommune/kreis/land/bund) - zwei Mitglieder derselben Partei aus unterschiedlichen Städten wären
    dadurch fälschlich als Teilen-Kandidaten füreinander erschienen
    (`TodoDetailModal.tsx`/`AntragDetailModal.tsx`, `loadCandidates()`). Drei neue nullable Spalten
    `gliederung_kommune`/`gliederung_kreis`/`gliederung_land` (Bund braucht keine weitere Angabe, es
    gibt nur einen Bundestag). Neue Datei `src/lib/gliederung.ts`: `gliederungFeld(ebene)` mappt Ebene
    → passende Spalte (oder `null` bei Bund), `gleicheGliederung(a, b, ebene)` vergleicht getrimmt
    case-insensitive und wertet eine leere Gliederung **nie** als Treffer - bewusst kein hartes
    Pflichtfeld auf DB-Ebene (analog zur clientseitig durchgesetzten Dokument-Pflicht bei Anträgen),
    sondern sanft über die Matching-Logik erzwungen: ohne eingetragene Gliederung taucht man für diese
    Ebene bei niemandem als Kandidat*in auf (Hinweistext in Settings.tsx macht das explizit). RLS
    (`profiles_select_same_partei_ebene`, 0020) bleibt unverändert als grobe Vorfilterung; die exakte
    Prüfung passiert weiterhin rein clientseitig in `loadCandidates()` (gleiches Muster wie schon für
    die Ebene selbst). `Settings.tsx` "Meine Ebenen"-Block zeigt pro angehaktem Nicht-Bund-Eintrag ein
    Textfeld darunter (Persistenz `onBlur`, analog zum bestehenden `saveEditColumn`-Muster fürs
    Board-Spalten-Umbenennen). **Rollout-Nebenwirkung:** Bestehende Nutzer mit
    kommune/kreis/land-Ebenen haben direkt nach der Migration eine leere Gliederung - bestehende
    Teilen-Verbindungen auf diesen Ebenen pausieren, bis beide Seiten ihre Gliederung nachtragen
    (beabsichtigt, verhindert falsche Querverbindungen).
  - `UserManagement.tsx` bleibt unverändert außer einem ergänzten Hinweistext beim Anlegen ("... muss
    es beim ersten Login zwingend selbst ändern") - Ebenen/Gliederung sind weiterhin bewusst
    Selbstauskunft, keine Admin-Pflege.
  - Verifiziert per `tsc -b`/`vite build`, `deno check` (admin-users), `supabase db push` gegen das
    Live-Projekt sowie einem statischen Test-Harness für `ForcedPasswordChange` und die neuen
    Gliederung-Felder - ein echter Login-Rundgang bleibt offen (Passwort-Eingabe ist tabu).

- **"Meine Anträge" → "Antrags-Dokumente"** (`AntraegeSection.tsx`, seit 2026-07-21): Nutzerwunsch,
  die Dashboard-Sektion konsequent dokumentenzentriert nach Sitzung zu filtern statt nach Status/
  Ausschuss. Die Status-/Ausschuss-Filter-Chips sind komplett durch einen Sitzungs-Filter ersetzt:
  "Alle" + ein Chip pro Sitzung, die unter den aktiven Anträgen tatsächlich vorkommt (chronologisch,
  `vorkommendeSitzungen`) + "Eigene Anträge" für Anträge ohne `session_id` (nur wenn es welche gibt,
  `hatEigeneOhneSitzung`) - Filter-State-Typ `SitzungFilter = 'alle' | 'eigene' | <session_id>`. Jede
  Karte zeigt jetzt immer einen Sitzungs-Hinweis, auch wenn keiner besteht (`"Ohne Sitzungsbezug"`
  statt einfach nichts anzuzeigen) - macht "mit welcher Sitzung verknüpft" für jedes Dokument explizit
  sichtbar. Klick-Verhalten bewusst unverändert gelassen (Klick auf die Karte öffnet weiterhin das
  volle `AntragDetailModal`, Klick auf den Dokument-Chip separat per `stopPropagation` die
  `DocumentPreviewModal`) - der Nutzer wollte weiterhin vollen Zugriff auf Status/Kommentare/
  Mitantragsteller, nicht nur eine reine Dokumentenliste.
  - **Erweiterung auf Sitzungsdokumente** (noch 2026-07-21, Überschrift jetzt "Meine Dokumente"):
    Nutzerwunsch, hier auch Dokumente/Notizen zu sehen, die direkt an einer Sitzung hochgeladen
    wurden (vorbereitete Redebeiträge, Analysen, Zusammenfassungen - über "Notizen & Dokumente" in
    `TerminDetailPanel.tsx`), nicht nur Antrags-Dokumente. Neuer Typ `DokumentItem` vereinheitlicht
    beide Quellen zu einer chronologischen Liste (sortiert nach `erstellt`/`created_at` bzw.
    `erstellt_am`): `kind: 'antrag'` (unverändertes Verhalten) und `kind: 'sitzungsdokument'` (neu,
    aus `summaries` mit gesetztem `session_id` **und** `antrag_id is null`, RLS
    `summaries_manage_own` scoped bereits auf eigene Einträge). Sitzungsdokument-Zeilen haben kein
    Titel-Feld wie ein Antrag - die Zeile zeigt stattdessen den Dateinamen (Badge "Dokument") oder,
    falls nur eine Text-Notiz ohne Datei vorliegt, einen Schnipsel des Notiztexts (Badge "Notiz");
    Klick auf die Zeile öffnet `TerminDetailModal` für die verknüpfte Sitzung (analog zum
    `AntragDetailModal` bei Antrag-Zeilen), Klick auf den Dateinamen separat per `stopPropagation`
    die `DocumentPreviewModal`. Der Sitzungs-Filter (`vorkommendeSitzungen`) berücksichtigt jetzt
    Sitzungen aus beiden Quellen; "Eigene Anträge" bleibt spezifisch für Anträge ohne Sitzungsbezug,
    da Sitzungsdokumente per Definition immer eine Sitzung haben.
  - **Dritte Quelle: Dokumente an ToDo-Karten** (noch 2026-07-21): `DokumentItem` bekam einen dritten
    `kind: 'todo'` (aus `summaries` mit gesetztem `todo_id`, gruppiert nach Karte wie Anträge nach
    `docsByAntrag` - mehrere Dokumente derselben Karte landen in einer Zeile mit "+N"). Die
    zugehörigen ToDo-Karten werden gezielt nachgeladen (`todoById`, gleiches Muster wie
    `eventById`/`sessionById` in `TodoBoard.tsx`), deren `session_id` fließt ebenfalls in den
    Sitzungs-Filter ein. Badge zeigt "Erledigt" (grün, durchgestrichener Titel) oder "ToDo" (analog
    zur Card-Darstellung im Board); Klick öffnet `TodoDetailModal`. Damit deckt die Sektion jetzt alle
    drei Stellen ab, an denen im Projekt Dokumente hochgeladen werden können (Antrag, Sitzung, ToDo).
  - **📎-Flag auf den Board-Karten** (noch 2026-07-21, `TodoBoard.tsx`): Nutzerwunsch, das "Enthält
    Dokumente"-Symbol auch direkt auf den ToDo-Karten zu sehen, nicht nur in "Meine Dokumente" bzw.
    im geöffneten Kartendetail. Gleiches Nachlade-Muster wie `eventById`/`sessionById` (nur für die
    aktuell sichtbaren Karten, kein Volltabellen-Join): `dokumentIds`-Set aus
    `summaries.select('todo_id').in('todo_id', ...)`. Icon sitzt bewusst als **Präfix** vor dem
    Kartentitel (wie das bestehende 🔗-Symbol für geteilte Karten), nicht als Suffix danach - ein
    Suffix mit vorangestelltem Leerzeichen konnte bei langen Titeln in eine eigene Zeile umbrechen
    und wirkte dann verwaist (per Test-Harness-Screenshot entdeckt und korrigiert).

- **Impressum, Datenschutzerklärung, Kontaktformular** (`0027_kontakt_anfragen.sql`, seit 2026-07-22):
  Da mehrere Ratsmitglieder das Cockpit mitnutzen (öffentliches GitHub-Repo, GitHub-Pages-Hosting),
  geht der Betrieb über eine rein private/familiäre Nutzung hinaus - Impressumspflicht nach § 5 DDG.
  Neue Seiten `src/pages/Impressum.tsx` und `src/pages/Datenschutz.tsx`, als einzige Routen bewusst
  **außerhalb** von `ProtectedRoute` (siehe `App.tsx`) - müssen ohne Login erreichbar sein. Von
  `Login.tsx` (Footer, für nicht angemeldete Besucher*innen) und `Dashboard.tsx` (Footer, für
  angemeldete Nutzer*innen) verlinkt. Angaben (Name/Anschrift/Kontakt) direkt vom Nutzer erhalten;
  die Datenschutzerklärung ist inhaltlich an der tatsächlichen Datenverarbeitung im Schema orientiert
  (Supabase EU-Hosting Frankfurt, GitHub Pages fürs Frontend, private Storage-Buckets), nicht aus
  einem generischen Template - ersetzt aber keine rechtliche Prüfung im Einzelfall.
  - **Kontaktformular** (`src/components/KontaktFormular.tsx`, auf der Impressum-Seite): erste Stelle
    im Projekt mit einer **anonymen Insert-Policy** (`kontakt_anfragen_insert_all`, `to anon,
    authenticated`) - alle anderen Tabellen verlangen Login. Enthält ein unsichtbares Honeypot-Feld
    (`website`, per CSS `absolute left-[-9999px]` ausgeblendet) als einfache, kostenlose Bot-Abwehr
    ohne Captcha-Dienst - kein Ersatz für echten Spam-Schutz, hält aber naive Formular-Bots ab.
  - **Zustellung bewusst als In-App-Postfach statt E-Mail-Versand** (Nutzerentscheidung nach
    Rückfrage): ein echter E-Mail-Versand hätte einen externen Dienst (z. B. Resend) samt neuem
    API-Key-Secret gebraucht. Stattdessen neue Tabelle `kontakt_anfragen` (Name, E-Mail, Nachricht,
    `gelesen`-Flag) und ein neuer Admin-Bereich "Kontaktanfragen" in `Settings.tsx`
    (`src/components/KontaktAnfragenListe.tsx`, RLS `kontakt_anfragen_select_admin` auf `rolle =
    'admin'` beschränkt) - gleiches Muster wie die bestehende Benutzerverwaltung.
  - Verifiziert per `tsc -b`/`vite build`, `supabase db push` gegen das Live-Projekt sowie einem
    echten End-to-End-Test im Dev-Server: `/impressum` und `/datenschutz` sind ohne Login erreichbar
    (im Gegensatz zu den anderen Seiten kein Passwort nötig, daher hier ausnahmsweise ein echter
    Browser-Rundgang statt nur ein statischer Test-Harness), Kontaktformular erfolgreich gegen die
    Live-Datenbank abgesendet (eine Test-Nachricht "Testabsender" liegt entsprechend im
    Kontaktanfragen-Postfach und kann dort gelöscht werden).

- **Bugfix: `webcal://`-Quellen ließen den täglichen ICS-Import deterministisch scheitern**
  (seit 2026-07-23): Der tägliche Import-Job (`import-ics.yml`) war zwei Tage in Folge (2026-07-22
  und 2026-07-23) rot. Root Cause: die von Benjamin Korte angelegte Quelle "Kreistag" nutzt ein
  `webcal://`-URL-Schema (eine reine Client-Konvention "das hier ist ein abonnierbarer Kalender",
  von iCal/Outlook/Google Calendar traditionell 1:1 zu `http(s)://` aufgelöst) - Node/undicis
  natives `fetch` (das `ical.async.fromURL()` intern nutzt) kennt dieses Schema nicht und wirft
  dafür bei **jedem einzelnen Aufruf** "fetch failed" (kein Netzwerkfehler, kein Flackern - lokal
  reproduziert und verifiziert: derselbe Request funktioniert sofort fehlerfrei, sobald man
  `webcal://` durch `https://` ersetzt). Da `scripts/import-ics.mjs` bei mindestens einer
  fehlgeschlagenen Quelle mit `process.exit(1)` abbricht, färbte diese eine kaputte private Quelle
  den gesamten täglichen Job für alle Quellen rot, obwohl die anderen drei (inkl. "Stadtrat
  Iserlohn") jeden Tag anstandslos durchliefen.
  - Fix: neue Hilfsfunktion `normalizeIcsUrl()` (in `scripts/import-ics.mjs` **und**
    `supabase/functions/import-ics-source/index.ts`, gleiche bewusste Dopplung wie bei der
    Gremium-Extraktion) mappt `webcal://`/`webcals://` vor dem Fetch auf `https://` - lokal mit der
    echten, betroffenen URL gegenverifiziert (vorher: "fetch failed" bei jedem Versuch, nachher: 26
    VEVENTs korrekt geparst).
  - Nebenbefund beim Debuggen, bewusst nicht automatisch "repariert": zwei weitere private Quellen
    hatten eigene, unabhängige Probleme. "Kreistag MK" (Stefan Woelk) zeigt auf
    `https://www.sitzungsdienst-maerkischer-kreis.de/ri/si010_i.asp` - liefert HTTP 403 (auch per
    curl reproduzierbar) und hat keine `template=ical`-Query-Parameter wie die funktionierende
    Schwester-Quelle "Kreistag" vom selben Anbieter; sieht nach einer falsch kopierten
    Seiten-URL statt eines echten ICS-Exportlinks aus - node-ical wirft dafür keinen Fehler
    (leeres, aber parsbares HTML), sondern liefert nur 0 Termine, war also nie Teil des roten
    Job-Status. "LWL" (Benjamin Korte) nutzt `http://` statt `https://` und braucht dadurch einen
    301-Redirect vor dem eigentlichen ICS-Feed - lief in den beiden untersuchten Läufen einmal durch
    und einmal mit "fetch failed" fehl (vermutlich netzwerkbedingtes Flackern auf GitHub-Actions-
    Runnern beim Redirect-Hop, nicht reproduzierbar vom lokalen Rechner aus). Beides sind private
    Quellen anderer Mitglieder (nicht meine) - die Korrektur der URLs selbst wurde bewusst nicht
    automatisiert vorgenommen (auch von der Auto-Mode-Berechtigungsprüfung blockiert, als ein
    direktes `UPDATE` auf `calendar_sources` versucht wurde), sondern den jeweiligen Besitzern zur
    eigenständigen Korrektur in ihren Settings überlassen.

- **Sitzungen manuell nachtragen** (`0028_sessions_manuell_anlegen.sql`, seit 2026-07-25):
  Nutzerwunsch, rückwirkend Gremiensitzungen erfassen zu können, um im Nachhinein noch Dokumente
  hochzuladen und zu verknüpfen (z. B. Sitzungen aus der Zeit vor Einrichtung eines ICS-Feeds oder
  aus Gremien ganz ohne ICS-Feed). Bisher gab es dafür **keine** Möglichkeit: `sessions` hatte seit
  `0001_init.sql` nie eine INSERT/UPDATE/DELETE-Policy für eingeloggte Nutzer, nur der ICS-Import-Job
  (Service Role) konnte Zeilen schreiben (Kommentar dort: "Schreiben später nur via Service Role /
  Import-Job"). Die "Notizen & Dokumente"-Sektion in `TerminDetailPanel.tsx` funktionierte für
  Sitzungen zwar schon (identisches Muster wie bei Terminen, siehe `.claude/skills/document-feature`),
  lief aber ins Leere, weil sich gar keine passende Sitzung anlegen ließ.
  - Neue Spalte `sessions.erstellt_von` (nullable, nur bei manuell angelegten Sitzungen gesetzt) plus
    drei neue Policies: `sessions_insert_manuell` (`source_id is null and erstellt_von = auth.uid()`
    - verhindert, dass sich ein Nutzer als ICS-Quelle ausgibt), `sessions_update_own_manuell` und
    `sessions_delete_own_manuell` (beide auf `erstellt_von = auth.uid()` beschränkt). Importierte
    Sitzungen (`erstellt_von is null`) bleiben dadurch wie bisher für alle unveränderbar - nur der
    Import-Job selbst (Service Role, RLS-unabhängig) kann sie schreiben.
  - **UI**: neuer Button "Sitzung nachtragen" im Tab "Vergangene Sitzungen" in `Archiv.tsx` (Titel,
    Gremium, Ebene, Datum, Ort). Nach dem Anlegen öffnet sich direkt die Detailansicht der neuen
    Sitzung, damit sofort Dokumente/Notizen hochgeladen werden können, statt nur die Liste zu
    aktualisieren. Das neue Gremium wird automatisch zu `user_gremien` hinzugefügt (sonst würde die
    gerade angelegte Sitzung durch den bestehenden `.in('gremium', meineGremien)`-Filter in
    `loadSessions()` sofort wieder aus der Liste herausfallen).
  - **`TerminDetailPanel.tsx`** generalisiert: das bisher nur für `kind='event'` sichtbare
    Bearbeiten/Löschen-UI (inkl. Formular) ist jetzt auch für `kind='session'` sichtbar, aber nur wenn
    `session.erstellt_von === userId` (`canManageSession`) - importierte Sitzungen zeigen weiterhin
    keine Bearbeiten/Löschen-Buttons. Das Bearbeiten-Formular zeigt kind-abhängig unterschiedliche
    Felder (Sitzungen: Gremium + Ebene statt Ende-Datum, das Sitzungen nicht haben). Der
    "Absagen/Reaktivieren"-Toggle bleibt bewusst event-exklusiv (für eine rückwirkend erfasste,
    bereits stattgefundene Sitzung ergibt eine nachträgliche Absage keinen Sinn).
  - Migration mit einer Nummer-Kollision gepusht: beim Erstellen lokal als `0020_...sql` angelegt,
    aber `0020_profiles_ebenen.sql` existierte auf der Live-DB bereits (zwischen den Sessions waren
    dort bereits Migrationen bis `0027` gelandet) - `supabase db push` bricht in diesem Fall vorher
    mit einer klaren Fehlermeldung ab, statt still zu kollidieren. Umbenannt auf `0028_...sql`, vor
    dem erneuten Push per SQL-Query gegen `information_schema.columns`/`pg_policies` verifiziert,
    dass `sessions.erstellt_von` und die drei neuen Policy-Namen auf der Live-DB noch nicht existieren
    (Fallstrick dabei: eine ungefilterte `information_schema.columns`-Abfrage nach `table_name =
    'sessions'` liefert zusätzlich Treffer aus `auth.sessions`, Supabases eigener Session-Tabelle -
    `table_schema = 'public'` muss immer mit angegeben werden).
  - Verifiziert per `tsc -b`/`vite build` sowie direkt gegen die Live-DB: Migration gepusht, neue
    Spalte/Policies per `pg_policies`-Query bestätigt.

- **Nachbesserung: manuell nachgetragene Sitzungen sahen anders aus als importierte** (seit
  2026-07-25, `0029_sessions_manuell_quelle.sql`): Nutzer-Feedback direkt nach dem ersten Test von
  0028 - eine rückwirkend erfasste "Rat der Stadt Iserlohn"-Sitzung zeigte in `Archiv.tsx` einen
  grauen "SITZUNG"-Badge statt des blauen "KOMMUNE"-Badges der importierten Sitzungen derselben
  Quelle. Root Cause, zwei Teile: (1) Badge-Text/-Farbe hingen ausschließlich an einer verknüpften
  `calendar_sources`-Zeile (`source ? EBENE_LABEL[source.ebene] : 'Sitzung'`), obwohl `sessions.ebene`
  längst direkt auf der Zeile selbst steht - bei `source_id = null` (jede manuelle Sitzung nach 0028)
  fiel das also immer auf den generischen Text/die Theme-Farbe zurück. (2) 0028 erzwang `source_id is
  null` beim manuellen Anlegen strikt, es gab also gar keine Möglichkeit, sich bewusst optisch in eine
  bestehende Quelle einzureihen.
  - Fix Teil 1 (überall, wo Sitzungs-Badges gerendert werden - `Archiv.tsx`, `CalendarView.tsx`
    Dashboard "Nächste Termine"): Fallback von `source?.ebene` auf `s.ebene`/`item.ebene` statt auf den
    hartkodierten String `'Sitzung'`. In `CalendarView.tsx` zusätzlich `AggregatedItem` um `ebene`
    erweitert, da auch die Ebenen-Filter-Chips (`ebenenPresent`/`filtered`) bisher ausschließlich über
    die Quelle liefen und manuelle Sitzungen dadurch in keinem Ebene-Filter auftauchten, nur unter
    "Alle".
  - Fix Teil 2 (`0029_sessions_manuell_quelle.sql`): `sessions_insert_manuell`/
    `sessions_update_own_manuell` erlauben jetzt `source_id` auf eine für den Nutzer sichtbare Quelle
    (gemeinsam verwaltet ODER eigene) zu setzen, statt nur `null`. Neues Auswahlfeld "Kalenderquelle"
    im "Sitzung nachtragen"-Formular (`Archiv.tsx`) und im Bearbeiten-Formular
    (`TerminDetailPanel.tsx`) - bei Auswahl wird `ebene` automatisch von der Quelle übernommen (Select
    dafür deaktiviert, um Inkonsistenzen zu vermeiden). `ics_uid` bleibt weiterhin ausschließlich dem
    Import-Job vorbehalten, keine RLS-Sonderbehandlung nötig, da das Frontend es nie setzt.
  - Das vom Nutzer in der Rückmeldung gezeigte Beispiel (Sitzung "Rat der Stadt Iserlohn" am
    2025-11-11, eigene Zeile, `erstellt_von` = Thorsten Kois) direkt per SQL auf `source_id` von
    "Stadtrat Iserlohn" nachgezogen, damit es nicht zusätzlich manuell in der UI nachgepflegt werden
    muss.
  - Verifiziert per `tsc -b`/`vite build`, Migration gegen die Live-DB gepusht.

- **Kalenderquellen-Art (Sitzungs-/Gremienkalender vs. Terminkalender) + Import-Horizont**
  (seit 2026-07-25, `0030_calendar_sources_art.sql`): Nutzerwunsch, zwei grundsätzlich verschiedene
  Kalendertypen zu unterscheiden. „Sitzungs-/Gremienkalender" (z. B. Stadtrat Iserlohn) funktionieren
  wie bisher: Sitzungen werden nach Gremium gefiltert, das Mitglied wählt in „Meine Gremien" gezielt
  aus. „Terminkalender" sind reine Terminlisten ohne Gremien-Konzept - **alle** Einträge sollen
  ungefiltert übernommen werden, ohne den Gremien-Auswahl-Schritt.
  - Neue Spalte `calendar_sources.art` (`'sitzung' | 'termin'`, Default `'sitzung'` - alle
    bestehenden Quellen sind Gremienkalender). Auswahl beim Anlegen/Bearbeiten einer Quelle in
    `Settings.tsx` (Kalenderquellen-Formulare), Badge „Terminkalender" in der Quellenliste, wenn
    `art = 'termin'`.
  - **Import-Skripte** (`scripts/import-ics.mjs`, `supabase/functions/import-ics-source/index.ts`):
    bei `art = 'termin'` wird bewusst **kein** `gremium` gesetzt (`extractGremium()` wird
    übersprungen) - sonst würde die heuristische SUMMARY-Auswertung Datenmüll in die
    „Meine Gremien"-Liste streuen, obwohl diese Quelle ohnehin ungefiltert übernommen wird. Dadurch
    reicht "gremium is null" bereits aus, um Terminkalender-Einträge aus der Gremien-Auswahl
    herauszuhalten, ohne zusätzliche Filterlogik in `Settings.tsx`.
  - **Anzeige-Logik** (`CalendarView.tsx` Dashboard "Nächste Termine", `Archiv.tsx` "Vergangene
    Sitzungen"): bisher ein einzelnes `.in('gremium', meineGremien)`. Jetzt zwei getrennte Abfragen
    (gremienweise gefiltert + `source_id in (Terminkalender-Quellen)`), client-seitig über eine
    `Map` nach `id` gemerged - bewusst **kein** roher `.or('gremium.in.(...),source_id.in.(...)')`-
    String, weil Gremiennamen im echten Feed bereits Sonderzeichen wie „/" enthalten
    („Verwaltungsrat Märkischer Stadtbetrieb Iserlohn/Hemer") und ein handgebauter PostgREST-
    Filter-String bei Kommas/Klammern in Freitext-Gremiennamen brechen könnte.
  - **"Sitzung nachtragen"/Bearbeiten-Formular** (`Archiv.tsx`, `TerminDetailPanel.tsx`): die
    Kalenderquellen-Auswahl aus der letzten Nachbesserung zeigt jetzt nur noch Quellen mit
    `art = 'sitzung'` - manuell erfasste Sitzungen sollen sich laut Nutzerwunsch ausschließlich in
    Sitzungskalender einreihen lassen, nicht in Terminkalender.
  - **Retroactiver Import-Horizont**: `MIN_IMPORT_DATUM = 2025-11-11` in beiden Import-Skripten -
    Feed-Einträge davor werden nicht (mehr) importiert. Fallstrick dabei vermieden: die
    Absage-Erkennung (`existingByUid`, vergleicht DB-Bestand gegen den aktuellen Feed) lädt jetzt
    ebenfalls nur Sessions ab diesem Datum - sonst hätte jede bereits importierte, ältere Sitzung
    beim nächsten Lauf fälschlich als "aus dem Feed verschwunden" gegolten und wäre automatisch auf
    `status = 'abgesagt'` gesetzt worden, obwohl sie laut Nutzerwunsch unverändert im Archiv bleiben
    soll ("Alte Termine sollen im Archiv erhalten bleiben"). Kein aktiver Backfill nötig: der
    Import holt ohnehin den kompletten Feed-Inhalt (nie datumsgefiltert vor dieser Änderung) - was
    ab 11.11.2025 im Feed steht, kommt beim nächsten Lauf automatisch rein.
  - "Alle auswählen"/"Alle abwählen" für "Meine Gremien" (`Settings.tsx`) ergänzt (Nutzerwunsch:
    "auch mit Option 'Alle wählen'") - Bulk-Insert bzw. -Delete auf `user_gremien`.
  - Verifiziert per `tsc -b`/`vite build`/`deno check` (beide Edge Functions), Migration gegen die
    Live-DB gepusht und per SQL-Query bestätigt (alle 5 bestehenden Quellen defaulten korrekt auf
    `art = 'sitzung'`).

- **Bugfix: vergangene Sitzungen wurden fälschlich als „abgesagt" markiert** (gefunden 2026-07-26,
  Nutzerfrage "Warum sind die Termine am 18. Mai abgesagt?"): Root Cause per direktem Feed-Vergleich
  verifiziert - die ALLRIS-Feeds liefern nur ein **rollierendes Zeitfenster** (an diesem Tag lieferte
  der "Stadtrat Iserlohn"-Feed z. B. nur noch Termine ab 01.06.2026, obwohl "heute" der 26.07.2026
  war). Die Absage-Erkennung ("UID war bekannt, taucht aber nicht mehr im aktuellen Feed auf = vermutlich
  abgesagt", ursprünglich eingeführt weil ALLRIS Absagen nicht über `STATUS:CANCELLED` markiert, sondern
  den Termin einfach aus dem Feed entfernt) konnte nicht unterscheiden zwischen "wirklich abgesagt" und
  "einfach nur aus dem rollierenden Zeitfenster herausgealtert" - beides sieht aus Sicht des Jobs
  identisch aus ("UID fehlt im aktuellen Fetch"). Betroffen waren 9 Sitzungen zwischen 18.05. und
  24.06.2026 (u. a. beide "CDU-Fraktion"-Termine am 18.05., Ausschuss für Umwelt- und Klimaschutz,
  Beirat für Inklusion, Kulturausschuss, je zweimal Sitzung des Kulturausschusses/
  Jugendhilfeausschusses über Kreistag/Kreistag MK, die beide dieselbe UID unter derselben
  zugrundeliegenden Kreis-Domain liefern).
  - Verifiziert: `titel`/`gremium` der betroffenen Sitzungen stimmen exakt mit der letzten bekannten
    Feed-Fassung überein (keine Verstümmelung, keine Klammer-Filterung o. ä. - reine
    Status-Fehlklassifikation).
  - Fix: die Absage-/Reaktivierungs-Erkennung berücksichtigt jetzt nur noch Sitzungen, deren `datum`
    noch nicht in der Vergangenheit liegt (`existing`-Query lädt ab `startOfTodayUtcIso()` statt ab
    `MIN_IMPORT_DATUM`) - eine bereits vergangene Sitzung wird vom Import-Job nie wieder angefasst,
    ihr letzter Status bleibt endgültig stehen. `MIN_IMPORT_DATUM` (11.11.2025) bleibt unverändert als
    reine Untergrenze dafür, was überhaupt neu importiert wird - ein separates, unabhängiges Konzept.
  - Die 9 fälschlich abgesagten Sitzungen direkt per SQL auf `status = 'geplant'` zurückgesetzt (hohe
    Konfidenz: alle betroffenen Sitzungen liegen weit genug in der Vergangenheit, dass eine echte
    Last-Minute-Absage zu diesem Zeitpunkt keinen operativen Sinn mehr ergäbe - eine Verwaltung sagt
    keine Sitzung ab, die vor Wochen schon hätte stattfinden sollen).
  - Verifiziert per `node -c`/`deno check`, Fix gegen die Live-Funktionen deployt.

## MCP-Server: Vergangenheits-Abfragen (`list_sessions`, `list_events`)

Nutzerwunsch: „den MCP Server erweitern, um auch Sitzungen/Termine aus der Vergangenheit abrufen zu
können" – bis dahin gab es mit `list_next_sessions` nur eine einzige Lese-Funktion, und die war fest
auf `datum >= now()` verdrahtet. Rückblick-Fragen („worüber wurde im letzten Verkehrsausschuss
gesprochen") waren damit nicht beantwortbar, und eigene Termine (`events`) waren über MCP überhaupt
nicht lesbar – nur anlegbar.

- `list_next_sessions` → **`list_sessions`** umbenannt und um Parameter erweitert:
  - `zeitraum`: `zukunft` (Standard, verhält sich exakt wie vorher) | `vergangenheit` | `alle`.
  - `nur_meine_gremien`: spiegelt die Vereinigungs-Semantik aus `CalendarView.tsx`/`Archiv.tsx`
    (Sitzungen der eigenen `user_gremien` **plus** alles aus Quellen mit `art = 'termin'`, die keine
    Gremien-Zuordnung haben). Bewusst **Standard `false`**, nicht `true`: ein Profil ohne ausgewählte
    Gremien (aktuell einer von vier Accounts) bekäme sonst kommentarlos eine leere Liste, und das
    bisherige Verhalten bliebe nicht erhalten. Bei leerer Auswahl *und* gesetztem Flag gibt es
    stattdessen einen erklärenden Hinweis statt „nichts gefunden".
  - `limit` (Standard 20, hart auf 100 gedeckelt).
- Neues Tool **`list_events`** (eigene Termine, gleiche `zeitraum`/`limit`-Parameter). Filtert
  manuell auf `user_id`, da der Service-Role-Client `events_select_own` umgeht. Kennzeichnet
  `herkunft = 'fraktionsbuero'` im Output.
- Sortierrichtung hängt am Zeitraum: `zukunft` aufsteigend (nächster Termin zuerst), sonst
  absteigend – sonst würde das Limit bei Vergangenheits-Abfragen die ältesten statt der jüngsten
  Einträge behalten.
- Die Vereinigungs-Abfrage bei `nur_meine_gremien` nutzt bewusst zwei `.in()`-Abfragen statt eines
  rohen `.or()`-Strings: Gremiennamen enthalten Kommas/Klammern und würden das PostgREST-Filterformat
  brechen (gleiche Begründung wie in `CalendarView.tsx`).
- Die manuell nachgebildete Quellen-Sichtbarkeit aus `sessions_select_visible_source` (Service-Role
  umgeht RLS) gilt unverändert für **alle** Zeiträume – ohne das hätte die Vergangenheits-Abfrage die
  208 Sitzungen der privaten Quelle „CDU Fraktion Iserlohn intern" eines anderen Mitglieds
  mitgeliefert.
- Verifiziert per `deno check` + direkten SQL-Gegenproben gegen die Live-DB (für den Account
  Thorsten Kois: 1 sichtbare Quelle von 4, 88 sichtbare vergangene Sitzungen, davon 70 nach
  Gremien-Filter, 1 vergangener/0 zukünftige eigene Termine). Ein Ende-zu-Ende-Test über den echten
  Connector stand zum Commit-Zeitpunkt noch aus, da Claude die Tool-Liste erst beim nächsten
  Verbindungsaufbau neu einliest.
- Nebenbei zwei veraltete Kommentare/Doku-Stellen korrigiert, die sich noch auf die in
  `0018_calendar_sources_privat.sql` **gelöschte** Policy `sessions_select_all` beriefen
  („Sitzungen sind für alle eingeloggten Nutzer lesbar") – Sitzungs-Sichtbarkeit hängt seitdem an der
  Kalenderquelle.

## MCP-Server: Lese-Tools für ToDos und Notizen (`list_todos`, `list_notes`)

Der Connector war bis hierhin stark schreiblastig: 5 von 7 Tools schrieben, gelesen wurde nur
`list_sessions`/`list_events`. Fragen wie „was steht noch offen" oder „was habe ich zur letzten
Ratssitzung notiert" waren nicht beantwortbar, obwohl `create_todo` und `create_*_note` genau diese
Daten längst anlegen konnten. Auf Vorschlag (nach Durchsicht der App: Anträge, ToDo-Bearbeiten,
Fristen, Volltextsuche standen ebenfalls zur Auswahl) hat sich der Nutzer für diese beiden
Lese-Tools als nächsten Schritt entschieden.

- **`list_todos`**: eigene UND mit dem Nutzer geteilte Karten (`todo_placements`, seit
  `0021_todo_erledigt_sharing.sql` - Service-Role-Client umgeht `todos_select_own_or_placed`, daher
  zwei separate Abfragen `eq('user_id', userId)` + `in('id', placedTodoIds)` und Merge per Map statt
  eines RLS-äquivalenten Filters). Parameter `status` (offen/erledigt/alle), `spalte`
  (Teilstring-Filter auf den Spaltentitel des Nutzers - jede Person hat eigene `todo_columns`, auch
  für geteilte Karten) und `limit`. Sortierung: offen/alle nach `faellig_am` (ohne Fälligkeit ans
  Ende), erledigt nach `erledigt_am` absteigend.
- **`list_notes`**: liest `summaries` zurück - das Gegenstück zu den drei `create_*_note`-Tools.
  Ohne Filter die zuletzt gespeicherten Einträge über alle Ziele hinweg, mit genau einem der
  `session_id`/`event_id`/`todo_id`-Filter (mehr als einer gleichzeitig ist ein Fehler) alle
  Einträge zu genau diesem Objekt. Titel der verknüpften Sitzung/Termin/ToDo werden in je einer
  Sammelabfrage nachgeladen (`in('id', [...])` statt N+1). Text wird bei ungefiltertem Aufruf auf
  500 Zeichen gekürzt (sonst sprengt eine breite Liste die Chat-Antwort), bei genau einem Filter auf
  4000 Zeichen (enger Kontext, dort ist der volle Text meist gewollt). Datei-Anhänge werden nur mit
  Dateinamen genannt (`fileNameFromPath()`, gleiche Logik wie `DocumentPreviewModal.tsx`) - der
  Dateiinhalt ist über MCP nicht herunterladbar, das wäre eine zusätzliche Signed-URL-Erzeugung, die
  hier bewusst nicht gebaut wurde. Anträge (`antrag_id`) bleiben außen vor, solange es keine
  Antrags-Tools gibt.
- Verifiziert per `deno check` + SQL-Gegenproben gegen die Live-DB (4 offene ToDos, 3 Notizen für
  den Account Thorsten Kois; alle erwarteten `summaries`-Spalten inkl. `antrag_id` vorhanden). Ein
  Ende-zu-Ende-Test über den echten Connector stand zum Commit-Zeitpunkt noch aus (Tool-Liste wird
  erst beim nächsten Verbindungsaufbau neu eingelesen, siehe die MCP-Connector-Historie weiter oben).

## MCP-Server: Anträge komplett, ToDos bearbeiten, Fristen, Volltextsuche

Nutzerwunsch „mach das alles" nach einem Befund beim Durchgehen der App: der Connector deckte
Anträge (kompletter App-Bereich mit Status-Workflow, Teilen, Fristen) überhaupt nicht ab, ToDos
waren nur anlegbar/lesbar, aber nicht bearbeitbar/abhakbar, und es gab keine Fristen-Berechnung
oder Volltextsuche. Acht neue Tools ergänzt, macht 17 insgesamt.

- **Anträge**: `create_antrag` (übernimmt `ausschuss`/`ebene` aus `session_id`, wie das
  „+ Antrag"-Formular in `AntraegeSection.tsx`), `list_antraege` (Status-Filter inkl. `aktiv` =
  `ANTRAG_STATUS_AKTIV`), `update_antrag_status` (repliziert die `eingereicht_am`-Automatik aus
  `AntragDetailModal.tsx`: nur beim Übergang auf `gestellt` automatisch auf heute setzen, `ergebnis`
  bei `status="abgestimmt"` Pflicht), `create_antrag_note`.
- **ToDos bearbeiten**: `complete_todo` (repliziert die `erledigt_am`-Automatik aus
  `TodoDetailModal.tsx`: nur beim Übergang false→true neu setzen), `update_todo` (Titel/Beschreibung/
  Fälligkeit/Zuständigkeit/Spalte - "spalte" verschiebt nur die eigene `todo_placements`-Zeile des
  aufrufenden Nutzers, nicht die anderer Personen auf geteilten Karten, da jede Person ein eigenes
  Board hat).
- **`list_antrag_fristen`**: rechnet `computeAntragDeadline()` aus `src/lib/antragDeadline.ts` nach
  (Sitzungsdatum minus die für die Ebene konfigurierte Vorlaufzeit aus
  `antrag_deadline_settings`) - per SQL-Gegenprobe exakt verifiziert (14 Tage vor einer Sitzung am
  02.09. ergibt korrekt 19.08.).
- **`search`**: Volltextsuche über ToDos (Titel/Beschreibung), Anträge (Titel/Inhalt) und Notizen
  (Inhalt), jeweils eigene + geteilte Einträge. Bewusst **kein** `.or('titel.ilike.X,beschreibung.
  ilike.X')` mit eingesetztem Suchbegriff - ein Komma oder eine Klammer im Suchbegriff hätte das
  PostgREST-Filterformat gebrochen (gleiche Fehlerklasse wie Gremiennamen in
  `list_sessions`/`CalendarView.tsx`). Stattdessen je Spalte eine eigene, einfache `.ilike()`-Abfrage
  und Merge per `Map` in JS. Ein erster Anlauf mit generischen Helper-Funktionen (eine Funktion, die
  je nach Aufrufer verschiedene `.eq()`/`.in()`-Filter auf denselben Query-Builder anwendet) scheiterte
  an TypeScript: `ReturnType<typeof supabase.from>` lässt sich nicht sinnvoll weiterverketten, und ein
  `Promise.all()` über ein Array mit **unterschiedlich typisierten** Query-Ergebnissen (Todos vs.
  Anträge vs. Notizen) inferiert einen Common-Type über alle Elemente, der keine der ursprünglichen
  Feldnamen mehr kennt - am Ende explizit ausgeschriebene, sequenzielle Abfragen statt der cleveren
  Abstraktion (etwas langsamer, aber typsicher und nachvollziehbar).
- **`NoteTargetConfig`/`createNote()`** (bisher nur `sessions`/`events`/`todos`) um `antraege` und ein
  neues Feld `sharedVia` erweitert (Zusatz-Zugriffsweg neben `user_id = userId`, z. B.
  `todo_placements`/`antrag_shares`) - `create_todo_note`/`create_antrag_note` erlauben Notizen jetzt
  auch auf geteilten Karten/Anträgen, nicht nur eigenen. Dabei zwei Stolperfallen gefixt, bevor
  `deno check` grün war:
  1. Ein laufzeitabhängiger `select()`-String (unterschiedliche Spalten je nach `ownerScoped`)
     verwirrte supabase-js' Typinferenz zu einem `ParserError`-Typ - Fix: immer dieselbe konstante
     Spaltenliste abfragen (`id, titel`), Ownership separat in einer zweiten, eigenen Abfrage prüfen.
  2. `sessions` hat gar keine `user_id`-Spalte (anders als `events`/`todos`/`antraege`) - ein
     einheitliches `select('id, titel, user_id')` über alle vier Zieltabellen hinweg hätte für
     `create_session_note` einen Laufzeitfehler ausgelöst.
- Verifiziert per `deno check`, Deploy, und einer temporären, anschließend wieder gelöschten
  Test-Fixtur direkt in der Live-DB (Test-Antrag mit Sitzungsbezug + temporäre
  `antrag_deadline_settings`-Zeile: Sichtbarkeitsfilter, Fristen-Formel, `search`-Treffer und die
  `eingereicht_am`-Automatik einzeln nachgerechnet, danach beide Testzeilen gelöscht - kein
  Ende-zu-Ende-Test über den echten Connector, da dessen Tool-Liste erst beim nächsten
  Verbindungsaufbau neu eingelesen wird).

## MCP-Server: in Module aufgeteilt (reine Umstrukturierung)

`supabase/functions/mcp-server/index.ts` war auf 1560 Zeilen gewachsen (17 Tools in einer Datei) -
für eine Edge Function unhandlich groß geworden. Aufgeteilt, ohne das Verhalten zu ändern:

- `shared.ts` - JSON-RPC-Helfer, Auth (`resolveUser`/`sha256Hex`), Format-/Pagination-Helfer
  (`formatDateTime`, `formatDate`, `truncate`, `fileNameFromPath`, `parseLimit`,
  `parseZeitraum`/`sortAscending`/`zeitraumLabel`), `corsHeaders`.
- `tools_schema.ts` - das `TOOLS`-Array (reine JSON-Schema-Deklarationen).
- `tools/todos.ts`, `tools/events.ts`, `tools/sessions.ts`, `tools/antraege.ts`, `tools/notes.ts`,
  `tools/search.ts` - je Domäne eine Datei mit den Implementierungen.
- `index.ts` - nur noch `Deno.serve`, JSON-RPC-Parsing/Auth/Dispatch (221 Zeilen).

Supabase Edge Functions unterstützen relative Imports innerhalb des Funktionsordners problemlos -
`supabase functions deploy` erkennt und lädt automatisch alle importierten Dateien mit hoch (im
Deploy-Log einzeln aufgelistet). Nach dem Deploy dieselben Prüfungen wie beim letzten CORS-Fix
wiederholt (Preflight-Header, `verify_jwt=false`, HTTP 200 statt 401 bei Auth-Fehlern) - alle
identisch zum Stand vor der Aufteilung, wie erwartet bei einer reinen Umstrukturierung.

## Presseschau (optionaler Newspaper-Abschnitt auf dem Dashboard)

Nutzerwunsch: eine täglich per KI erstellte Presseschau (Beispielformat: `Presseschau IKZ –
28.07.2026.md`, Markdown mit Abschnitten je Gremium/Kategorie) soll im Dashboard übersichtlich als
Zeitungsübersicht mit Tage-Navigation erscheinen – optional pro Mitglied aktivierbar, standardmäßig
unsichtbar, und strikt privat (nicht für andere Mitglieder sichtbar, auch wenn diese ebenfalls
Presseschauen hochladen).

- **Datenmodell**: neue Tabelle `presseschauen` (`user_id`, `datum`, `titel`, `quelle`, `inhalt` als
  Markdown-Text, `unique(user_id, datum)`) – bewusst **kein** Storage-Blob wie bei `summaries`, da der
  Inhalt reiner Text ist, der direkt gerendert werden soll (kein Sinn in signierten URLs für reinen
  Text). RLS-Policy `presseschauen_manage_own` analog `summaries_manage_own`. Neue Spalte
  `profiles.presseschau_aktiv` (boolean, default false) als Ein/Aus-Schalter – ohne die Spalte wäre
  der Abschnitt für alle sichtbar, sobald irgendwer per MCP einen Eintrag hochlädt.
- **MCP-Tool `upload_presseschau`** (`tools/presseschau.ts`): Upsert auf `(user_id, datum)`, `inhalt`
  Pflicht, `datum` optional (Standard: heute in Europe/Berlin, nicht die UTC-Serverzeit der Edge
  Function – sonst würde ein Upload kurz nach Mitternacht Berliner Zeit auf den Vortag fallen).
  Erneuter Upload für denselben Tag ersetzt den bisherigen Inhalt (Korrektur statt Duplikat) statt
  einen zweiten Eintrag anzulegen. Der Upload funktioniert unabhängig vom `presseschau_aktiv`-Schalter
  immer – der Schalter steuert nur die Anzeige im Dashboard.
- **Settings**: neuer Abschnitt „Presseschau" mit einem einzelnen Checkbox-Schalter
  (`togglePresseschau`), der `profiles.presseschau_aktiv` umschaltet.
- **`PresseschauSection.tsx`**: newspaperartige Darstellung (Serifenschrift, Doppellinie unter dem
  Masthead, zweispaltiger Fließtext ab `sm:`-Breakpoint via `columns-2`) mit Pfeil-Navigation, die
  nur zwischen **tatsächlich vorhandenen** Presseschau-Tagen blättert (nicht zwischen Kalendertagen) –
  Presseschauen werden unregelmäßig hochgeladen. Lädt zunächst nur `(id, datum)` aller eigenen
  Einträge, den vollen Text erst je ausgewähltem Eintrag nach, damit ein wachsender Bestand nicht
  komplett in den Speicher geladen wird. Markdown-Rendering über `react-markdown` (neue Abhängigkeit)
  statt eines eigenen Parsers – Sicherheits- und Korrektheitsgründe (kein
  `dangerouslySetInnerHTML`). Eigenes, schlankes CSS für die Markdown-Typografie
  (`.mc-presseschau-content` in `index.css`) statt `@tailwindcss/typography`, da nur eine Handvoll
  Elemente vorkommen (Überschriften, Absätze, Listen, Fett/Kursiv, Trennlinie).
- **Dashboard**: Abschnitt erscheint direkt unter dem Header, noch vor dem ToDo-Board (prominenteste
  Position), aber nur wenn `profiles.presseschau_aktiv = true` – ohne aktivierten Schalter sieht das
  Dashboard exakt wie vorher aus.
- Design visuell verifiziert über einen temporären, nicht verlinkten Test-Harness
  (`src/dev/PresseschauPreview.tsx` + Route, nach der Prüfung wieder entfernt) mit Beispieltext aus
  der echten Presseschau-Vorlage – echter Login-Rundgang war nicht möglich (Passwort-Eingabe im
  Browser ist laut CLAUDE.md tabu), stattdessen Desktop- und Mobile-Breite geprüft (Zweispaltig ab
  `sm:`, einspaltig darunter).

### Presseschau: `datum` bei `upload_presseschau` von optional auf Pflicht (Bugfix)

Nutzer-Feedback nach dem ersten Test: mehrfache Uploads am selben realen Kalendertag haben sich
gegenseitig überschrieben, obwohl inhaltlich unterschiedliche Presseschau-Ausgaben gemeint waren -
gewünscht war, durch die einzelnen Tage navigieren zu können. Root Cause per Diagnose bestätigt:
Backend/Upsert (`(user_id, datum)`) funktionieren korrekt (zwei Testuploads mit explizit
unterschiedlichem `datum` blieben als zwei separate, navigierbare Zeilen erhalten) - das Problem war
der bisherige stille Default `datum = heute` bei fehlendem Parameter: gab der aufrufende Client kein
`datum` an (z. B. weil er es für unnötig hielt oder das Ausgabedatum nicht explizit herausgelesen
hat), landeten mehrere Uploads am selben Tag unbemerkt auf demselben Datensatz.

Fix: `datum` ist jetzt in `tools/presseschau.ts` und `tools_schema.ts` ein **Pflichtfeld** (kein
Default mehr, `todayBerlin()`-Helper entfernt) - der Aufruf schlägt ohne `datum` explizit mit einer
Fehlermeldung fehl, statt still das falsche Datum zu wählen. Tool-Beschreibung ergänzt: das
tatsächliche Ausgabedatum verwenden (z. B. aus dem Dateinamen der Vorlage), nicht das aktuelle
Tagesdatum raten. Verifiziert per `deno check`, Deploy, und direktem Testaufruf über den echten
MCP-Connector (Aufruf ohne `datum` schlägt jetzt korrekt fehl; zwei Aufrufe mit unterschiedlichem
`datum` legen zwei separate, per SQL-Abfrage auf der Live-DB bestätigte Zeilen an, anschließend
wieder gelöscht).

### Presseschau: kompakte Karte statt vollem Zeitungsabschnitt auf dem Dashboard

Nutzer-Feedback nach dem ersten Live-Test (per PDF-Screenshot des echten Dashboards belegt): die
vollständig ausgeschriebene Presseschau ganz oben hat ToDo-Board, „Nächste Termine" und „Meine
Dokumente" so weit nach unten gedrückt, dass man scrollen musste, um sie zu sehen - Wunsch war ein
"Wow-Effekt", nutzerfreundliches, "wie von Apple" wirkendes Design, das die Presseschau trotzdem
prominent zeigt.

- **`PresseschauSection.tsx`** zeigt jetzt nur noch eine kompakte, klickbare Karte (Masthead +
  Tages-Navigation wie vorher, aber Body auf Überschrift + zweizeiligen Anreißer-Text reduziert,
  `line-clamp-2`) statt des vollen Artikels. Ganze Karte ist Click-Target (`role="button"`,
  `tabIndex`, Enter/Space) mit Hover-Lift (`-translate-y-0.5` + Schatten) und Press-Feedback
  (`active:scale-[0.995]`) - Tage-Navigation-Pfeile bleiben eigene `<button>`s mit
  `stopPropagation()`, kein verschachteltes `<button>`.
- **Anreißer-Text (`extractTeaser()`)**: bevorzugt den Inhalt eines `## Kernaussage`-Abschnitts (die
  Presseschau-Vorlage schreibt dort bereits eine von der KI verfasste Zusammenfassung, siehe
  `docs/`-Beispieldatei) statt blind die ersten Zeichen des Volltexts zu nehmen - inhaltlich
  sinnvoller als eine Zufalls-Kürzung mitten im Fließtext. Fällt ohne passenden Abschnitt auf
  Markdown-bereinigten Volltext zurück.
- **Neu: `PresseschauReaderModal.tsx`** - der komplette, vorher inline auf dem Dashboard stehende
  Zeitungslayout-Leseblock (Masthead, zweispaltiger Fließtext, Tage-Navigation) lebt jetzt in einem
  fokussierten Overlay (analog Safari-Lesemodus/Apple News), das beim Klick auf die Karte erscheint -
  `bg-slate-900/60 backdrop-blur-sm` als Scrim, `mc-animate-pop`-Karte (bereits bestehende
  Projekt-Animation, keine neue Bewegungssprache eingeführt). Bekommt `current`/`isNeuest`/
  `isAeltest`/`onPrev`/`onNext` von `PresseschauSection` durchgereicht statt selbst nachzuladen - die
  Daten sind dort ohnehin schon im State (kein doppelter Request).
- Design-Referenz für "Apple-Wow-Effekt, nutzerfreundlich, innovativ" bewusst auf Basis der
  `apple-design`-Skill-Prinzipien umgesetzt (Materialisierung via `backdrop-filter`+Scale statt
  reinem Opacity-Fade, kritisch gedämpfte statt überschwingende Eintritts-Bewegung, Response auf
  Pointer-Down über `active:`-Press-States) - bewusst **keine** neue Spring-/Gesten-Bibliothek
  eingeführt, da die Interaktion (Klick zum Öffnen/Schließen) nicht gestengetrieben ist und die
  bestehenden CSS-Keyframe-Animationen (`mc-animate-pop`/`mc-animate-fade`) dafür ausreichen.
- Verifiziert per `tsc -b`/`vite build` und einem temporären, anschließend wieder gelöschten
  Test-Harness (`src/dev/DashboardFoldPreview.tsx` + Route) bei 1280×800 (typische Laptop-Auflösung)
  und mobiler Breite: ToDo-Board/Nächste Termine/Meine Dokumente jetzt ohne Scrollen sichtbar, Reader
  öffnet/schließt korrekt.

### Wiederkehrende Termine (RRULE) wurden nie als "nächster Termin" angezeigt (Bugfix)

Nutzer-Feedback: unter "Nächste Termine" erschienen nur Gremiensitzungen, keine Termine aus reinen
Terminkalender-Quellen (`calendar_sources.art = 'termin'`). Ursache per Diagnose gefunden (ICS-Feed
der betroffenen Quelle direkt heruntergeladen und mit `node-ical` geparst, live gegen die Produktions-
DB abgeglichen): ein wiederkehrender Termin (RRULE, z. B. "jeden Montag" ohne UNTIL) liefert in
`entry.start` nur den ERSTEN Termin der Serie - `node-ical` expandiert Wiederholungen nicht selbst.
War dieser erste Termin (hier: seit 2025) bereits vergangen, verschwand die komplette Serie aus dem
Import, obwohl sie z. B. jeden Montag weiter stattfindet ("Fraktionsvorstand"/"Fraktionssitzung" in der
betroffenen Quelle). Gremiensitzungen aus ALLRIS-Feeds sind davon nicht betroffen, da ALLRIS jede
Sitzung einzeln exportiert statt RRULE zu nutzen - daher fiel der Bug nur bei "termin"-Quellen auf.

- **Fix** (`scripts/import-ics.mjs` + `supabase/functions/import-ics-source/index.ts`, wie immer
  bewusst dupliziert statt geteiltem Modul, siehe CLAUDE.md): neue Funktion `expandOccurrences()`
  nutzt das von `node-ical` bei RRULE-Terminen mitgelieferte fertige `rrule.js`-Objekt
  (`entry.rrule.between(von, bis)`) statt einer neuen Abhängigkeit, um alle Vorkommen zwischen
  `MIN_IMPORT_DATUM` und einem Jahr in die Zukunft (`RECURRENCE_HORIZON_MS`, Obergrenze nötig, da eine
  RRULE ohne UNTIL unendlich ist) einzeln zu erzeugen. Jedes Vorkommen bekommt eine eigene, stabile
  `ics_uid` (`<uid>::<ISO-Zeitstempel>`) fürs Upsert. Individuell geänderte Einzeltermine
  (RECURRENCE-ID) tauchen im Feed bereits als eigener VEVENT mit eigener uid auf (normaler Zweig,
  unverändert) - deren Datum wird beim Expandieren der Basis-Serie übersprungen (`entry.recurrences`-
  Keys), sonst gäbe es für den Tag zwei widersprüchliche Zeilen.
- Der bisherige Vorfilter (`new Date(entry.start) >= MIN_IMPORT_DATUM`) hätte wiederkehrende Termine
  mit altem Serienstart weiterhin komplett verworfen, BEVOR die Expansion überhaupt zum Zug kommt -
  Filter entsprechend angepasst: `entry.rrule` gesetzt ODER `start >= MIN_IMPORT_DATUM`.
- Verifiziert per `node --check`/`deno check` sowie einem lokalen Trockenlauf gegen den echten,
  frisch heruntergeladenen ICS-Feed der betroffenen Quelle (13 Roheinträge → 189 expandierte Zeilen,
  davon 104 in der Zukunft, u. a. "Fraktionsvorstand"/"Fraktionssitzung" ab 17.08.2026 - vorher 0
  zukünftige Einträge aus dieser Quelle). Edge Function deployt; `import-ics.yml`
  (`workflow_dispatch`) danach manuell angestoßen, um die Korrektur sofort statt erst beim
  nächsten planmäßigen 04:00-UTC-Lauf in die Produktions-DB zu übernehmen.

### MCP: chunked File-Upload für größere Dateien (PDF-Anhänge über ~13 KB)

Nutzer-Feedback (mit konkreter Fehlerdiagnose des aufrufenden Claude-Sessions mitgeliefert): der
`datei_base64`-Parameter von `create_todo_note` wurde bei einer 54,6-KB-PDF (72.792 Base64-Zeichen)
nach ca. 18.000–20.000 Zeichen abgeschnitten - der Server hat den unvollständigen Base64-String
korrekt als ungültig zurückgewiesen, es wurde nichts Kaputtes gespeichert. Root Cause: eine Grenze
der Tool-Aufruf-**Generierung** des aufrufenden MCP-Clients selbst (wie lang ein einzelnes
String-Argument beim Erzeugen des Tool-Aufrufs zuverlässig werden kann), keine Beschränkung von
MandatsCockpit - Edge Functions/PostgREST hätten ein 73-KB-JSON-Body-Feld anstandslos akzeptiert.
Datei-Transfers über MCP sind deshalb grundsätzlich auf kleine Häppchen pro Tool-Aufruf angewiesen,
unabhängig davon, welcher konkrete MCP-Client/welches Modell aufruft.

- **Neue Tools** (`tools/uploads.ts`): `start_file_upload(dateiname)` legt eine `mcp_uploads`-Zeile an
  und liefert eine `upload_id`; `append_file_chunk(upload_id, chunk_index, chunk_base64)` speichert
  je ein Häppchen (empfohlen ≤ 8000 Zeichen) in `mcp_upload_chunks` - ein erneuter Aufruf mit
  derselben `chunk_index` überschreibt per Upsert (`primary key (upload_id, chunk_index)`) statt ein
  Duplikat anzulegen, robust gegen Wiederholungsversuche; `finish_file_upload(upload_id)` prüft
  lückenlose Nummerierung (0..n-1), setzt alle Häppchen zusammen, dekodiert das Ergebnis, lädt es in
  den bestehenden `zusammenfassungen`-Bucket hoch und liefert einen `datei_pfad`.
- **`createNote()`** (`tools/notes.ts`, genutzt von allen vier `create_*_note`-Tools) akzeptiert jetzt
  zusätzlich `datei_pfad` als Alternative zu `dateiname`+`datei_base64` - direkter Storage-Pfad einer
  bereits per `finish_file_upload` hochgeladenen Datei, kein erneuter Base64-Umweg nötig. Manuell
  geprüft, dass `datei_pfad` mit `<user_id>/` beginnt (Service-Role-Client umgeht Storage-RLS, ohne
  diese Prüfung könnte ein erratener/bekannter fremder Pfad an die eigene Notiz gehängt werden).
- **Migration `0032_mcp_chunked_uploads.sql`**: `mcp_uploads` (id, user_id, dateiname, erstellt_am)
  + `mcp_upload_chunks` (upload_id, chunk_index, chunk_base64, PK darauf) mit
  `on delete cascade` - ein gelöschter Upload räumt seine Häppchen automatisch mit auf.
  `start_file_upload` löscht zusätzlich eigene, älter als 1 Stunde nie abgeschlossene Uploads dieses
  Nutzers, bevor es einen neuen anlegt - vermeidet unbegrenztes Anwachsen ohne eigenen Cleanup-Cron.
- Alle vier `create_*_note`-Tool-Beschreibungen in `tools_schema.ts` warnen jetzt explizit vor der
  ~13-KB-Grenze bei `dateiname`+`datei_base64` und verweisen auf den Chunk-Upload-Weg.
- Verifiziert per `deno check` sowie einem direkten End-to-End-Trockenlauf gegen die Produktions-DB
  (20-KB-Zufallsdatei in 4 Häppchen à ≤ 7000 Zeichen zerlegt, inkl. einem bewussten
  Wiederholungs-Insert für `chunk_index=0` zur Upsert-Prüfung, wieder zusammengesetzt und
  Byte-für-Byte mit dem Original verglichen: identisch; Cascade-Delete beim Aufräumen der
  Testzeile ebenfalls bestätigt - 0 verwaiste Chunk-Zeilen danach).

### MCP-Datei-Uploads: falscher Content-Type verhinderte PDF-Vorschau (Bugfix)

Nutzer-Feedback: ein über den MCP-Server hochgeladenes PDF stand im Dashboard nur zum Download
bereit, statt wie andere PDFs direkt im Vorschau-Modal (`DocumentPreviewModal.tsx`, `<iframe>`) zu
öffnen. Ursache per direkter Abfrage von `storage.objects.metadata` in der Produktions-DB bestätigt:
das betroffene PDF hatte `mimetype: "text/plain;charset=UTF-8"` gespeichert, alle über die Web-UI
hochgeladenen PDFs dagegen korrekt `application/pdf`. `supabase.storage.upload()` ohne explizite
`contentType`-Option leitet den Content-Type bei einem echten Browser-`File`-Objekt automatisch aus
dessen `.type` ab (Web-UI-Uploads) - bei den MCP-Upload-Pfaden wird aber ein reines,
Base64-dekodiertes `Uint8Array` ohne Typ-Information hochgeladen, wofür Supabase Storage ersatzweise
`text/plain;charset=UTF-8` verwendet. Browser rendern Inhalt mit diesem Content-Type nicht in einem
PDF-`<iframe>`, sondern bieten nur den Download an - unabhängig von der `.pdf`-Dateiendung im
Storage-Pfad, auf die `DocumentPreviewModal.tsx` für die Vorschau-Entscheidung eigentlich abstellt.

- **Fix**: neue Funktion `guessContentType(dateiname)` in `shared.ts` (Endung → MIME-Type,
  `pdf`/`png`/`jpg`/`docx`/... → passender Typ, Fallback `application/octet-stream`) - beide
  MCP-Upload-Stellen (`createNote()` in `notes.ts` für den direkten Base64-Pfad, `finishFileUpload()`
  in `uploads.ts` für den Chunk-Upload-Pfad) übergeben jetzt `{ contentType: guessContentType(...) }`
  an `.storage.upload()`, genau wie es ein echtes `File`-Objekt aus der Web-UI automatisch tut.
- **Bereits betroffenes Dokument** direkt repariert: `update storage.objects set metadata =
  jsonb_set(metadata, '{mimetype}', '"application/pdf"') where ...` auf der Produktions-DB - kein
  erneuter Upload nötig, die Bytes selbst waren immer korrekt, nur der gespeicherte Content-Type war
  falsch.
- Verifiziert per `deno check`, Deploy, sowie einer SQL-Abfrage auf `storage.objects.metadata` vor
  und nach der Korrektur (vorher `text/plain;charset=UTF-8`, danach `application/pdf`, wie bei allen
  anderen PDFs in der Tabelle). Kein Live-HTTP-Test des ausgelieferten Content-Type-Headers möglich
  ohne Zugriff auf den Service-Role-Key (bewusst nicht extrahiert/umgangen).

### Nachtrag: `jsonb_set` auf `storage.objects.metadata` reichte nicht - echter Re-Upload nötig

Nutzer-Test nach dem vorherigen Fix: die direkte SQL-Korrektur (`update storage.objects set
metadata = jsonb_set(...)`) hat den tatsächlich ausgelieferten Content-Type NICHT verändert - der
Browser bot beim betroffenen Dokument weiterhin nur den Download an, während andere PDFs korrekt in
der Vorschau öffneten (per Screenshot belegt). Ursache: `storage.objects` ist nur die
Postgres-Katalogtabelle; der tatsächlich ausgelieferte `Content-Type`-Header kommt vom
Object-Storage-Backend selbst (S3-kompatibel), dessen eigene, separat gespeicherte Objekt-Metadaten
durch ein `UPDATE` auf die Postgres-Zeile nicht angefasst werden.

**Echter Fix**: Datei per `supabase storage cp --linked --experimental` lokal heruntergeladen
(Byte-Identität mit der ursprünglich hochgeladenen Datei über die bekannte Dateigröße 54.593 Bytes
verifiziert), das existierende Objekt unter demselben Pfad per `supabase storage rm --yes` gelöscht
(kein `--upsert`-Flag bei `storage cp` verfügbar, ein direktes Überschreiben schlägt mit HTTP 409
"KeyAlreadyExists" fehl) und mit `supabase storage cp --content-type application/pdf` unter exakt
demselben Storage-Pfad neu hochgeladen - der `summaries.datei_url`-Verweis auf diesen Pfad blieb
dadurch gültig, kein DB-Update nötig. Metadaten-Abfrage danach bestätigt: `mimetype: application/
pdf`, `size: 54593` (unverändert). Der eigentliche Code-Fix (`guessContentType()` in beiden
MCP-Upload-Pfaden) war bereits vorher korrekt und sorgt dafür, dass künftige Uploads dieses manuelle
Nachbessern gar nicht erst brauchen.
