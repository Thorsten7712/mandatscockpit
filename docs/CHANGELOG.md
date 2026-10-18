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

### ToDo-/Antrags-Detail-Modal zeigte Text-Notizen ohne Datei-Anhang gar nicht an (Bugfix)

Nutzer-Feedback (mit Screenshots belegt): über den MCP-Server angelegte ToDo-Karten (`create_todo`
+ anschließend `create_todo_note` mit reinem Freitext, ohne Datei) zeigten im Karten-Detail-Modal im
"Dokumente"-Abschnitt nur einen einsamen "Löschen"-Link, keinerlei sichtbaren Text - obwohl die Notiz
laut Bestätigungsmeldung des aufrufenden Claude-Sessions erfolgreich gespeichert wurde.

Ursache in `TodoDetailModal.tsx`/`AntragDetailModal.tsx` gefunden: die "Dokumente"-Liste rendert pro
`summaries`-Zeile nur `{d.datei_url && <button>📎 ...</button>}` - eine Zeile mit `inhalt`-Text aber
ohne `datei_url` (genau der Fall bei `create_todo_note`/`create_antrag_note` ohne Datei-Anhang)
erzeugte dadurch ein leeres `<li>` mit nur dem Löschen-Button, der eigentliche Notiztext ging visuell
komplett verloren (war aber die ganze Zeit korrekt in der DB gespeichert - reiner Anzeigefehler).
`TerminDetailPanel.tsx` ("Notizen & Dokumente" bei Terminen/Sitzungen) hatte diesen Fall bereits
korrekt über `{s.inhalt && <p>...}` abgedeckt - die beiden anderen, strukturell ähnlichen Modals
(ToDo-Karte, Antrag) waren beim ursprünglichen Bau offenbar nicht 1:1 nachgezogen worden.

- **Fix**: `{d.inhalt && <p className="text-sm whitespace-pre-wrap">{d.inhalt}</p>}` in beiden
  Modals ergänzt (identisches Muster wie in `TerminDetailPanel.tsx`), Listenelement von
  `flex items-center justify-between` auf eine gestapelte Struktur umgestellt (Text/Datei-Chip oben,
  Zeitstempel + Löschen-Button in einer eigenen Zeile darunter) - vorher hätte ein langer Notiztext
  neben dem Löschen-Button gequetscht ausgesehen. Zeitstempel (`erstellt_am`) dabei ergänzt, analog
  zu `TerminDetailPanel.tsx`, vorher fehlte er in beiden Modals komplett.
- Verifiziert per `tsc -b`/`vite build` sowie einem temporären, anschließend wieder gelöschten
  Test-Harness (`src/dev/DocListPreview.tsx` + Route) mit drei Fällen (nur Text, nur Datei, beides) -
  alle drei rendern jetzt korrekt.

## Dokumenten-Hub: neuer Reiter für geteilte (Partei/Ebene) + persönliche Dokumente

Nutzerwunsch: ein neuer, eigenständiger Reiter neben dem Archiv für zwei Dokument-Kategorien -
"geteilt" (sichtbar für alle Mitglieder derselben Partei UND derselben Ebene/Gliederung, z. B.
"Kommune Iserlohn", getaggt mit Ebene + freien Tags wie Antrag/Fact Sheet/Argumentationshilfe) und
"persönlich" (nur für den Hochladenden, getaggt mit freien Tags wie Einschätzung/Analyse/
Redebeitrag). Beides sowohl über die Web-UI als auch über den MCP-Server befüllbar, mit Filtern und
Farbmarkierungen. Geplant via `EnterPlanMode`/`ExitPlanMode` (Architektur-Entscheidungen vorab mit dem
Nutzer abgestimmt, Plan unter `.claude/plans/shimmering-wibbling-kahn.md`), da die Partei/Ebene-
Sichtbarkeit sicherheitsrelevant ist (RLS).

- **Migration `0033_dokumente.sql`**: neue Tabelle `dokumente` (`user_id`, `titel`, `sichtbarkeit`
  `persoenlich`/`geteilt`, `ebene`, `gliederung`, `tags text[]`, `inhalt`, `datei_url`,
  `erstellt_am`). Das bereits bestehende, aber komplett ungenutzte `documents`-Table (0001_init.sql,
  keine einzige Insert-Stelle im gesamten Code) wurde bewusst NICHT wiederverwendet - es hat kein
  `user_id`/Sichtbarkeitsmodell und ist für einen späteren, anderen Zweck vorgesehen (öffentliche
  RIS-Importe, KONZEPT.md Abschnitt 5.1).
- **Sicherheitskritische RLS-Entscheidung**: die Partei+Ebene-Sichtbarkeit für geteilte Dokumente
  portiert dasselbe Matching, das bereits für die Teilen-Kandidatensuche bei ToDos/Anträgen existiert
  (`current_user_partei()`/`current_user_ebenen()` aus `0020_profiles_ebenen.sql`, `gleicheGliederung()`
  in `src/lib/gliederung.ts`, bisher nur clientseitig) als neue SQL-Funktion
  `current_user_gliederung_matches(ebene, gliederung)`, jetzt server-seitig für RLS. `gliederung`
  eines geteilten Dokuments wird IMMER server-seitig aus dem Profil des Hochladenden übernommen (nie
  ein frei eingebbarer Client-/MCP-Parameter) - sonst könnte sich jemand versehentlich oder
  absichtlich in die falsche Gliederung eintragen und ein Dokument an die falschen Leute "leaken"
  oder für die richtigen unsichtbar machen. Live-verifiziert mit den vier echten Profilen der
  Produktions-DB (Logik-Substitutionstest, da `db query --linked` als Postgres-Superuser läuft und
  RLS damit umgeht, echtes `auth.uid()`-Impersonation also nicht direkt testbar ist): ein
  Test-Dokument "Kommune Iserlohn" war für den Ersteller und einen zweiten Nutzer mit identischer
  Gliederung korrekt sichtbar, für einen Nutzer mit Kommune-Mandat aber ohne hinterlegte Gliederung
  UND für einen Nutzer ganz ohne Kommune-Mandat korrekt NICHT sichtbar - danach wieder gelöscht.
- **Neuer privater Storage-Bucket `dokumente`** (getrennt vom bestehenden `zusammenfassungen`-Bucket
  für Anhänge an Sitzungen/Termine/ToDos/Anträge) mit einer SELECT-Policy, die zusätzlich zum
  eigenen Ordner auch Dateien erlaubt, deren zugehörige `dokumente`-Zeile `sichtbarkeit='geteilt'`
  ist und dieselbe Partei/Ebene/Gliederung-Bedingung erfüllt (dieselbe Bedingung wie oben, dupliziert
  auf `storage.objects` - eine RLS-Policy kann nicht auf die Policy einer anderen Tabelle verweisen).
- **MCP-Server**: `shared.ts` bekommt `uploadBase64File()` (Decode+Upload+Content-Type in einer
  Funktion, aus `createNote()` extrahiert, jetzt von `createNote()` UND `createDocument()` genutzt -
  weniger Duplikation). `finish_file_upload` bekommt einen neuen optionalen Parameter `ziel`
  (`"notiz"` Standard = Bucket `zusammenfassungen`, `"dokument"` = Bucket `dokumente`) - der
  bestehende Chunk-Upload-Mechanismus (`start_file_upload`/`append_file_chunk`/`finish_file_upload`,
  siehe vorheriger Changelog-Eintrag) wird für große Dateien in beiden Ziel-Buckets wiederverwendet
  statt einer zweiten Tool-Trias. Neu `tools/dokumente.ts`: `create_document` (Parameter `titel`,
  `sichtbarkeit`, bei `geteilt` Pflicht-`ebene` - muss eine eigene Ebene laut Profil sein, sonst
  Fehler -, `tags`, `inhalt`/`dateiname`+`datei_base64`/`datei_pfad`) und `list_documents` (Filter
  `sichtbarkeit`/`ebene`/`tag` - RLS erledigt die Sichtbarkeitsfilterung automatisch, kein manuelles
  Partei/Ebene-Matching im Tool-Code). 25 Tools insgesamt danach.
- **Frontend**: `src/lib/sourceColors.ts` bekommt `EBENE_COLOR` (feste Farbe pro Ebene, konsistent im
  gesamten Dokumenten-Hub) und `tagColor()` (deterministisches Hashing des Tag-Texts auf einen
  Palette-Eintrag, damit derselbe Tag immer dieselbe Farbe hat, ohne dass Nutzer Farben manuell
  pflegen müssten). Neue Seite `src/pages/Dokumente.tsx` (Route `/dokumente`, Link im
  Dashboard-Header neben "Archiv"): Tab-Umschalter Geteilt/Meine Dokumente (bestimmt gleichzeitig die
  `sichtbarkeit` beim Anlegen, kein separater Umschalter im Formular nötig), Ebene-Select im
  Upload-Formular nur mit den eigenen `profiles.ebenen`-Werten (Gliederung wird automatisch aus dem
  Profil übernommen, nicht frei editierbar - dieselbe Absicherung wie server-seitig), Ebene-/Tag-
  Filter-Chips (Muster aus `AntraegeSection.tsx`s Gremium-Filter übernommen), Tag-Eingabe mit
  Vorschlag-Chips + freiem Text. Dokument-Vorschau/-Download nutzt die bestehende
  `DocumentPreviewModal.tsx` unverändert weiter.
- Verifiziert per `deno check`, `tsc -b`/`vite build`, Live-DB-Push, Edge-Function-Deploy, der oben
  beschriebenen RLS-Logikprüfung sowie einem temporären, danach wieder gelöschten Test-Harness mit
  Mock-Daten (Desktop- und Mobile-Breite) für das Karten-/Filter-Layout - kein echter MCP-Testaufruf
  über den Live-Connector möglich, da neue Tools erst nach einem Reconnect im Client sichtbar werden
  (siehe vorheriger Changelog-Eintrag zu `upload_presseschau`).

### Dokumenten-Hub: Vorschau schlug fehl (falscher Storage-Bucket, Bugfix)

Nutzer-Feedback (Screenshot: "Datei konnte nicht geladen werden.") direkt nach dem ersten manuellen
Upload im neuen `/dokumente`-Reiter. Ursache: `DocumentPreviewModal.tsx` hatte den Bucket-Namen
`"zusammenfassungen"` fest einprogrammiert (Notiz-Anhänge an Sitzungen/Termine/ToDos/Anträge) - beim
Bau von `Dokumente.tsx` wurde die Komponente unverändert wiederverwendet, obwohl Dokumente aus dem
neuen Hub bewusst im eigenen, separaten Bucket `"dokumente"` liegen (siehe `0033_dokumente.sql`).
`createSignedUrl()` fand die Datei deshalb im falschen Bucket nicht.

- **Fix**: `DocumentPreviewModal` bekommt eine neue, optionale `bucket`-Prop (Standard weiterhin
  `"zusammenfassungen"`, damit alle fünf bestehenden Aufrufstellen unverändert bleiben);
  `Dokumente.tsx` übergibt jetzt `bucket="dokumente"`. `useEffect`-Dependency-Array um `bucket`
  ergänzt, `url`/`error` beim Pfad-/Bucket-Wechsel zurückgesetzt (vorher blieb ein alter Fehler-/
  URL-State theoretisch stehen, wenn dieselbe Modal-Instanz für ein anderes Dokument wiederverwendet
  worden wäre).
- Verifiziert per `tsc -b`/`vite build`; alle anderen Aufrufstellen (`AntraegeSection.tsx`,
  `AntragDetailModal.tsx`, `TodoDetailModal.tsx`, `TerminDetailPanel.tsx`, `Archiv.tsx`) geprüft -
  keine übergibt `bucket`, bleiben also unverändert beim Standard-Bucket.

## Dokumenten-Hub: Notizen/Analysen an ein Dokument hängen, mit Ebene- oder Einzelpersonen-Freigabe

Nutzerwunsch nach dem Hochladen der ersten 16 Sitzungsvorlagen: Einschätzungen/Analysen des
Politikbüros zu einzelnen Sitzungsvorlagen sollen nicht mehr als unabhängige "persönliche Dokumente"
in einer separaten Liste landen, sondern direkt an das jeweilige Original-Dokument gehängt werden -
mit einem Detail-Modal (Titel, Tags, Original-Dokument-Link, eigene Notizen/Analysen darunter).
Zusätzlich sollen diese angehängten Notizen/Dokumente nicht mehr nur binär privat/Ebene-weit,
sondern auch mit **einzelnen ausgewählten Personen** teilbar sein. Die bisherige "Meine
Dokumente"-Ansicht entfällt dadurch. Geplant via `EnterPlanMode`/`ExitPlanMode` (zweite
Architekturrunde für dieses Feature in Folge - RLS-relevant).

- **Migration `0034_dokumente_kommentare.sql`**: `dokumente` bekommt eine selbstreferenzierende,
  nullable Spalte `parent_id` (null = Top-Level-Dokument, gesetzt = angehängte Notiz/Analyse - kann
  wie bei `summaries` `inhalt` und/oder `datei_url` haben). `sichtbarkeit`-Check-Constraint um
  `'einzelpersonen'` erweitert. Neue Tabelle `dokument_shares` (dokument_id, user_id,
  `unique(dokument_id, user_id)`) 1:1 nach dem Muster von `antrag_shares`
  (`0023_antraege_sharing_status_fristen.sql`) samt Helper-Funktionen
  `dokument_gehoert_nutzer()`/`dokument_ist_geteilt_mit()`. Bei Kindern mit `sichtbarkeit='geteilt'`
  werden `ebene`/`gliederung` beim Anlegen 1:1 vom Elternteil übernommen (Frontend/MCP kopieren sie) -
  dadurch funktioniert die bestehende `dokumente_select_shared`-Policy für Kinder unverändert, keine
  RLS-Änderung nötig für den "ganze Ebene"-Fall. Storage-Select-Policy für den `dokumente`-Bucket um
  denselben `dokument_shares`-Weg ergänzt (sonst ließe sich die angehängte Datei zwar in der DB sehen,
  aber keine signierte URL dafür erzeugen).
- **Bug beim Bauen entdeckt und mitgefixt**: `list_documents` (MCP) verließ sich fälschlich auf RLS
  ("RLS filtert das schon") - der MCP-Server läuft aber komplett über den
  `SUPABASE_SERVICE_ROLE_KEY` (siehe `index.ts`-Kommentar), der jede RLS-Policy umgeht. Praktisch
  hätte das bedeutet, dass `list_documents` OHNE Sichtbarkeitsprüfung ALLE `dokumente`-Zeilen aller
  Nutzer zurückgegeben hätte, inklusive fremder "persönlicher" Notizen - ein Anzeigefehler wäre das
  nicht gewesen, sondern ein echtes Datenleck, bislang aber folgenlos, weil aktuell nur eine Partei im
  System aktiv ist und noch keine "persönlichen" Top-Level-Dokumente existierten. Fix: `darfSehen()`
  in `tools/dokumente.ts` baut die RLS-Logik (Partei/Ebene/Gliederung-Match bzw. `dokument_shares`)
  jetzt explizit im Tool-Code nach, exakt wie es `list_antraege`/`list_todos` bereits für ihre
  Freigaben tun (eigene Zeilen + manuell aufgelöste Shares, nie ein RLS-Trugschluss).
- **`tools/dokumente.ts`**: `create_document` bekommt `parent_id` (Notiz/Analyse an ein bestehendes
  Dokument hängen - Sichtbarkeitsprüfung des Elternteils läuft über dieselbe `darfSehen()`-Funktion,
  sonst könnte über eine erratene/bekannte fremde `parent_id` an ein nicht sichtbares Dokument
  angehängt werden) und `teilen_mit_namen` (Namensauflösung gegen sichtbare Profile, nicht
  auflösbare Namen brechen den Aufruf nicht ab, sondern werden im Antworttext genannt).
  `list_documents` bekommt `parent_id` (ohne Angabe nur Top-Level-Dokumente, analog zur Web-UI).
- **Frontend**: `Dokumente.tsx` verliert den Tab-Umschalter (Geteilt/Meine Dokumente) - zeigt nur noch
  Top-Level-Dokumente, das "+ Dokument"-Formular legt immer `sichtbarkeit='geteilt'` an. Klick auf ein
  Dokument öffnet die neue Komponente `DokumentDetailModal.tsx` (Original-Dokument-Kopf + Liste
  eigener/sichtbarer fremder Notizen mit Sichtbarkeits-Badge + Anhänge-Formular mit
  Persönlich/Ganze-Ebene/Einzelne-Personen-Auswahl - Kolleg\*innen-Suche 1:1 nach dem Muster aus
  `AntragDetailModal.tsx` (`loadCandidates()`/Dropdown), nur ohne Ebene-Einschränkung auf ein
  bestimmtes `antrag.ebene`, da Kinder keine eigene Ebene tragen).
- Verifiziert per `deno check`, `tsc -b`/`vite build`, `supabase db push`, Edge-Function-Deploy, sowie
  einer Logik-Substitutionsprüfung gegen die vier echten Profile der Produktions-DB: eine Test-Notiz
  mit "ganze Ebene" war für den Ersteller und den Kollegen mit identischer Gliederung sichtbar, für
  die anderen zwei nicht; eine zweite Test-Notiz mit "einzelpersonen" (freigegeben für genau einen
  Kollegen) war NUR für diesen einen sichtbar, nicht für den anderen Ebene-Kollegen mit
  übereinstimmender Gliederung - beide Testzeilen (inkl. `dokument_shares`-Zeile) danach wieder
  gelöscht, Cascade-Delete bestätigt. Zusätzlich ein temporärer, danach gelöschter Test-Harness mit
  Mock-Daten für das neue Modal-Layout (Desktop-Breite, Sichtbarkeits-Badges/Formular).

## Dokumenten-Hub: manuelles Gelesen/Ungelesen, Tags editieren, Notizen nachträglich teilen (+ MCP)

Nutzerwunsch: die bislang rein automatische Gelesen/Ungelesen-Markierung (Migration
`0035_dokument_gelesen.sql`, setzt `gelesen_am` beim Öffnen) sollte auch manuell umschaltbar sein,
Tags sollten nachträglich editierbar werden (bislang nur beim Anlegen setzbar) und Notizen sollten
nachträglich noch geteilt werden können - Tags und Teilen zusätzlich über den MCP-Server. Geplant via
`EnterPlanMode`/`ExitPlanMode`. Erste Rückfrage ergab ein Missverständnis: gemeint war explizit auch
die an ein Top-Level-Dokument angehängten Notizen im `/dokumente`-Dokumenten-Hub, nicht das ältere
`summaries`-System.

**Keine neue Migration nötig** - alle drei Fähigkeiten waren durch bereits bestehende RLS-Policies
gedeckt: `dokumente_update_own` erlaubt dem Owner das Ändern jeder Spalte (inkl. `tags`/`sichtbarkeit`),
`dokument_shares_insert_by_owner`/`_delete` verwalten Freigaben, und `dokument_gelesen_manage_own`
erlaubt JEDER/M Betrachter*in volle CRUD auf die eigene Gelesen-Zeile, unabhängig von der
Dokument-Eigentümerschaft (richtig so, weil "gelesen" ein reines Betrachter-Konzept ist).

- **`src/lib/dokumenteGelesen.ts`**: neue Funktionen `markiereGelesen()`/`markiereUngelesen()` (upsert
  bzw. delete auf `dokument_gelesen`, Letzteres reproduziert exakt den "nie geöffnet"-Zustand, den
  `istDokumentUngelesen()` schon kennt).
- **Neue geteilte Komponenten** `src/components/TagEditor.tsx` und `src/components/SichtbarkeitEditor.tsx`,
  extrahiert aus den bislang doppelt vorhandenen Create-Formular-Blöcken in `Dokumente.tsx` und
  `DokumentDetailModal.tsx` (nach Projekt-Konvention wird ab dem 3. Vorkommen extrahiert - hier direkt
  4 Stellen: 2 bestehende Create-Formulare + 2 neue Edit-Stellen). Beide Create-Formulare wurden im
  Zuge dessen auf die neuen Komponenten umgestellt (reines Refactoring).
- **`DokumentDetailModal.tsx`**: neuer Header-Button (`Mail`/`MailOpen` aus `lucide-react`) neben
  Löschen/Schließen zum manuellen Umschalten, lokaler `istGelesen`-State (initial `true`, da das
  Öffnen ohnehin schon automatisch markiert). Top-Level-Dokument-Tags sind für den Owner jetzt über
  `TagEditor` editierbar (sofortiges Speichern bei `onChange`), ebenso die Tags jeder eigenen Notiz.
  Die bisher statische Sichtbarkeits-Badge einer eigenen Notiz ist jetzt klickbar und öffnet
  `SichtbarkeitEditor` vorbefüllt mit dem aktuellen Stand (`shareIdsByChild: Map<string, string[]>`
  zusätzlich zu `shareNamesByChild` geladen, damit die rohen `user_id`s statt nur aufgelöster Namen
  zur Verfügung stehen) - Speichern berechnet `ebene`/`gliederung` wie beim Anlegen neu (bei "geteilt"
  vom Elternteil übernommen) und ersetzt die bestehenden `dokument_shares`-Zeilen der Notiz komplett
  (löschen + bei "einzelpersonen" neu einfügen, einfacher als Diffing bei der kleinen Zeilenzahl pro
  Notiz). Fremde/nicht-eigene Notizen bleiben unverändert read-only.
- **`Dokumente.tsx`**: gleicher Gelesen/Ungelesen-Toggle zusätzlich direkt auf jeder Listenkarte
  (kleiner Icon-Button mit `stopPropagation`, analog zum bestehenden Löschen-Button), damit man nicht
  erst öffnen muss. `onClose` des Detail-Modals lädt jetzt zusätzlich `loadDocuments()` neu (vorher nur
  `loadLeseStatus()`), damit Top-Level-Tag-Änderungen aus dem Modal nach dem Schließen auch in der
  Liste sichtbar sind.
- **MCP-Server** (`tools/dokumente.ts`, gleiches Registrierungs-Dreieck wie `create_document`/
  `list_documents`): neue Tools `update_document_tags` (ersetzt die Tag-Liste eines eigenen
  Dokuments/einer eigenen Notiz komplett, leeres Array erlaubt) und `update_document_sharing`
  (ändert `sichtbarkeit` + `dokument_shares` eines eigenen Dokuments/einer eigenen Notiz - bei
  "geteilt" für eine per `parent_id` angehängte Notiz wird `ebene`/`gliederung` vom Elternteil
  übernommen, für ein Top-Level-Dokument bleiben sie unverändert; Namensauflösung für
  `teilen_mit_namen` in eine gemeinsame Funktion `resolveTeilenMitNamen()` extrahiert, die jetzt auch
  `create_document` nutzt statt der bisherigen duplizierten Inline-Logik). Beide Tools prüfen die
  Eigentümerschaft (`dokumente.user_id === caller`) explizit im Tool-Code, da der MCP-Server über den
  Service-Role-Client läuft und RLS dort nicht greift. Gelesen/Ungelesen bewusst NICHT für MCP gebaut
  (Nutzerwunsch nannte explizit nur Tags und Teilen).
- Verifiziert per `tsc -b`/`vite build` und `deno check --config supabase/functions/mcp-server/deno.json
  supabase/functions/mcp-server/index.ts` (beide fehlerfrei), sowie einem statischen Test-Harness mit
  der tatsächlich kompilierten CSS (Header-Toggle, Top-Level-TagEditor, klickbare Sichtbarkeits-Badge
  mit geöffnetem SichtbarkeitEditor, Tag-Editor je eigener Notiz, read-only Darstellung einer fremden
  Notiz) - danach gelöscht. Die beiden neuen MCP-Tools sind nur mit einem persönlichen Bearer-Token
  (Settings → MCP Connection) end-to-end testbar; das ist ein Geheimnis, das nicht ins Chat-Fenster
  gehört, deshalb primär über `deno check` + Code-Review-Konsistenz mit `createDocument`/`darfSehen()`
  verifiziert.

## MCP-Server: Dokumententitel im Dokumenten-Hub änderbar (`update_document_titel`)

Nutzerwunsch: Titel von Dokumenten im Dokumenten-Hub per MCP ändern können - ausdrücklich NICHT den
Dateinamen eines angehängten Uploads, sondern das `titel`-Feld der `dokumente`-Zeile selbst. Neues
Tool `update_document_titel(dokument_id, titel)`, exakt nach dem Muster von `updateDocumentTags`
(gleiche Ownership-Prüfung: nur `dok.user_id === userId` darf ändern, RLS `dokumente_update_own`
erlaubt ohnehin nur das - der Service-Role-Client umgeht RLS, die Prüfung läuft deshalb explizit im
Tool-Code). Die Web-UI (`DokumentDetailModal.tsx`) zeigt den Top-Level-Titel bisher nur statisch an
(keine Inline-Bearbeitung) - dieses Tool ist also aktuell nur über MCP nutzbar, keine Dopplung
bestehender Funktionalität.

Verifiziert per `deno check`, Deploy, und einer temporären Test-Fixtur direkt in der Live-DB
(Test-Dokument angelegt, Ownership-Check + Update-Semantik nachgerechnet, danach gelöscht) - kein
Bearer-Token zur Hand für einen echten End-to-End-Aufruf (siehe vorheriger Abschnitt zur selben
Einschränkung).

## Dokumenten-Hub: Redesign mit mehr "Wow-Effekt", neues Gelesen/Ungelesen-Symbol, Suchfunktion

Nutzerfeedback: Darstellung von Liste und Detail-Modal wirkte im Vergleich zum Rest der App (bereits
komplett redesignt, siehe UI-Review-Historie weiter oben) "nicht sonderlich gelungen"; zusätzlich
passte das `Mail`/`MailOpen`-Briefsymbol für Gelesen/Ungelesen nicht (Umschlag = falsche Metapher
außerhalb von E-Mail-Kontexten), und eine Suchfunktion fehlte (nur Ebene-/Tag-Chip-Filter). Geplant
via `EnterPlanMode`/`ExitPlanMode`, unter Einsatz des `impeccable`-Skills (Product-Register: die
App ist ein Arbeitswerkzeug, kein Marketing-Surface - Wow-Effekt musste sich als Konsistenz/Polish
äußern, nicht als Farbrausch/Gradient/Hero-Elemente).

Hauptursache identifiziert: `DokumentDetailModal.tsx` war das **einzige** Detail-Modal der App, das
noch nicht auf die gemeinsame `DetailModalShell` (2-Spalten, `max-w-5xl`, unabhängig scrollende
Spalten - bereits von `AntragDetailModal`/`TodoDetailModal`/`TerminDetailModal` genutzt) migriert war
- noch schmal (`max-w-2xl`), einspaltig, eigenes Chrome.

- **Gelesen/Ungelesen-Symbol**: `Mail`/`MailOpen` komplett durch einen farbigen Punkt ersetzt
  (Gmail/Linear/Slack-Konvention, `bg-primary` - funktioniert unter jedem Partei-Theme). In
  `Dokumente.tsx` wandert der Toggle an den linken Rand der Karte (vor das Datei-Icon): ungelesen =
  immer sichtbarer voller Punkt, gelesen = unsichtbar, bei Karten-Hover als Ring eingeblendet
  (`group-hover`), damit "als ungelesen markieren" erreichbar bleibt ohne die Zeile zu belasten. Im
  `DokumentDetailModal.tsx`-Header als Punkt+Text-Chip (`mc-btn-ghost`).
- **`Dokumente.tsx` Redesign**: Zähler-Badge für ungelesene Dokumente neben dem `<h1>` (identisches
  Pill-Vokabular wie der bereits bestehende Ungelesen-Zähler auf dem Dashboard-Nav-Link, siehe
  `Dashboard.tsx`). Neues Suchfeld oberhalb der Filter-Chips (`searchQuery`-State, UND-verknüpft mit
  Ebene-/Tag-Filter, durchsucht Titel/Inhalt/Tags/Autor der Top-Level-Dokumente client-seitig - Kinder-
  Notizen bewusst nicht durchsucht, keine Doppelbedeutung mit dem bestehenden Ebene-/Tag-Filter-Muster
  nötig). Datei-Typ-Icons (`docIcon()`) statt immer demselben `FileText`: `StickyNote` ohne Anhang,
  `FileImage` bei Bild-Endung, `FileText` bei PDF, sonst `File` - Farbe bleibt einheitlich
  `text-slate-400`, nur das Glyph variiert. Listen-Karten bekommen einen gestaffelten Eintritt
  (`mc-animate-slide` + gedeckelte `animationDelay`, max. 240ms über 8 Einträge) sowie Hover-/Press-
  Mikrointeraktion (`hover:-translate-y-0.5`/`active:scale-[0.99]`, analog zum bestehenden
  `.mc-btn:active`-Idiom).
- **`DokumentDetailModal.tsx` Migration auf `DetailModalShell`**: 1:1 nach dem Muster von
  `AntragDetailModal.tsx` - `headerActions` (Gelesen-Chip + für den Owner ein inline Confirm-Delete-
  Block mit "Sicher?"/Abbrechen/Löschen statt des bisherigen `window.confirm(...)`), `left` (bisherige
  Dokument-Karte, jetzt `rounded-xl border bg-slate-50`-Wrapper statt `mc-card`), `right` (Notizen-
  Liste + Anhänge-Formular unverändert). Reines JSX-Umhängen, keine Logik-Änderungen an
  `loadChildren`/`handleAddChild`/Tag-/Sharing-Editoren. Modal wächst von `max-w-2xl` einspaltig auf
  die gemeinsame `max-w-5xl` 2-Spalten-Shell - damit ist dieses das letzte Detail-Modal, das der
  gemeinsamen Hülle beitritt.
- `src/components/DocumentPreviewModal.tsx`: `fileExtension()`/`IMAGE_EXTENSIONS` exportiert (waren
  bisher nur intern genutzt), damit `Dokumente.tsx` dieselbe Extension-Logik für die neuen Datei-Typ-
  Icons wiederverwendet statt sie zu duplizieren.
- Verifiziert per `tsc -b`/`vite build` sowie einem statischen Test-Harness mit der tatsächlich
  kompilierten CSS (Listenkarten mit gemischt gelesen/ungelesen und verschiedenen Dateitypen unter dem
  SPD-Theme, plus separate Ansicht des 2-spaltigen `DetailModalShell`-Layouts) - danach gelöscht.

## MCP-Server: Dokumente und ToDos nachträglich mit Sitzungen verknüpfbar

Nutzerwunsch: „Dokumente und ToDos auch im Nachhinein über den MCP Server noch mit Sitzungen
verknüpfen können" - `update_todo` konnte das als Beispiel genannt nicht, obwohl `todos.session_id`
schon seit 0001_init.sql existiert (nur `create_todo` konnte sie beim Anlegen setzen). Auftrag
ausdrücklich „in allen sinnvollen Aufrufen" erweitert, nicht nur den zwei genannten Stellen:

- **`dokumente` hatte noch gar keine `session_id`-Spalte** (anders als `todos`/`antraege`) - neue
  Migration `0036_dokumente_session.sql`. Keine neue RLS-Policy nötig, die bestehenden
  `dokumente_select_*`-Policies sind spaltenunabhängig.
- **Neues Tool `update_document_session(dokument_id, session_id)`** - leerer String entfernt eine
  bestehende Verknüpfung, exakt nach dem Ownership-Prüfungs-Muster von `update_document_titel`/
  `update_document_tags`. `create_document` bekommt `session_id` als weiteren optionalen Parameter.
- **`update_todo`**: neuer optionaler Parameter `session_id` (leerer String = entfernen), validiert
  vorher per Select, dass die Sitzung existiert (verständliche Fehlermeldung statt rohem
  FK-Constraint-Fehler, gleiches Muster wie überall sonst im MCP-Server).
- **`update_antrag_status`**: dieselbe `session_id`-Erweiterung, obwohl `create_antrag` schon
  `session_id` unterstützt (dort nur beim Anlegen, nicht nachträglich änderbar) - gleiche Lücke wie bei
  ToDos, deshalb mit aufgenommen statt nur die zwei explizit genannten Stellen zu fixen.
- **Symmetrische Lese-Ergänzungen**, damit eine Verknüpfung nach dem Setzen auch sichtbar/filterbar
  ist (sonst wäre das Schreiben ohne Nutzen): `list_todos`, `list_antraege` und `list_documents`
  bekommen je einen optionalen `session_id`-Filter und zeigen bei verknüpften Einträgen jetzt
  `Sitzung: <Titel>` in der Ausgabezeile (Sitzungstitel werden dafür in einer Sammelabfrage
  nachgeladen, gleiches Muster wie in `list_notes`). `events`/`create_event_note` bleiben bewusst
  außen vor - Termine haben kein `session_id`-Feld im Datenmodell, das Konzept passt dort nicht
  (ein Termin ist ein rein persönlicher Kalendereintrag, keine Sitzungs-Zuordnung vorgesehen).
- Verifiziert per `deno check`, `supabase db push` (Migration live), Deploy, und temporären
  Test-Fixturen direkt in der Live-DB für alle drei Entitäten (ToDo/Dokument/Antrag angelegt, Link
  gesetzt, Filter-Query nachgerechnet, danach alle drei wieder gelöscht - Bestand vorher/nachher
  gleich null verifiziert).

## Alles miteinander verknüpfen: ToDos, Dokumente und Sitzungstermine (Web-UI + MCP)

Nutzerwunsch: „Ich möchte alles miteinander verknüpfen können. Sowohl im Mandatscockpit selber, als
auch über den MCP Server. Also Todos, Dokumente und Sitzungstermine. Sitzungstermine haben bereits
einen Abschnitt 'Verknüpfte Aufgaben' und 'Verknüpfte Anträge'. [...] Diesen Abschnitt brauchen wir
entsprechend bei den ToDos (Verknüpfte Sitzungen, Verknüpfte Dokumente) und den Dokumenten (Verknüpfte
ToDos, Verknüpfte Sitzungen)." Der vorherige Punkt hatte die Datenebene für Sitzung↔ToDo und
Sitzung↔Dokument bereits per MCP-Tool nachrüstbar gemacht (`0036_dokumente_session.sql`,
`update_document_session`, `update_todo(session_id)`) - diesem Punkt fehlte noch (a) eine echte
ToDo↔Dokument-Verknüpfung (bislang gar nicht modelliert) und (b) die Sichtbarkeit/Bedienbarkeit all
dieser Verknüpfungen direkt in der Web-UI statt nur über MCP-Tool-Aufrufe.

- **Neue n:m-Verknüpfung ToDo↔Dokument** (`0037_todo_dokumente.sql`, Jointabelle `todo_dokumente`
  mit `todo_id`, `dokument_id`, unique-Constraint auf dem Paar). Bewusst eine eigene Tabelle statt
  Wiederverwendung der bestehenden `todos.dokument_id`-Spalte bzw. der `documents`-Tabelle: beide sind
  laut Roadmap in CLAUDE.md für das künftige RIS-Dokumenten-Import-Feature (Phase 2) reserviert und
  komplett unabhängig vom neuen Dokumenten-Hub (Tabelle `dokumente`, seit 0033). Anders als die
  1:n-`session_id`-Spalten auf `todos`/`dokumente` (eine Karte/ein Dokument hat höchstens eine
  Sitzung) kann hier eine Karte mehrere Dokumente und ein Dokument mehrere Karten betreffen, daher
  eine echte Jointabelle statt einer FK-Spalte. RLS: sichtbar/anlegbar/löschbar, wenn der Nutzer
  entweder Zugriff auf die ToDo-Karte hat (Eigentümer oder per `todo_placements` geteilt) oder
  Eigentümer des Dokuments ist - keine der beiden Seiten muss beide Bedingungen erfüllen, ein Teilen
  in eine Richtung reicht (z. B. ein per Ebene geteiltes Dokument mit der eigenen privaten Karte
  verknüpfen).
- **Neue MCP-Tools `link_todo_document`/`unlink_todo_document`** (`tools/todo_dokumente.ts`, neues
  Modul) - beide prüfen dieselbe Zugriffs-Bedingung wie die RLS-Policy explizit im Tool-Code (der
  MCP-Server läuft über den Service-Role-Client, RLS greift dort nicht). `link_todo_document` upsertet
  mit `onConflict: 'todo_id,dokument_id', ignoreDuplicates: true` statt vorher separat auf Duplikate zu
  prüfen.
- **Symmetrische Lese-Ergänzungen**: `list_todos` und `list_documents` laden die jeweils verknüpften
  Gegenstücke per Sammelabfrage nach (gleiches Muster wie der `Sitzung: <Titel>`-Zusatz aus dem
  vorherigen Punkt) und zeigen sie als `Dokumente: X, Y` bzw. `ToDos: X, Y` in der Ausgabezeile.
- **Web-UI, `TodoDetailModal.tsx`**: neuer Abschnitt „Verknüpfte Sitzungen" (Anzeige der bereits
  bestehenden `linkedSession`, read-only - das Setzen der Sitzung läuft weiterhin über das
  Bearbeiten-Formular der Karte) und „Verknüpfte Dokumente" (Liste mit „Lösen"-Button je Eintrag plus
  Such-Dropdown zum Verknüpfen neuer Dokumente, exakt das gleiche Interaktionsmuster wie der
  bestehende „Kolleg*in suchen"-Sharing-Dropdown: `onFocus`/`onBlur`-Timeout-Pattern, `onMouseDown`
  statt `onClick` in der Trefferliste, damit der Klick vor dem `onBlur`-Schließen ankommt).
- **Web-UI, `DokumentDetailModal.tsx`**: neuer Abschnitt „Verknüpfte Sitzung" (für den/die
  Ersteller*in editierbar als `<select>` aus den eigenen Sitzungen, sonst nur Lesevisualisierung) und
  „Verknüpfte ToDos" (gleiches Lösen+Suchen-Muster wie oben, gespiegelt). Beim Implementieren des
  Sitzungs-`<select>`-Handlers zunächst versehentlich direkt `document.session_id = ...` mutiert -
  verstößt gegen den dokumentierten Grundsatz der Komponente, dass die `document`-Prop unveränderlich
  ist (sicher nur, weil `Dokumente.tsx` beim Wechsel des Dokuments die Komponente immer erst
  unmountet). Selbst bemerkt und korrigiert: neuer lokaler State-Spiegel `docSessionId` nach dem
  bereits bestehenden `docTags`-Muster in derselben Datei, plus ein dedizierter
  `useEffect([docSessionId])`, der die verknüpfte Sitzung neu lädt (nötig, weil ein State-Setter
  nicht synchron in derselben Funktion sichtbar wird).
- **Web-UI, `TerminDetailPanel.tsx` (Sitzungsansicht)**: zusätzlich zu den beiden explizit gewünschten
  Stellen ergänzt um einen dritten, nicht explizit verlangten, aber im Sinne von „alles miteinander
  verknüpfen" naheliegenden Abschnitt „Verknüpfte Dokumente" (nur bei `kind === 'session'`, da
  `dokumente.session_id` nur für Sitzungen existiert, nicht für private Termine) - liest
  `dokumente` gefiltert nach `session_id`, Klick öffnet das bestehende `DokumentDetailModal` direkt
  aus der Sitzungsansicht heraus (analog zum bestehenden Öffnen von ToDo-/Antrags-Detail-Modalen aus
  demselben Panel).
- `src/lib/types.ts`: neue `TodoDokument`-Interface für die Jointabelle; `session_id` auf
  `DokumentRow` war bereits vorhanden.
- Verifiziert per `deno check`, `supabase functions deploy`, temporären Test-Fixturen in der Live-DB
  (ToDo + Dokument angelegt, in beide Richtungen verknüpft/gequeried, wieder gelöst, beide gelöscht,
  Bestand danach wieder null) sowie `npm run build` (vollständiger `tsc -b` + `vite build` über alle
  drei geänderten Komponenten).

**Nachbesserung (Bug-Root-Cause):** Nutzer meldete, dass ein per MCP-Tool gesetzter Sitzungslink
(`Sammeldokument Seniorenbeirat` → Sitzung „Seniorenbeirat" vom 02.09.2026) laut Datenbank korrekt
gesetzt war, im neuen „Verknüpfte Sitzung"-`<select>` in `DokumentDetailModal.tsx` aber „Keine
Sitzung" anzeigte. Root Cause: die Dropdown-Optionsliste (`ownSessions`) ist auf die unter Einstellungen
→ Meine Gremien ausgewählten Gremien des Nutzers gefiltert - „Seniorenbeirat" war dort nicht
angehakt. Der `<select>`-Wert (`docSessionId`) war korrekt gesetzt, aber da kein `<option>` diesem
Wert entsprach, fiel der Browser stillschweigend auf die erste Option („Keine Sitzung") zurück - ein
reiner Anzeigefehler, kein Datenverlust (der zugrunde liegende State/DB-Wert blieb beim Speichern
unangetastet, aber die Anzeige war irreführend). Fix: die aktuell verknüpfte Sitzung wird jetzt immer
als zusätzliche `<option>` eingefügt, falls sie nicht schon in `ownSessions` enthalten ist - sowohl in
`DokumentDetailModal.tsx` als auch (gleiche Ursache, gleiches Muster) im bestehenden
Sitzungs-`<select>` des ToDo-Bearbeiten-Formulars in `TodoDetailModal.tsx`.

---

## Dokumenten-Archiv, Paginierung, Gremien-Schnellfilter und „Zahlen und Fakten" (2026-09-08)

Vier Nutzerwünsche in einem Zug. Vor der Umsetzung wurden drei Punkte rückgefragt, weil sie den
Zuschnitt materiell verändert hätten; die Antworten stehen jeweils bei der Entscheidung.

### 1. Archiv für den Dokumenten-Hub (`0038_dokumente_archiv.sql`)

Nutzerwunsch: „Dokumente die in vergangenen Sitzungen auf der Agenda standen sollen ins Archiv
verschoben werden. Das Archiv soll bei der Suche mit einbezogen werden."

**Entschieden (Rückfrage): automatisch UND manuell.** Ein Dokument gilt als archiviert, wenn
entweder die per `dokumente.session_id` verknüpfte Sitzung vorbei ist (`sessions.datum <` Beginn des
heutigen Tages) **oder** `archiviert_am` gesetzt wurde. Die zweite Variante war der ausdrückliche
Wunsch, damit sich auch Dokumente ohne Sitzungsverknüpfung wegräumen (und zurückholen) lassen.

Die automatische Regel wird **nicht** in die Spalte materialisiert – kein Trigger, kein Cron-Job.
Sie ist eine reine Funktion aus `sessions.datum` und müsste sonst täglich nachgezogen werden; sie
wird stattdessen beim Anzeigen abgeleitet (`archivGrund()` in `src/lib/dokumenteArchiv.ts`).
`archiviert_am` speichert also ausschließlich die manuelle Entscheidung. Keine neue RLS-Policy
nötig: die bestehenden `dokumente_select_*`-Policies sind spaltenunabhängig, `archiviert_am`
ändert nur, in welcher Liste ein Dokument auftaucht, nicht wer es sehen darf.

**Datumsvergleich numerisch, nicht lexikografisch:** PostgREST liefert `timestamptz` als
`...+00:00`, `startOfTodayIso()` erzeugt `...Z`. Als Strings wären zwei Schreibweisen desselben
Zeitpunkts nicht gleich (und ein Dokument mit einer Sitzung exakt um Mitternacht wäre fälschlich
archiviert). Deshalb `Date.parse(a) < Date.parse(b)` – geprüft mit beiden Formaten.

Nicht gefundene/nicht sichtbare Sitzungen archivieren bewusst **nicht**: lieber ein Dokument zu viel
in der Arbeitsliste als eines, das unauffindbar wird.

- `src/pages/Dokumente.tsx` blendet Archiviertes standardmäßig aus, zeigt einen Chip
  „Archiv (n)" zum Einblenden und ein graues Archiv-Fähnchen an den betroffenen Karten.
- **Suche bezieht das Archiv automatisch ein** (der zweite Halbsatz des Nutzerwunsches): sobald ein
  Suchbegriff eingegeben ist, gilt `zeigeArchiv` unabhängig vom Chip, der Chip wird deaktiviert und
  ein Hinweis „Die Suche schließt das Archiv mit ein." eingeblendet. Begründung: wer sucht, sucht im
  Gesamtbestand, nicht im aktuellen Arbeitsvorrat.
- `src/components/DokumentDetailModal.tsx`: Knopf „Archivieren"/„Im Archiv" im Header (nur für
  Eigentümer\*innen), plus eine Zeile unter „Verknüpfte Sitzung", die den Archiv-Grund benennt.
  Lokaler State-Spiegel `archiviertAm` nach dem bereits etablierten `docTags`/`docSessionId`-Muster.
- **Wo im Archiv (Rückfrage):** in den **bestehenden** „Dokumente"-Reiter von `Archiv.tsx`, nicht in
  einen neuen fünften Tab. Der Reiter führt jetzt zwei Quellen in einer nach Datum sortierten Liste
  zusammen – angehängte Datei-Uploads (`summaries`) und archivierte Hub-Dokumente – mit
  unterschiedlichem Klickverhalten je Art (Vorschau vs. `DokumentDetailModal`, wo Notizen, Tags und
  ToDo-Verknüpfungen dranhängen). Hub-Einträge tragen ein Fähnchen mit dem Sitzungstitel bzw.
  „Von Hand archiviert". Die Archiv-Regel ist nicht server-seitig filterbar, weil sie an
  `sessions.datum` hängt und nicht an einer Spalte von `dokumente` – daher werden alle Top-Level-
  Dokumente geladen und beim Rendern gefiltert.

### 2. Paginierung der Dokumentenliste

Nutzerwunsch: „Ich möchte auswählen können wieviele Dokumente ich pro Seite sehen kann."
Auswahl 10/25/50/100/Alle (Standard 25), Vor/Zurück und eine Bereichsanzeige („1–25 von 32").

Die Seitenzahl wird beim Rendern **geklemmt** (`Math.min(seite, seitenAnzahl)`) statt per Effekt
zurückgesetzt: schrumpft die Treffermenge durch einen Filter, landet man sofort auf der letzten
gültigen Seite, ohne einen Zwischen-Render mit leerer Liste. Jede Filteränderung springt zusätzlich
über `mitSeitenreset()` auf Seite 1.

Die gewählte Seitengröße liegt in `localStorage` – die **einzige** Stelle im Projekt, die das nutzt.
Begründung: eine reine Anzeige-Vorliebe pro Gerät, für die sich weder Tabelle noch RLS-Policy lohnen
(anders als `todo_board_settings`, das die Board-Struktur geräteübergreifend halten muss). Lesen und
Schreiben sind gekapselt und in `try/catch`, damit ein gesperrter Storage (privates Fenster,
blockierte Site-Daten) die Seite nicht beim Rendern abstürzen lässt.

**Bug beim Testen gefunden und behoben:** `Number(localStorage.getItem(key))` ist `0`, wenn nichts
gespeichert ist – und `0` ist ein gültiger Wert („Alle"). Ohne gespeicherte Vorliebe startete die
Seite daher ohne jede Aufteilung. Fix: explizite `null`-Prüfung vor dem `Number()`.

### 3. Schnellfilter „Meine Gremien"

Filtert auf Dokumente, deren verknüpfte Sitzung zu einem Gremium aus `user_gremien`
(`0005_user_gremien.sql`) gehört. Dokumente **ohne** Sitzungsverknüpfung fallen unter diesem Filter
bewusst heraus – ohne Sitzung lässt sich kein Gremium bestimmen. Der Chip erscheint nur, wenn
überhaupt Gremien gepflegt sind, und nennt sie im `title`-Tooltip.

### 4. Neuer Menüpunkt „Zahlen & Fakten" (`0039_fakten.sql`, `src/pages/ZahlenUndFakten.tsx`)

Nutzerwunsch: „Als weiteren Menüpunkt in der Kopfleiste möchte ich neben Archiv und Dokumente noch
Zahlen und Fakten. Dort sollen in geeigneter Form Argumentationshilfen, Sprachvorgaben und Zahlen
und Fakten ersichtlich sein." Route `/fakten`, Link in der Dashboard-Kopfleiste vor „Einstellungen".

**Entschieden (Rückfrage): eigene Tabelle `fakten`**, nicht eine Tag-Sicht auf `dokumente`. Fakten
sind kurze, wiederverwendbare Textbausteine mit Belegpflicht (`quelle` + `stand`) und – bei
`kategorie = 'zahl'` – einer herausgehobenen Kennzahl. Ein Dokument dagegen ist ein einzelnes,
datiertes Artefakt mit Datei-Anhang, Notizen-Baum und Gelesen-Status. Beides in einer Tabelle würde
entweder den Dokumenten-Hub mit Kennzahl-Spalten aufblähen oder die Fakten in einer nach Datum
sortierten Dokumentenliste untergehen lassen.

- Drei Kategorien als Reiter: `argumentationshilfe` (Argument + Erwiderung), `sprachregelung` (wie
  wir worüber sprechen – und wie nicht), `zahl` (belegte Kennzahl).
- `kennzahl` ist bewusst `text`, nicht `numeric`: Kennzahlen aus Veröffentlichungen kommen mit
  Tausenderpunkten, Näherungen („rund 1.200") und Spannen („8–12"), die eine Zahlenspalte entweder
  verfälschen oder ganz ablehnen würde. `einheit` steht daneben („%", „Mio. €", „Wohnungen").
- Zwei Darstellungen: die Textkategorien als Liste mit Fließtext, `zahl` als Kachelraster mit dem
  Wert in `text-3xl` – der Wert ist dort die Botschaft und soll ohne Lesen erfassbar sein.
- Fehlt der Beleg, steht statt der Quellenzeile ein sichtbares „Keine Quelle hinterlegt" in Amber –
  ein Fakt ohne Quelle ist in der Debatte wertlos, das soll auffallen statt still zu fehlen.
- Sichtbarkeit nur `persoenlich`/`geteilt`, **kein** `einzelpersonen` wie bei Hub-Notizen: ein Fakt
  ist Fraktionsmaterial, keine private Analyse zu einem einzelnen Vorgang. RLS spiegelt exakt die
  vier `dokumente`-Policies inkl. der SECURITY-DEFINER-Helper `current_user_partei()`,
  `current_user_ebenen()` (0020) und `current_user_gliederung_matches()` (0033). `gliederung` wird
  wie dort **immer** aus dem eigenen Profil übernommen, nie als Eingabe entgegengenommen.
- Ein Formularzustand für Anlegen **und** Bearbeiten (`editId === null` heißt „neu"), gleiches
  Muster wie das Bearbeiten von Notizen im `DokumentDetailModal`. `TagEditor` wiederverwendet;
  `SichtbarkeitEditor` bewusst **nicht** – der hat drei fest verdrahtete Optionen inklusive
  Personensuche, hier reichen zwei Radios, und ein Umbau der geteilten Komponente für genau einen
  Aufrufer wäre nach der Projekt-Faustregel („beim 3. Vorkommen extrahieren") verfrüht.

### Verifikation

Login-Rundgänge sind im Browser tabu (Passwort-Eingabe, siehe CLAUDE.md), daher:

- `tsc -b` + `vite build` über alle geänderten Dateien.
- Ein Node-Testlauf über die reine Logik: sieben Fälle für `archivGrund()` (ohne Sitzung, vergangene
  Sitzung, künftige Sitzung, Sitzung heute später am Tag, manuell ohne Sitzung, manuell schlägt
  künftige Sitzung, unbekannte Sitzung) sowie sechs Fälle für die Paginierungs-Arithmetik inkl.
  Klemmen einer zu hohen Seitenzahl und „Alle"; zusätzlich der Formatvergleich `+00:00` gegen `Z`.
- Ein temporärer statischer Test-Harness (Vite-Alias auf einen `supabaseClient`-Stub mit 32
  Beispieldokumenten, vier Sitzungen und sechs Fakten), um alle drei Seiten ohne Login im Browser zu
  rendern und die Filter durchzuklicken: 32 gesamt → 20 sichtbar bei 12 archivierten, „Meine
  Gremien" → 5, Suche „Vorlage" ohne Archiv-Chip → 10 Treffer davon 5 archiviert plus Hinweiszeile.
  Der Harness wurde danach wieder entfernt.

**Noch offen / bewusst nicht gemacht:** Für die `fakten`-Tabelle gibt es keine MCP-Tools – nicht
Teil des Auftrags, additiv nachrüstbar (Punkt 5 der Roadmap in CLAUDE.md).

### Nachtrag: MCP-Server kennt das Archiv (gleicher Tag)

Nutzerwunsch direkt im Anschluss: „Der MCP Server sollte auch das Archiv kennen."

- **`list_documents` bekommt `archiv`** (`ohne` = Standard, `alle`, `nur`). Der Standard spiegelt
  bewusst die Web-UI, die Archiviertes ebenfalls ausblendet – die Tool-Beschreibung und die
  „keine Treffer"-Meldung nennen den Parameter, damit das Ausblenden nicht still passiert.
  Archivierte Treffer sind in der Ausgabezeile mit `ARCHIV (Sitzung vorbei)` bzw. `ARCHIV (von Hand)`
  markiert.
  Beim Einbauen fiel auf, dass die Sitzungs-Nachladung bisher **nach** dem `limit`-Slice lief – für
  die Archiv-Regel wird `sessions.datum` aber schon zum Filtern gebraucht. Die Abfrage wurde deshalb
  vorgezogen und liefert jetzt `titel` **und** `datum` in einem Rutsch; der Titel wird unten
  unverändert für die Ausgabe weiterverwendet, es kommt also keine zweite Abfrage dazu.
- **Neues Tool `update_document_archiv(dokument_id, archivieren)`** – setzt/löscht `archiviert_am`,
  nur für Eigentümer\*innen. Beim Zurückholen eines Dokuments, dessen verknüpfte Sitzung vorbei ist,
  meldet das Tool ausdrücklich, dass es trotzdem im Archiv bleibt, und verweist auf
  `update_document_session` – sonst sähe der Aufruf nach einem Fehlschlag aus.
- Die Archiv-Regel ist in `tools/dokumente.ts` ein **bewusster Spiegel** von
  `src/lib/dokumenteArchiv.ts` (kein gemeinsames Build-Tooling zwischen Deno und React, gleiche
  Begründung wie bei ICS-Parsing/Hash-Helpern). Inklusive des numerischen Zeitstempel-Vergleichs.
  `startOfTodayIso()` rechnet in der Edge Function in UTC statt in lokaler Zeit – die Abweichung von
  bis zu zwei Stunden ist folgenlos, weil keine Sitzung zwischen Mitternacht und 2 Uhr stattfindet
  (gleiche Vereinfachung wie in `listSessions()`).
- Damit 30 statt 29 MCP-Tools. **Achtung beim Testen:** Die Tool-Liste eines Claude-Connectors ist
  pro Unterhaltung eingefroren – das neue Tool wird erst in einem **neuen Chat** sichtbar (siehe
  Fallstrick in CLAUDE.md).
- Verifiziert per `deno check --config supabase/functions/mcp-server/deno.json` und einem
  JSON-RPC-Smoke-Test gegen die deployte Function.

### Nachtrag 2: Fakten immer Ebenen-weit, Kopfleiste aufgeräumt (gleicher Tag)

Drei Nutzerwünsche direkt im Anschluss.

**Fakten sind nie privat** (`0040_fakten_immer_geteilt.sql`). 0039 hatte das Sichtbarkeitsmodell von
`dokumente` übernommen (`persoenlich`/`geteilt`); die Entscheidung danach: Fakten sollen
„grundsätzlich immer allen auf der entsprechenden Ebene zur Verfügung stehen". Eine private
Argumentationshilfe widerspricht dem Zweck der Seite – wer etwas nur für sich notieren will, hat
dafür den Dokumenten-Hub mit `sichtbarkeit='persoenlich'`.

Die Migration schränkt den Check-Constraint auf `sichtbarkeit = 'geteilt'` ein, setzt den Default
entsprechend und macht `ebene` zur Pflicht (ohne Ebene kann `fakten_select_shared` nicht
entscheiden, für wen der Fakt gilt). Gefahrlos, weil die Tabelle zu diesem Zeitpunkt noch leer war –
vor dem Schreiben der Migration per Query gegen die Live-DB geprüft (0 Zeilen), ebenso der
Constraint-Name. Die Spalte `sichtbarkeit` bleibt bewusst erhalten statt gedroppt zu werden: die
bestehende Policy liest sie, und ein Drop wäre destruktiv ohne Gewinn – so dokumentiert der
Constraint die Entscheidung genau an der Stelle, an der sie gilt.

Im Frontend entfallen damit die Sichtbarkeits-Radios; übrig bleibt „Gilt für Ebene" plus der
Hinweis, dass Fakten immer allen auf dieser Ebene zur Verfügung stehen. Ohne hinterlegte Ebene ist
der Anlegen-Knopf deaktiviert, mit Verweis auf Einstellungen → Meine Gremien. `FaktSichtbarkeit`
entfällt in `types.ts`, `FaktRow.ebene` ist nicht mehr nullable.

**Kopfleiste**: Reihenfolge jetzt Dokumente, Zahlen & Fakten, Archiv (vorher stand Archiv vorn).

**Profilmenü**: Einstellungen und Abmelden sind aus der Leiste in ein Klappmenü hinter dem eigenen
Profilbild gewandert – die Leiste zeigt damit nur noch inhaltliche Ziele. Das Profilbild sitzt links
neben dem Titel und ist jetzt ein Button mit kleinem Chevron-Abzeichen; das Menü schließt per Klick
daneben (`mousedown`, nicht `click`, damit es zu ist, bevor der Klick beim Element dahinter ankommt)
und per Escape. Beide Listener hängen nur, solange das Menü offen ist.

Verifiziert per `tsc -b` und erneut über den statischen Test-Harness: Menü öffnet/schließt korrekt
(Außenklick und Escape geprüft), Link-Reihenfolge in der Kopfleiste ausgelesen, Fakten-Formular ohne
Sichtbarkeits-Radios, ein Kreis-Fakt trägt jetzt sein Ebenen-Badge statt der früheren
„Persönlich"-Markierung.

### Nachtrag 3: Archiv-Ausblendung gehärtet, Löschen nur noch im Modal (2026-09-09)

**Meldung:** „Die ins Archiv verschobenen Dokumente sind nach wie vor im Dokumentenhub sichtbar."

Zuerst nachgemessen statt geraten – und dabei zeigte sich, dass die Regel selbst korrekt ist:

- Live-DB: 88 Top-Level-Dokumente, davon 7 mit der vergangenen Sitzung „Seniorenbeirat"
  (2026-09-02), 0 von Hand archiviert.
- `list_documents` mit `archiv="nur"` über den MCP-Connector liefert genau diese 7, jeweils mit
  `ARCHIV (Sitzung vorbei)`.
- Das **deployte** Bundle (`assets/index-CKf_gGdW.js`) enthält `archivGrund()` und den Filter
  `if(!G&&Ze.get(I.id))return!1` – die Auslieferung war also nicht das Problem.
- Der komplette Frontend-Datenfluss, gefüttert mit einem echten Export dieser 88 Dokumente und
  11 Sitzungen, blendet exakt die 7 aus (81 bleiben übrig).

Reproduzieren ließ sich der gemeldete Zustand damit nicht. Gefunden wurde aber eine reale Ursache
für genau dieses Bild, plus eine zweite, die es dauerhaft erzeugen könnte:

1. **Sichtbares Render-Fenster beim Laden.** `loadDocuments()` setzte erst `documents`, wartete dann
   auf die Sitzungsabfrage und setzte danach `sessionById`. Zwischen beiden rendert React einmal mit
   voller Liste und leerer Sitzungs-Map – und dann gilt kein Dokument als archiviert, das Archiv
   steht also für einen Moment mit in der Liste. Zwei `setState` nach *demselben* `await` werden
   gebatcht, zwei durch ein `await` getrennte nicht. Fix: Sitzungen vor den Dokumenten abwarten und
   beide States zusammen setzen – damit gibt es das Fenster nicht mehr.
2. **Verschluckter Fehler der Sitzungsabfrage.** `ladeSessionInfos()` las nur `data` und ignorierte
   `error`. Schlägt die Abfrage fehl oder liefert sie nichts, hält `archivGrund()` *jedes* Dokument
   für nicht archiviert – das Ergebnis sieht exakt wie ein kaputter Archiv-Filter aus, ohne jeden
   Hinweis. Die Funktion meldet jetzt `fehler` und `unvollstaendig` zurück; `Dokumente.tsx` zeigt in
   dem Fall einen Hinweisstreifen, statt still die falsche Liste zu rendern.

**Löschen nur noch im Detail-Modal** (Nutzerwunsch im selben Zug). Der „Löschen"-Knopf an der
Listenzeile ist weg; `handleDelete()` in `Dokumente.tsx` entfällt damit ersatzlos. Im Modal ersetzt
ein richtiger Bestätigungsdialog das frühere Inline-„Sicher?": Er nennt das Dokument, und wenn es
nicht nur für den Nutzer sichtbar ist (`sichtbarkeit='geteilt'`, oder `'einzelpersonen'` mit
Freigaben), warnt er ausdrücklich – inklusive des Kreises, den es trifft (Ebene + Gliederung bzw. die
namentlich Freigegebenen), und eines Hinweises auf die durch `parent_id ON DELETE CASCADE`
(0034_dokumente_kommentare.sql) mitgelöschten fremden Notizen. Die Zahl ist als „mindestens N"
formuliert, weil RLS nur die für den Nutzer sichtbaren Notizen zeigt. Der Knopf „Für alle löschen"
bleibt gesperrt, bis die Checkbox „Ja, ich möchte dieses Dokument für alle löschen." gesetzt ist.
Der Dialog liegt als `fixed`-Overlay über dem Modal (z-60) – innerhalb der `DetailModalShell` wäre er
sonst vom Scroll-Container abgeschnitten worden.

Verifiziert im Harness gegen die echten exportierten Daten: 81 von 88 sichtbar, kein Seniorenbeirat-
Dokument mehr in der Liste, null „Löschen"-Knöpfe in den Listenzeilen, und der Dialog-Knopf ist ohne
Haken deaktiviert und mit Haken frei.

### Nachtrag 4: einheitliche Löschbestätigung überall (2026-09-09)

Nutzerwunsch nach der Dokumenten-Variante: „Generell möchte ich bei allen Löschfunktionen noch eine
Bestätigung abfragen, wenn geteilt mit Beschreibung der Konsequenzen, ansonsten einfach sowas wie
'Bist du sicher?'."

Vorher war das im Repo dreigeteilt: `window.confirm` an fünf Stellen, ein Inline-„Sicher?" in den
Detail-Modals, und an einigen Stellen (Kommentare, angehängte Dokumente, Kontaktanfragen) gar keine
Rückfrage. Damit war die Schwelle für die dritte Wiederholung nach der Projekt-Faustregel klar
überschritten – also extrahiert statt ein viertes Mal nachgebaut:

**`src/components/LoeschDialog.tsx`** mit zwei Ausprägungen, gesteuert allein über `folgen`:

- leer/weggelassen → „Bist du sicher?", ein Satz („Das Dokument wird endgültig gelöscht."), optional
  ein `hinweis` (z. B. „Enthaltene Karten werden mitgelöscht.").
- gefüllt → „Wirklich für alle löschen?", rot abgesetzter Kasten mit den Folgen als Liste und eine
  Checkbox, die den Knopf „Für alle löschen" erst freigibt. Ein irreversibler Eingriff in fremde
  Bestände soll keinen Reflexklick überstehen.

Dazu der Hook **`useLoeschDialog()`**: `fragen({...})` am Knopf, `dialog` einmal ins JSX. Ohne ihn
hätte allein `TodoDetailModal` drei Sätze aus Kandidat/Bestätigt/Löschend/Fehler gebraucht (Karte,
Kommentar, Dokument). Nebenbei behandelt er Fehler zentral: die `handleDelete`-Funktionen **werfen**
jetzt, statt in einen eigenen `deleteError`-State zu schreiben – der Dialog bleibt offen und zeigt
den Fehler, statt dass ein Fehlschlag wie ein Erfolg aussieht. Die eigenen `deleteError`-States in
`TodoDetailModal`, `AntragDetailModal`, `TerminDetailPanel` und `Settings` entfallen dadurch.

Angewandt auf alle Löschpfade, mit den jeweils zutreffenden Folgen:

| Stelle | Geteilt-Variante, wenn … |
|---|---|
| Dokument (Hub) | Ebene-weit oder mit Einzelpersonen geteilt; nennt zusätzlich die per `ON DELETE CASCADE` mitgelöschten fremden Notizen |
| Notiz am Dokument | Notiz Ebene-weit oder mit Einzelpersonen geteilt |
| Zahlen & Fakten | **immer** – Fakten sind seit 0040 ausnahmslos Ebenen-Material |
| ToDo-Karte | Karte liegt auf fremden Boards (`todo_placements`); Nicht-Ersteller entfernen sie nur vom eigenen Board → schlichte Rückfrage, Knopf „Entfernen" |
| Kommentar/Dokument an Karte | Karte ist geteilt |
| Antrag | Freigaben in `antrag_shares` vorhanden; Nicht-Ersteller wie bei ToDos |
| Kommentar/Dokument am Antrag | Antrag ist freigegeben |
| Sitzung (nachgetragen) | **immer** – für alle Abonnenten derselben Kalenderquelle sichtbar |
| Eigener Termin | nie – gehört nur mir |
| Notiz/Dokument am Termin | `summaries.sichtbarkeit = 'geteilt'` |
| Kalenderquelle | `verwaltet_von is null` (gemeinsam verwaltet) |
| ToDo-Spalte | nie, aber mit Hinweis auf die mitgelöschten Karten |
| Benutzerkonto (Admin) | **immer** – trifft per Definition eine andere Person |
| Kontaktanfrage | nie |

Nicht umgestellt: das `window.confirm` bei „neues MCP-Token erzeugen" in `Settings.tsx`. Das ist
keine Löschfunktion, und die Dialog-Texte („Für alle löschen") würden dort nicht passen.

Verifiziert per `tsc -b`, `vite build` und einem Harness, der alle drei Ausprägungen des Dialogs
rendert (schlicht, schlicht mit Hinweis, geteilt) – inklusive der Prüfung, dass der Knopf ohne
gesetzte Checkbox deaktiviert bleibt.

### Leseansicht für Markdown-Vorlagen + update_document_inhalt (2026-10-14)

dailyallris wandelt die ALLRIS-Vorlagen jetzt in Markdown um und legt sie in `dokumente.inhalt`.
Das Modal im Dokumenten-Hub wurde darauf umgebaut (Variante A aus dem vorab gebauten Mockup), und
der MCP-Server bekam das fehlende Gegenstück zum Nachrüsten des Altbestands.

**Warum nicht `DetailModalShell`:** Die bisherige Hülle hat links die Metadaten und rechts die
Aktivität. Für ein Dokument, das man am Stück liest, ist das die falsche Aufteilung – die
Metadaten belegen dauerhaft die halbe Breite. Neues Layout in `DokumentDetailModal.tsx`:
Metadatenband über die volle Breite, darunter links die Leseansicht, rechts die Notizen.
`DetailModalShell` bleibt für ToDo- und Antrags-Modal unverändert; extrahiert wird erst, wenn ein
zweiter Aufrufer dieses Layout braucht.

Tags, Sitzung und ToDo-Verknüpfungen stehen im Band nur als Chips; die Eingabefelder klappen über
einen „Verknüpfungen"-Schalter darunter auf. Sonst nimmt die Verwaltung des Dokuments den Platz
weg, den das Lesen braucht.

**`src/lib/vorlageMarkdown.ts`** (reine Funktionen, ohne React, damit prüfbar) bereitet die
Vorlagen auf:

- Die Kopfdaten-Aufzählung (Drucksache, Datum, Federführung, ALLRIS-Link) entfällt – dieselben
  Angaben stehen besser im Metadatenband.
- Der **Beschlussvorschlag** wird herausgelöst und als eigener Kasten über den Text gesetzt. Er ist
  der Satz, über den abgestimmt wird, und im Original steht er zwischen zwei Formularblöcken
  begraben: 200 von 8.841 Zeichen in der Beispielvorlage.
- `remark-gfm` neu als Abhängigkeit, sonst rendert die Beratungsfolge-Tabelle nicht.

**Der Fund, der die meiste Arbeit gemacht hat.** Formularblöcke („Finanzielle Auswirkungen",
„Prüfung von Beteiligungsrechten") und Blocksatz-Fließtext erzeugen beim PDF-Auszug beide
Mehrfach-Leerzeichen, brauchen aber das genaue Gegenteil: beim Formular trägt die Spaltenausrichtung
Bedeutung, beim Fließtext ist sie Müll. Die erste Fassung trennte bei 3 Leerzeichen – und rendert
damit den halben Sachverhalt als graues Monospace-Formular. Im Browser sofort sichtbar.

Nachgemessen an DS11/1113, je Abschnitt: Formularblöcke haben Leerzeichen-Läufe von 6 bis 49
(Median 11–19), der Sachverhalt nie mehr als 5 (Median 3). Dazwischen liegt die Grenze mit
sauberem Abstand, deshalb `FORMULAR_LUECKE = 6`.

Zusätzlich glättet `prosaGlaetten()` die Blocksatz-Reste: Mehrfach-Leerzeichen innerhalb eines
Satzes und Absätze, die mitten im Satz umbrechen (33 % der Zeilen, 18 von 32 Absätzen). Tabellen,
Überschriften und Formularblöcke bleiben unangetastet; Listen behalten ihre Zeilenstruktur, werden
aber innerhalb der Zeile geglättet. **Das ist eine Notmaßnahme der Anzeige** – dauerhaft gehört die
Normalisierung in die Extraktion, weil nur dort auch die Volltextsuche davon profitiert. Sie wurde
trotzdem eingebaut, weil der Bestand die Artefakte heute enthält und das Modal nicht davon abhängen
darf, dass die Pipeline sauber liefert.

**Bilder** werden in `VorlageAnsicht.tsx` bewusst nicht geladen, sondern als Link dargestellt: der
Storage-Bucket ist privat und die Lese-Policy hängt an `dokumente.datei_url`, ein eingebettetes Bild
wäre also ohnehin nur für den Hochladenden sichtbar. Fremde URLs zu laden würde zudem IP und
Zeitpunkt jedes lesenden Mitglieds an einen fremden Server melden – bei Mandatsträgern keine
theoretische Sorge. Der Vollausbau (Jointabelle `dokument_anhaenge` + erweiterte Storage-Policy)
steht als Punkt 5 in der Roadmap.

**Neues MCP-Tool `update_document_inhalt(dokument_id, inhalt, modus?)`** – setzt den Text eines
eigenen Dokuments nachträglich, damit dailyallris die 228 bereits hochgeladenen Vorlagen mit ihrer
Markdown-Fassung versorgen kann. Bis dahin gab es Tools für Titel, Tags, Sitzung, Freigabe und
Archiv, aber keines für den Inhalt. `modus="anhaengen"` existiert wegen der Transportgrenze: ein
einzelner MCP-Aufruf wird ab etwa 13 KB unzuverlässig (gleiche Erfahrung wie bei `create_document`
mit `datei_base64`), die längste Vorlage im Bestand hat über 32.000 Zeichen. Damit 31 Tools.

**Verifiziert:** `vorlageAufbereiten()` gegen das echte Dokument aus der Live-DB (Beschlussvorschlag
gefunden, Kopfdaten entfernt, Tabelle erhalten, 6 Formularblöcke geschützt, 0 Mehrfach-Leerzeichen
im Sachverhalt, Randfälle leer/null/ohne Abschnitte), `deno check`, `tsc -b`, `vite build` sowie ein
Harness-Durchgang mit genau diesem Dokument – Sprungleiste, Verknüpfungs-Streifen, Tabelle,
Formularblock und die schmale Ansicht (375 px, kein Querscrollen).

### Nachbesserung: Listenvorschau statt Volltext (2026-10-14)

Nutzermeldung mit Screenshot: Nach dem Hochladen der Markdown-Fassungen sprengte jede Zeile der
Dokumentenliste die Seite - die Liste zeigte den kompletten Vorlagentext roh an.

Root Cause: `Dokumente.tsx` rendert seit jeher `{d.inhalt && <p className="whitespace-pre-wrap">}`.
Das war richtig, solange `inhalt` eine kurze handgeschriebene Notiz war; mit 9.000 Zeichen Markdown
pro Vorlage ist es unbrauchbar. Beim Umbau des Modals übersehen - die Leseansicht war getestet, die
Listenansicht nicht.

Neu `vorschau()` in `src/lib/vorlageMarkdown.ts`, gestaffelt, weil nicht jede Vorlage gleich
aufgebaut ist:

1. **Beschlussvorschlag**, wenn vorhanden - bei einer Verwaltungsvorlage die Aussage, die beim
   Überfliegen zählt.
2. sonst der erste richtige Absatz aus dem **Sachverhalt** - Fraktionsanträge haben keinen
   Beschlussvorschlag.
3. sonst der erste Absatz überhaupt.

Mit Mindestlänge 60 Zeichen, sonst gewinnen Formularreste. Genau das passierte beim ersten Versuch:
DS11/1108 zeigte „Gesehen Bm:" als Vorschau, weil das nach der Beratungsfolge-Tabelle der erste
Absatz ist und mit 11 Zeichen keine Formular-Heuristik auslöst. An allen acht Dokumenten mit Inhalt
aus der Live-DB geprüft, danach liefern alle eine brauchbare Zeile.

Die Vorschau bleibt reiner Text ohne Markdown-Auszeichnung und wird auf zwei Zeilen begrenzt
(`line-clamp-2`); gerendertes Markdown gehört ins Detail-Modal. Listenzeilen sind damit wieder
gleichmäßig 108-133 px statt seitenfüllend.

**Nebenbefund, nicht behoben:** Die Tag-Filterleiste zählt inzwischen 44 verschiedene Tags, davon
108 Vorkommen mit „Fraktion" im Namen - inklusive Dubletten, die sich nur in Schreibweise
unterscheiden („AfD Fraktion" / „AfD-Fraktion", „Fraktion Die Linke" / „Fraktion DIE LINKE",
„CDU-Fraktion" / „CDU-Fraktion und SPD-Fraktion"). Nach Normalisierung blieben 42. Die Filterleiste
ist dadurch höher als der erste Listeneintrag. Das ist ein Datenproblem aus der Tag-Vergabe in
dailyallris, kein Anzeigefehler - aber die Leiste sollte damit umgehen können (Begrenzung auf die
häufigsten Tags plus Aufklappen).

### list_documents bekommt einen Titel-Filter (2026-10-14)

Anforderung aus `dailyallris`: Das Skript muss vor jedem Upload prüfen, ob zu einer Drucksache
(z. B. `DS11/0941`) schon ein Dokument im Hub liegt, und für den einmaligen Nachtrag per
`update_document_inhalt` das passende Dokument finden.

Das ging bisher nicht zuverlässig. `list_documents` liefert höchstens 100 Treffer ohne
Paginierung, im Hub liegen aber über 200 geteilte Dokumente - beide Archiv-Hälften stoßen schon
für sich an die Grenze. Ein Abgleich über den exakten Titel oder ein festes Tag scheidet aus, weil
beides nachträglich von Hand geändert wird; stabil ist nur die DS-Nummer am Titelanfang.

Neuer optionaler Parameter `titel`: Teilstring-Suche, Groß-/Kleinschreibung egal.

**Der Filter läuft in der Datenbankabfrage, nicht beim Formatieren.** Das ist der eigentliche Punkt:
`limit` wird erst nach dem Sortieren nach `erstellt_am` angewendet, ein nachgelagerter Filter würde
also nur die 100 neuesten Dokumente durchsuchen und eine ältere Drucksache nie finden. `.ilike()`
hängt deshalb an allen drei Teilabfragen - eigene Zeilen, Ebene-weit geteilte und per
`dokument_shares` einzeln freigegebene.

`ilikeMuster()` maskiert `%`, `_` und `\` im Suchbegriff, zusätzlich `*`: PostgREST ersetzt in
Mustern `*` durch `%`, ein Stern im Suchbegriff wäre sonst eine Wildcard. Drucksachennummern
enthalten nichts davon, aber der Parameter ist allgemein nutzbar.

Sichtbarkeitsprüfung (`darfSehen`) und Archiv-Logik bleiben unverändert, ebenso das Ausgabeformat -
dailyallris parst die Zeilen mit einem festen Muster und prüft zusätzlich, ob jeder zurückgegebene
Titel den Suchbegriff enthält; eine Formatänderung würde den Upload stillegen. Die
"keine Treffer"-Meldung nennt jetzt den Suchbegriff mit, sonst sieht ein Tippfehler aus wie ein
leerer Hub.

Ohne `titel` verhält sich das Tool unverändert.

### Formularblöcke scrollen statt umzubrechen (2026-10-14)

In der Leseansicht brach ein Formularblock (`Finanzielle Auswirkungen`) lange Zeilen um:
"Beschlussumsetzung bis: … Beschlusskontrolle Ja X Nein" ist im Markdown eine Zeile, erschien aber
auf zwei, und die Spalten standen nicht mehr nebeneinander. Ursache: `.mc-dokument-content pre`
hatte zwar `overflow-x-auto`, aber zugleich `whitespace-pre-wrap` - der Scrollbalken kam so nie
zum Zug. Jetzt `whitespace-pre`, breite Formularzeilen scrollen horizontal.

Weil die Ansicht in Sitzungen auf dem iPad läuft und iPadOS Scrollbalken ausblendet, zeigt ein
Schatten am Rand, dass dort noch Inhalt verborgen ist - sonst fiele ein abgeschnittener Betrag
rechts nicht auf. Reines CSS (Scroll-Shadow mit `background-attachment: local`): die zwei
mitscrollenden Verläufe decken den Schatten an dem Rand ab, an dem nichts mehr kommt. Blöcke ohne
Überlauf zeigen keinen Schatten. Geprüft an DS11/1113 in Tablet-Breite (768 px).

### Technische Konten: profiles.technisch (2026-10-14)

Der ALLRIS-Import von dailyallris läuft seit heute über ein eigenes Konto statt über das
persönliche MCP-Token eines Mitglieds. Grund: Das Token lag in `dailyallris/.env` und hätte bei
einem Leck Zugriff auf das komplette Konto gegeben – ToDos, Notizen, Anträge, Presseschau,
Termine. Ein eigenes Konto begrenzt den Schaden auf den Dokumenten-Hub.

Nebenwirkung: Das Konto erfüllt dieselben Bedingungen wie ein Mensch – gleiche Partei, gleiche
Ebene, gleiche Gliederung, denn ohne das könnte `create_document` gar nichts anlegen und niemand
würde die Dokumente sehen. Damit tauchte es in jeder Teilen-Kandidatenliste auf, als könne man ihm
eine ToDo-Karte zuweisen.

Neue Spalte `profiles.technisch` (`0041_profiles_technisch.sql`). **Bewusst eine eigene Spalte
statt einer zusätzlichen `rolle`:** `rolle` steuert Rechte (admin/fraktionsbuero/mitglied) und wird
an mehreren Stellen geprüft – „ist das ein Mensch?" ist davon unabhängig, ein technisches Konto
bleibt rechtlich ein normales Mitglied.

Ausgeblendet wird an vier Stellen, überall dort, wo auch der exakte Partei-/Ebenen-/
Gliederungs-Abgleich stattfindet: `loadCandidates()` in `TodoDetailModal` und `AntragDetailModal`,
die Kandidaten-`useEffect` in `DokumentDetailModal` und `resolveTeilenMitNamen()` im MCP-Server
(sonst ließe sich das Konto über `teilen_mit_namen` weiterhin adressieren).

**Das ist Aufräumen der Oberfläche, keine Zugriffsgrenze** – wer die `user_id` kennt, könnte eine
Freigabe weiterhin direkt anlegen. Als Sicherheitsmaßnahme taugt es nicht und ist auch nicht so
gemeint; der Sicherheitsgewinn liegt im getrennten Token, nicht im Ausblenden.

Setzbar in der Benutzerverwaltung über eine Checkbox (`admin-users` nimmt `technisch` bei `create`
und `update` entgegen, die Liste zeigt ein Badge) – damit braucht das nächste technische Konto
keinen SQL-Eingriff. Das bestehende Import-Konto hat die Migration gleich mitgesetzt.

**Weiterhin offen:** Zwei Profile sind unvollständig und sehen deshalb den gesamten Import nicht –
bei Benjamin Korte fehlt die Gliederung, bei Thorsten Schick zusätzlich die Ebene „Kommune". Die
Sichtbarkeit hängt an allen drei Feldern gleichzeitig, und es gibt keinerlei Rückmeldung darüber.

### Dokumentenbestand auf das technische Konto übertragen + delete_document (2026-10-14)

Nutzerentscheidung: Alle Hub-Dokumente sollen vom technischen Import-Konto verwaltet werden.
257 Top-Level-Dokumente wechselten per `update dokumente set user_id = …` den Besitzer; der
Bestand liegt jetzt vollständig bei `ALLRIS-Import` (258 inkl. des einen Dokuments, das der Bot
selbst angelegt hatte).

**Notizen sind ausdrücklich nicht mitgezogen.** Die 268 Notizen von Thorsten Kois und die eine von
Stefan Woelk bleiben bei ihren Verfassern – das sind persönliche Analysen, kein Importmaterial.
Ebenso unberührt: Benjamin Kortes zwei selbst angelegten, persönlichen Dokumente. Der Filter war
deshalb `parent_id is null and user_id = <Thorsten>`, nicht der ganze Bestand.

Sichtbarkeit bleibt: alle 258 sind `geteilt` mit Ebene Kommune/Iserlohn, und das Bot-Konto hat
Partei CDU – `dokumente_select_shared` prüft die Partei des *Uploaders* gegen die des Betrachters,
und die stimmt weiterhin.

**Schreibrechte: bewusst keine neue Policy.** Zur Wahl standen eine Fraktions-Policy (gleiche
Partei/Ebene/Gliederung darf bearbeiten), eine Admin-Policy und gar nichts. Entschieden wurde
"gar nichts": Der Hub ist für die Web-UI jetzt eine Nur-Lese-Ablage. TagEditor, Sitzungs-Auswahl,
Archivieren und Löschen sind dort bei allen 258 Dokumenten verschwunden, weil `document.user_id
=== userId` nirgends mehr zutrifft. Notizen anhängen funktioniert weiter – die hängen am eigenen
Konto, und `dokumente_insert_own` prüft nur `user_id = auth.uid()`.

**Daraus entstand eine Lücke, die sofort geschlossen werden musste:** Hub-Dokumente waren danach
gar nicht mehr löschbar – in der UI nicht (niemand Eigentümer) und über MCP auch nicht, denn die
Tool-Liste kannte nur Anlegen, Auflisten und fünf Update-Varianten. Das ist nicht theoretisch: am
selben Tag mussten 28 Dubletten eines fehlgeschlagenen Import-Laufs per SQL weggeräumt werden, und
solange dailyallris sein Manifest nicht über CI-Läufe hinweg behält, entstehen neue.

Neues Tool **`delete_document(dokument_id, auch_fremde_notizen?)`** mit zwei Vorsichtsmaßnahmen,
die aus dem Datenmodell folgen:

- `dokumente.parent_id` hat `ON DELETE CASCADE`. Am Dokument hängende Notizen verschwinden also
  mit – auch fremde. Sind welche dabei, bricht der Aufruf ab und nennt die betroffenen Personen;
  erst `auch_fremde_notizen: true` löscht wirklich. Dasselbe Muster wie die Checkbox im
  `LoeschDialog` der Web-UI.
- Dateien im Storage verschwinden nicht, wenn die Zeile gelöscht wird. Sie werden deshalb **vor**
  der Zeile entfernt: schlägt das fehl, bleibt die Zeile stehen und der Vorgang ist wiederholbar –
  umgekehrt wären die Dateien unauffindbar verwaist. Im Bucket lagen zu diesem Zeitpunkt bereits
  40 solcher Waisen aus früheren Löschungen.

Damit 32 MCP-Tools.

### Suche gegen die Blocksatz-Reste abgehärtet (2026-10-14)

Die Volltextsuche im Dokumenten-Hub war ein schlichtes `haystack.includes(q)`. Mit den
Blocksatz-Resten aus dem PDF-Auszug scheiterte damit jede Phrasensuche, die über eine Lücke lief:
184 der 244 Dokumente mit Inhalt enthalten Mehrfach-Leerzeichen mitten im Satz, zusammen 33.628
doppelte Leerzeichen. Eine Suche nach „Jugendhilfe an Schule" fand nichts, sobald zwischen zwei
Wörtern drei Leerzeichen standen – und das war der Normalfall.

`suchtext()` in `Dokumente.tsx` normalisiert jetzt beide Seiten des Vergleichs: Kleinschreibung und
alle Weißraum-Folgen auf ein Leerzeichen. Geprüft an echtem Text: „vorgehalten wurde",
„Verwaltung sowie der Träger" und „Iserlohn vorgehalten" fanden vorher nichts und treffen jetzt.

Das ersetzt die Normalisierung in der Extraktion **nicht** – die bleibt die eigentliche Lösung,
weil nur sie die gespeicherten Daten sauber macht (und damit auch eine spätere serverseitige
Suche). Es macht die Suche aber unabhängig davon, ob die Pipeline sauber liefert, und hilft
ebenso bei von Hand eingetipptem Text mit doppelten Leerzeichen.

Außerdem aufgeräumt: 40 verwaiste Dateien im `dokumente`-Bucket (aus gelöschten Dokumenten und den
28 Import-Dubletten) über die Storage-API entfernt. Der Bucket enthält jetzt 254 Dateien, keine
davon verwaist.

### Absatz-Zusammenführung wieder entfernt (2026-10-14, nach dem Backfill)

dailyallris normalisiert die Prosa jetzt schon bei der Extraktion, und der Backfill hat alle 244
Dokumente mit Inhalt auf die bereinigte Fassung gebracht. Nachgemessen: **0 von 244 Dokumenten**
haben noch Mehrfach-Leerzeichen im Fließtext, während die 205 Dokumente mit Formularblöcken und
die 238 mit Tabellen unverändert geblieben sind – die 6-Leerzeichen-Schwelle hat in der
Python-Portierung also richtig getrennt.

Damit wurde `prosaGlaetten()` im Frontend an einer Stelle **schädlich**. Die Funktion hängte einen
Absatz an den vorigen, wenn der nicht auf einem Satzzeichen endete – gedacht für die harten
Umbrüche aus dem PDF-Auszug. Auf sauberen Daten rät das falsch: Feldwerte enden naturgemäß ohne
Punkt. Konkret wurde aus

    ## Verfasser
    AfD-Fraktion, AfD Fraktionsgeschäftsstelle
    Die v. g. Fraktion nimmt folgende Umbesetzungen gem. § 50 Abs. 3 Satz 7 GO NRW vor:

ein einziger verklebter Absatz. Am Bestand gemessen hätte das **98 von 244 Dokumenten** betroffen.

Das Zusammenführen ist entfernt; das Entfernen von Mehrfach-Leerzeichen bleibt als Absicherung
gegen von Hand eingetippten Text. Regressionstests gegen den Live-Bestand: Beschlussvorschlag wird
weiterhin gefunden, Abschnitte, Tabellen und Formularblöcke bleiben erhalten, Kopfdaten werden
entfernt.

Lehre fürs nächste Mal: Eine Heuristik, die fehlende Daten errät, muss zurückgebaut werden, sobald
die Daten stimmen – sonst wird aus der Krücke ein Fehler.

### Dokumente an mehreren Sitzungen (2026-10-14)

Eine Verwaltungsvorlage durchläuft typischerweise mehrere Gremien – erst den Fachausschuss, dann
den Rat. Die Spalte `dokumente.session_id` (0036) kannte nur eine Sitzung, und
`update_document_session` hat sie überschrieben: faktisch gewann immer die zuletzt gesetzte. Für
den geplanten Tagesordnungs-Import aus ALLRIS war das unbrauchbar.

**`sitzung_dokumente`** (`0042_sitzung_dokumente.sql`) nach dem Muster von `todo_dokumente`: reine
Verknüpfungstabelle ohne eigene `user_id`, SELECT hängt an der Sichtbarkeit des Dokuments,
INSERT/DELETE strikt beim Eigentümer.

Die alte Spalte ist **entfallen**, nicht nur verwaist – „genau eine Quelle der Wahrheit" verträgt
keine zweite Ablage, die jemand versehentlich weiterliest. Die Migration kopiert erst alle 127
Werte, prüft dann in einem `DO`-Block, dass Spaltenwerte und Zeilen übereinstimmen, und droppt die
Spalte erst danach. Migrationen laufen in einer Transaktion: bei einer Abweichung bricht alles ab
und nichts wird angewendet. Nachgezählt: 127 vorher, 127 nachher.

**Archiv-Regel: die LETZTE Sitzung zählt.** Würde schon die erste vergangene Sitzung archivieren,
verschwände eine Vorlage nach dem Fachausschuss aus der Arbeitsliste, obwohl der Rat noch über sie
entscheidet. Umgesetzt in `src/lib/dokumenteArchiv.ts` und gespiegelt in
`supabase/functions/mcp-server/tools/dokumente.ts`. Geprüft über sieben Fälle, darunter „vergangen
+ künftig" (nicht archiviert, in beiden Reihenfolgen), „beide vergangen" (archiviert) und
„manuell schlägt künftige Sitzung".

**MCP:** `update_document_session` ist durch `link_document_session` und `unlink_document_session`
ersetzt – die Semantik „ersetzt die eine Sitzung" passt nicht mehr. `link_document_session` ist
idempotent und meldet „bereits verknüpft" statt zu scheitern, weil dailyallris es bei jedem Lauf
erneut aufruft. `create_document` behält den Parameter `session_id` und legt daraus eine
Verknüpfungszeile an, damit bestehende Aufrufer weiterlaufen. In `list_documents` listet
„Sitzung: …" jetzt alle verknüpften Sitzungen; das übrige Zeilenformat bleibt unverändert, weil
dailyallris es mit einem festen Muster parst. Der `session_id`-Filter läuft über die neue Tabelle.
Damit 33 Tools.

**`list_sessions` brauchte keine Änderung am Gremienfilter.** Anders als angenommen filtert das
Tool nur mit `nur_meine_gremien: true`; der Standard liefert alle sichtbaren Sitzungen, und
„Stadtrat Iserlohn" ist eine gemeinsam verwaltete Quelle (`verwaltet_von is null`) – das
Import-Konto sieht sie also ohnehin. Ergänzt wurde `quelle_url` in der Ausgabe.

**Zu quelle_url – der Befund für dailyallris:** Die Spalte taugt **nicht** als Sitzungs-Kennung.
Von 759 Sitzungen haben 707 eine `quelle_url`, aber nur 72 enthalten `SILFDNR`; bei der Iserlohner
Quelle sind es 42 von 161, und sämtliche aktuellen und künftigen Sitzungen gehören nicht dazu.
Was dort steht, ist die ALLRIS-Tagesansicht (`si010?DD=..&MM=..&YY=..`) – für alle Sitzungen
desselben Tages identisch. Eindeutig ist dagegen **Gremium + Datum samt Uhrzeit**: bei den 161
Iserlohner Sitzungen ist `gremium` immer gesetzt und die Kombination kollisionsfrei (0 Dubletten),
während Gremium + Tag allein 29 Mehrfachtreffer hat.

### Tagesordnung als Lesenavigation, drei umschaltbare Layouts (2026-10-14)

Nutzerwunsch: Die drei Varianten aus dem Mockup sollen in der Anwendung umschaltbar sein – und für
Sitzungen wäre Variante B ideal, mit der Tagesordnung links, dem gewählten Dokument in der Mitte
und den Notizen rechts.

**`sitzung_dokumente` bekommt Tagesordnungs-Felder** (`0043_sitzung_dokumente_top.sql`):
`top_nummer`, `top_titel`, `reihenfolge`. Die Verknüpfungszeile *ist* der Tagesordnungspunkt –
dasselbe Dokument steht im Finanzausschuss unter TOP 7.2 und im Rat unter TOP 3.1, die Angabe
gehört also an die Verknüpfung und nicht an `dokumente`.

Zwei Entscheidungen dabei: `top_nummer` ist **Text**, weil Tagesordnungen mehrstufig nummerieren
(„3.1", „10.2.1") und nicht-öffentliche Punkte Präfixe tragen („N 4.2"). Und `reihenfolge` gibt es
**zusätzlich**, weil sich `top_nummer` nicht sortieren lässt: als Text käme „3.10" vor „3.2".
Maßgeblich ist die Reihenfolge auf der Tagesordnung, und die kennt nur der Importeur. Alle drei
Felder sind optional – von Hand gesetzte Verknüpfungen ohne Tagesordnungsbezug bleiben gültig.

**`link_document_session`** nimmt die Felder entgegen und ist weiterhin idempotent, aber nicht mehr
untätig: Kommen Tagesordnungs-Angaben mit und existiert die Verknüpfung schon, werden sie
aufgefrischt – eine Tagesordnung kann sich bis zur Sitzung ändern. Ohne solche Angaben bleibt es
bei „bereits verknüpft". In `list_documents` erscheint die Nummer als „Sitzung: Rat der Stadt
Iserlohn (TOP 3.1)".

**Drei Layouts im Modal**, Schalter im Kopf, Auswahl pro Gerät in `localStorage`:

- **A** – Dokument und Notizen (wie bisher)
- **B** – zusätzlich eine linke Spalte: die Tagesordnung, wenn aus einer Sitzung heraus geöffnet
- **C** – Lesemodus: 68 Zeichen Zeilenbreite, Notizen per Knopf einklappbar

**Wer die Auswahl besitzt, war die eigentliche Designfrage.** Das Modal hält lokale Spiegel der
Prop (`docTags`, `archiviertAm`, `ownShareNames`), die nur beim Mounten aufgesetzt werden – ein
Dokumentwechsel innerhalb des Modals hätte sie stehen lassen. Deshalb liegt die Auswahl beim
Aufrufer (`TerminDetailPanel`), der das Modal per `key={document.id}` remountet. Das Modal meldet
den Klick nur über `onAuswahl` nach außen.

Verifiziert im Harness gegen die echte Rat-Sitzung vom 13.10. mit ihren 34 verknüpften Dokumenten:
Tagesordnung links mit Nummern, Klick wechselt das Dokument (Kopfzeile folgt), Umschalten auf C
blendet die Tagesordnung aus und zeigt den Knopf „Notizen ausblenden", der die rechte Spalte
entfernt. Die dafür vergebenen TOP-Nummern waren Testdaten und wurden anschließend wieder
zurückgesetzt – es gibt bislang keine echte Tagesordnung im Bestand.

### Die Tagesordnung vollständig: Punkte ohne Drucksache, Ergebnis, Import-Tool (2026-10-14)

Nutzerwunsch: Das Dokument „Tagesordnung" soll in die linke Spalte aufgelöst werden, die Punkte
sollen auf die Drucksachen im Hub verweisen, und das Tagesordnungsdokument selbst wird danach
nicht mehr gebraucht. Dreispaltige Ansicht, umschaltbar. Fehlende DS-Dokumente sollen nachgeladen
werden.

**Was die Analyse der echten Tagesordnung ergab** (Rat der Stadt Iserlohn, 09.12.2025): 84 Punkte,
davon **63 mit und 21 ohne Drucksache**. Die Punkte ohne Vorlage sind keine Randerscheinung –
„Eröffnung der Sitzung", „Einwohnerfragen", „Mitteilungen des Vorsitzenden" strukturieren den
Ablauf. Mit `dokument_id NOT NULL` (0042) ließen sich nur 63 speichern; die linke Spalte hätte eine
Tagesordnung mit Löchern gezeigt, in der die Nummerierung springt. Dazu führt die Tagesordnung eine
Spalte „Zuständigkeit" mit dem Beratungsergebnis (`ungeändert beschlossen`, `geändert beschlossen`,
`abgelehnt`, `behandelt`, `zur Kenntnis genommen`) – genau das, was man bei einer vergangenen
Sitzung sehen will, und es fehlte im Modell. Beides nach Rückfrage entschieden.

**`0044_tagesordnungspunkte.sql`:**

- `dokument_id` wird **nullable** – die Zeile ist damit endgültig der Tagesordnungspunkt, der ein
  Dokument tragen *kann*. Der Tabellenname bleibt `sitzung_dokumente`: er beschreibt weiterhin die
  Mehrheit der Zeilen, ein Rename hätte Frontend, MCP-Server und vier Policies angefasst, ohne
  etwas zu verbessern.
- `ergebnis text` – Freitext, kein Enum: die Wertemenge gehört ALLRIS, und ein unbekannter Wert
  darf keinen Import abbrechen. Am TOP und nicht am Dokument, weil dieselbe Vorlage im
  Fachausschuss empfohlen und im Rat beschlossen wird.
- **Partieller Unique-Index auf (`session_id`, `top_nummer`)**. Ohne ihn hätte ein zweiter
  Import-Lauf alle 21 Punkte ohne Drucksache verdoppelt: `unique (session_id, dokument_id)` greift
  bei NULL nicht, weil NULL in Postgres zu jedem anderen NULL ungleich ist. Partiell, damit von
  Hand gesetzte Verknüpfungen ohne TOP-Nummer unberührt bleiben.
- **Alle vier Policies neu.** Die SELECT-Policy prüfte ausschließlich das Dokument – bei
  `dokument_id = null` ist ihr `exists()` false, der Punkt wäre für *niemanden* sichtbar gewesen.
  Jetzt hängt seine Sichtbarkeit an der Sitzung. Bei INSERT/DELETE gibt es für solche Punkte kein
  Dokument, an dem die Berechtigung hängen könnte; dort entscheidet die Sitzung, und zwar nur bei
  selbst nachgetragenen (`sessions.erstellt_von`). Importierte Sitzungen gehören niemandem – ihre
  Tagesordnung kommt über den MCP-Server, der an RLS vorbei arbeitet.

**`set_session_agenda`** (neu, `tools/tagesordnung.ts`) schreibt die Tagesordnung als Ganzes statt
84-mal `link_document_session`: Die Reihenfolge ist nur als Ganzes bekannt, entfallene Punkte
müssen verschwinden, und der Importeur kennt die **Drucksachennummer**, nicht die UUID. Das
Auflösen gehört deshalb in den Server – samt der Rückmeldung, welche Nummern im Hub fehlen; genau
die lädt dailyallris dann nach und ruft erneut auf. Beim Auflösen genügt ein Präfix-Vergleich
nicht: „DS11/0470" wäre sonst auch ein Treffer für „DS11/0470-1", die Ergänzungsvorlage. Nach der
Nummer muss ein Trenner folgen.

Geschrieben wird **löschen-dann-einfügen** statt Upsert: Wandert ein Dokument zwischen zwei Läufen
von TOP 3.1 auf 3.2, scheiterte das Einfügen an `unique (session_id, dokument_id)`, solange die
alte Zeile noch steht. `modus="anhaengen"` gibt es, weil eine Ratstagesordnung mit 84 Punkten als
JSON rund **17 KB** ergibt und ein einzelner MCP-Aufruf ab ca. 13 KB unzuverlässig wird – dieselbe
Grenze wie bei `update_document_inhalt`. Dazu `list_session_agenda` zum Zurücklesen.

**Im Modal** zeigt die linke Spalte jetzt die Tagesordnung samt der Punkte ohne Drucksache (kursiv
und grau, nicht anklickbar – es gibt nichts zu öffnen) und das Ergebnis unter dem Wortlaut. Titel
werden auf drei Zeilen gekürzt (voller Wortlaut im `title`-Attribut), sonst ist eine Spalte mit 84
Punkten nicht mehr überschaubar. Zwei Dinge fielen beim Prüfen im Browser auf: Der aktive Punkt
muss nach dem Wechsel wieder in den sichtbaren Bereich scrollen, weil der Remount (`key`) die
Spalte an den Anfang zurücksetzt – bei 84 Punkten verliert man sonst die Stelle. Und das Layout
braucht **zwei** `localStorage`-Schlüssel: aus dem Hub heraus gibt es keine Tagesordnung, die linke
Spalte wäre leer (Standard: zwei Spalten); aus einer Sitzung heraus ist die Tagesordnung der
Einstieg (Standard: drei Spalten).

**Der Sitzungs-Panel listet die Tagesordnung statt der Dokumente** – mit Nummer, Ergebnis und den
Punkten ohne Drucksache als gestrichelte, nicht anklickbare Zeile. Die Überschrift wechselt erst
auf „Tagesordnung", wenn mindestens ein Punkt eine TOP-Nummer trägt; von Hand gesetzte
Verknüpfungen bleiben „Verknüpfte Dokumente".

Verifiziert im Browser-Harness gegen die echte Tagesordnung vom 09.12.2025 (alle 84 Punkte, 21 ohne
Drucksache): dreispaltiger Einstieg aus der Sitzung, Klick auf „Ö 11" wechselt das Dokument und
zentriert den Punkt wieder, Punkte ohne Drucksache sind kursiv und tot, im Hub-Kontext steht links
„Keine Tagesordnung" und der Einstieg ist zweispaltig.

### Der Sitzungsschlüssel war die ganze Zeit da: `sessions.ics_uid` (2026-10-14)

Beim Bau des Tagesordnungs-Imports stellte sich die Frage, wie dailyallris eine Tagesordnung ihrer
Sitzung zuordnet. Für `quelle_url` war das im Vortag bereits verneint worden (ALLRIS-Tagesansicht,
für alle Sitzungen eines Tages identisch), und der Ersatzvorschlag war Gremium + Datum samt
Uhrzeit. Ein Blick in den ICS-Feed zeigt den eigentlichen Schlüssel: `UID:ALLRIS-Sitzung-2003019`.
Der Importer legt ihn seit jeher in `sessions.ics_uid` ab (`onConflict: 'source_id,ics_uid'`), und
es ist dieselbe **SILFDNR**, die im Kopf jeder Tagesordnung steht
(`to010?SILFDNR=2001745`). `list_sessions` gibt ihn jetzt mit aus, und
`set_session_agenda`/`list_session_agenda` nehmen ihn alternativ zur UUID entgegen (auch als nackte
Nummer).

**Zur Kalenderquelle** (Nutzerhinweis, die öffentliche ALLRIS-URL sei
`https://www.iserlohn.sitzung-online.de/public/ics/SiKalAbo.ics`): Beide Feeds abgerufen und
verglichen – der öffentliche hat **47 Termine, der bisher genutzte persönliche 69, und der
öffentliche ist eine echte Teilmenge** (0 Termine nur dort). Es fehlen genau die nicht-öffentlichen
Gremien: CDU-Fraktion, Aufsichtsrat der Stadtwerke, Kleine Kommission Finanzen, Verwaltungsrat
Märkischer Stadtbetrieb. Beide haben zudem dasselbe gleitende Fenster (09/2026–10/2027) und
enthalten **keinen einzigen** Termin aus Nov/Dez 2025. Ein Wechsel auf die öffentliche URL würde
also 22 Termine kosten und die fehlenden Sitzungen nicht zurückbringen – das gleitende Fenster
gehört ALLRIS, nicht dem Abonnement. Die Quelle bleibt daher unverändert; Vergangenes kann nur über
den ALLRIS-Sitzungskalender selbst nachgetragen werden (dailyallris), nicht über ICS.

### 36 fehlende Ausschusssitzungen nachgetragen (2026-10-15)

Nutzerlieferung aus dem ALLRIS-Sitzungskalender: 36 Sitzungen aus Nov 2025 bis Mai 2026, die im
Cockpit fehlten. Stichprobe im Bestand bestätigt das Muster – für Feb–Mai 2026 liegen dort nur Rat,
Sportausschuss, Verkehrsausschuss, Aufsichtsräte und die Fraktionstermine; sämtliche Fachausschüsse
fehlen. Ursache ist dieselbe wie bei den sieben Sitzungen vom Vortag: der ALLRIS-ICS-Feed hat ein
gleitendes Fenster und reicht nicht in die Vergangenheit.

Nachgetragen per Migration (`0045_sitzungen_nachtragen.sql`) statt per Skript – einmaliger Vorgang,
derselbe Weg wie jede andere Änderung an der Live-DB, und nachlesbar. Die Festlegungen stehen im
Kopf der Migration; die beiden nicht offensichtlichen: `source_id` wird **nicht** hart verdrahtet,
sondern aus dem Bestand abgeleitet (die Quelle, die die meisten Sitzungen des Rates trägt – das
überlebt ein Umbenennen), und `ort` bleibt **null** statt geraten; „Sitzungssaal Reiterweg" wäre
für die meisten richtig, aber eben nicht für alle, und ein falscher Ort ist schlechter als keiner.
Idempotent über (Quelle, Gremium, Zeitpunkt).

**Folge für den Tagesordnungs-Import:** Diese Zeilen haben keine `ics_uid`, die ALLRIS-Kennung ist
hier nicht bekannt. `set_session_agenda`/`list_session_agenda` nehmen deshalb jetzt auch
**`gremium` + `datum`** entgegen. Verglichen wird auf den **Tag**, nicht auf die Minute: ALLRIS
meldet im Kalender gern 17:03, wo die Tagesordnung 17:00 sagt. Wird die Sitzung so gefunden und
kommt eine `ics_uid` mit, trägt der Server sie nach – danach greift wieder der direkte Weg. Bei
mehreren Treffern bricht der Aufruf ab und verlangt die `session_id`, statt zu raten.

### Erste echte Tagesordnung im Bestand – und ein Fehler, den erst sie zeigte (2026-10-15)

Die Ratssitzung vom 09.12.2025 bekommt ihre Tagesordnung: 84 Punkte aus dem Markdown-Dokument im
Hub, mit Drucksachen-Verknüpfung und Ergebnis (`0046_sitzung_09122025_tagesordnung.sql`). Erster
echter Datensatz dieser Art – bisher gab es nur das Modell (0043/0044) und das Werkzeug.

**Die Sitzung war entgegen meiner Annahme bereits vorhanden.** Ich hatte sie für fehlend gehalten,
weil sie in einer auf 100 Zeilen begrenzten Abfrage nicht auftauchte – die reichte nur bis Februar
2026 zurück. Die Migration fängt das ab: Sie sucht erst über `ics_uid`, dann über Gremium + Tag,
legt nur an, wenn beides nichts findet, und trägt bei einem Treffer ohne Kennung die ALLRIS-Nummer
nach.

**Der Fehler, den der erste Durchlauf zutage förderte:** `duplicate key value violates unique
constraint "sitzung_dokumente_session_id_dokument_id_key"`. dailyallris hatte die Vorlagen dieser
Sitzung längst hochgeladen **und verknüpft** – 55 Dokumente, alle ohne TOP-Nummer. Das Löschen vor
dem Schreiben entfernte aber nur Zeilen *mit* TOP-Nummer, also blieben die blanken stehen, und
`unique (session_id, dokument_id)` aus 0042 lässt dasselbe Dokument kein zweites Mal zu.

Die Regel dazu: Eine Zeile mit Tagesordnungspunkt ist die reichere und **ersetzt** die blanke
Verknüpfung desselben Dokuments. Blanke Verknüpfungen zu Dokumenten, die nicht auf der Tagesordnung
stehen, bleiben unangetastet. Derselbe Fehler steckte in `set_session_agenda` – dort im Modus
"ersetzen", während "anhaengen" ihn zufällig nicht hatte, weil es ohnehin nach `dokument_id`
löscht. Beides korrigiert. Ohne den Live-Lauf wäre das erst dailyallris um die Ohren geflogen.

### Sitzung öffnet direkt im Leser (2026-10-15)

Nutzerwunsch nach dem ersten echten Tagesordnungs-Datensatz: Eine Sitzung zeigte beim Öffnen die
alte Liste („Verknüpfte Anträge", „Tagesordnung", rechts die Notizen), und erst ein Klick auf einen
Tagesordnungspunkt führte in die dreispaltige Leseansicht. Das soll gleich so aufgehen.

`TerminDetailPanel` schlägt deshalb beim **ersten** Laden einer Sitzung den ersten Punkt mit
Dokument auf. Zwei Einschränkungen: nur bei einer echten Tagesordnung (mindestens eine TOP-Nummer,
die setzt nur der Import) – bei losen Verknüpfungen wäre die Wahl eines Dokuments Willkür. Und nur
beim ersten Laden: `loadLinkedDokumente()` läuft auch nach dem Löschen eines Dokuments erneut, und
dann spränge das Modal dem Nutzer wieder vor die Nase.

Damit wird der Rückweg zur Sitzung zum Problem: Anträge, Sitzungsnotizen und die hochgeladenen
Zusammenfassungen liegen in der Sitzungsansicht, die man jetzt überspringt. Über der
Tagesordnungsspalte steht deshalb der Sitzungstitel als Rücksprung (`sitzungTitel`-Prop,
schließt das Dokument-Modal und legt die Sitzung darunter frei).

**Nachbesserung am selben Tag:** Beim Schließen des Lesers lag darunter wieder die alte
Sitzungsliste – also genau das, was gerade übersprungen werden sollte. Das X schließt deshalb jetzt
die gesamte Sitzungsansicht (`onCloseAll`, von `TerminDetailModal` durchgereicht); es bedeutet
„fertig mit der Sitzung", nicht „eine Ebene zurück". Der Rücksprung auf die Sitzungsebene bleibt
dem Sitzungstitel über der Tagesordnung vorbehalten (`onZurueck`). Auf der eigenen Seite
`/termin/:kind/:id` bleibt `onCloseAll` leer – dort gibt es nichts zu schließen.

### Die Sitzungsansicht ist der Leser (2026-10-15)

Nutzerwunsch, nachdem der direkte Einstieg in den Leser stand: „also ganz aus dem Code raus, ich
möchte einen Umbau an der Stelle." Gemeint war die alte Listenansicht der Sitzung, die nach dem
Schließen des Lesers wieder frei lag – ein zweites Modal hinter dem ersten, das man gerade
übersprungen hatte. Ein Fallback, der das nur versteckt, wäre die falsche Antwort gewesen.

**Eine Sitzung mit Tagesordnung hat jetzt genau eine Ansicht.** `TerminDetailPanel` rendert bei
`imLeser` (Sitzung + echte Tagesordnung + geöffnetes Dokument) nichts als den Leser – kein eigenes
Overlay, keine Kopfzeile, nichts dahinter.

**Die Sitzung selbst wurde dadurch zum ersten Punkt ihrer eigenen Tagesordnung.** Kopfdaten,
verknüpfte Aufgaben und Anträge, Notizen und Dateien stehen im Leser über der Tagesordnungsspalte
zur Auswahl (`uebersicht`/`uebersichtTitel` an `DokumentDetailModal`). Im Übersichts-Modus zeigt
der Kopf den Sitzungstitel statt des Dokumenttitels, blendet Tags, Metadaten und alle
Dokument-Aktionen aus und behält nur das Schließen-X; die Spalten werden zu Navigation + Sitzung,
die Notizspalte des Dokuments entfällt (die Sitzung bringt ihre eigenen mit). Damit ist der
Rücksprung kein „eine Ebene zurück" mehr, sondern ein Navigationsziel wie jeder TOP.

**Das Modal-Chrome ist von `TerminDetailModal` nach `TerminDetailPanel` gewandert**
(`layout="modal"`). Nur die Komponente weiß, ob sie überhaupt eines braucht – der Wrapper hätte es
blind gerendert. `TerminDetailModal` ist damit auf einen Einstiegspunkt für seine drei Aufrufer
(Dashboard-Kalender, Archiv, Anträge) geschrumpft, die unverändert bleiben. Die verschachtelten
Modals liegen bewusst **innerhalb** der Karte, sonst schlügen Klicks darin bis zum schließenden
Hintergrund durch.

Zwei Rückfälle bleiben bewusst erhalten: Termine und Sitzungen ohne Tagesordnung zeigen weiterhin
die Liste, ebenso eine Tagesordnung ganz ohne Drucksache – dann gibt es kein Dokument, mit dem der
Leser aufmachen könnte. Und auf der eigenen Seite `/termin/:kind/:id` springt nichts automatisch
auf, sonst läge dort sofort ein Overlay über der gerade aufgerufenen Seite.

Im Harness gegen die echte Tagesordnung geprüft: Einstieg auf Ö 3.1, Klick auf den Sitzungseintrag
wechselt Kopf und Inhalt auf die Sitzung, Klick zurück auf einen TOP bringt Dokument, Tags,
Aktionen und Notizspalte wieder. Der Listen-Rückfall ist nur über `tsc`/`vite build` abgesichert –
ohne Login lässt er sich nicht im Browser aufrufen.

**Nachbesserung:** Die erste Fassung schaltete den Leser nur bei **echter** Tagesordnung ein – und
die hat bislang genau eine Sitzung. Überall sonst erschien weiterhin die alte Liste, die eigentlich
verschwinden sollte. Die Bedingung lautet jetzt: irgendein verknüpftes Dokument genügt. Ohne
TOP-Nummern startet der Leser in der Übersicht statt auf einem willkürlichen „ersten" Dokument, und
die Navigationsspalte heißt dort „Verknüpfte Dokumente" statt „Tagesordnung". Dazu ein
Ladezustand: Bis die Verknüpfungen da sind, rendert das Modal nichts – vorher blitzte die Liste
kurz auf, bevor der Leser sich darüberlegte. Die Liste bleibt nur noch, wo es nichts zu lesen gibt:
eigene Termine und Sitzungen ganz ohne Dokument.

### Nichtöffentliche Gremien raus aus dem Kalender (2026-10-16)

Beim Prüfen, welchen vergangenen Sitzungen noch eine Tagesordnung fehlt, blieb eine Gruppe übrig,
die partout keine bekam: Kleine Kommission Finanzen/Sport/Schulwesen/Friedhöfe, Verwaltungsrat
Märkischer Stadtbetrieb, Aufsichtsrat der Stadtwerke / der Gesellschaft für Wirtschaftsförderung /
der Schillerplatz GmbH. Nutzerentscheidung: Die tagen nichtöffentlich und gehören gar nicht erst
ins Cockpit – ALLRIS führt sie im Sitzungskalender, veröffentlicht dazu aber weder Tagesordnung
noch Vorlagen, es blieben dauerhaft leere Termine.

`NICHT_OEFFENTLICHE_GREMIEN` in `scripts/import-ics.mjs` filtert sie beim Import heraus, am
**Wortanfang** des Gremiennamens: „Aufsichtsrat der Stadtwerke" fliegt raus, ein Ausschuss mit dem
Wort mitten im Titel nicht. Reine Terminkalender-Quellen (`art='termin'`) tragen gar kein `gremium`
und bleiben unberührt.

Zwei Stellen, nicht eine: Die Absage-Erkennung („UID fehlt im Feed = vermutlich abgesagt") fragt
den Bestand separat ab. Ohne dieselbe Filterung dort hätte der nächste Lauf alle noch vorhandenen
Altzeilen als abgesagt markiert, weil sie in `rows` nicht mehr vorkommen.

`0047_nichtoeffentliche_gremien_entfernen.sql` räumt den Altbestand: **20 Sitzungen gelöscht, keine
behalten**. Die Migration löscht bewusst nichts, woran etwas hängt – Sitzungen mit Notizen,
Aufgaben, Anträgen oder Dokumenten wären stehen geblieben und namentlich gemeldet worden. Nötig
ist das, weil die Fremdschlüssel von `summaries`/`todos`/`antraege`/`documents` auf `sessions` ohne
`ON DELETE` angelegt sind: ein Löschen wäre hart gescheitert statt still mitzunehmen.

**Sofort korrigiert:** „die sollen auch nicht ins Mandatscockpit" hieß nicht, dass die Termine
verschwinden sollen, sondern dass zu ihnen kein Inhalt kommt – als Kalendereintrag sind sie
weiterhin gewünscht. Ich hatte das als Löschauftrag gelesen und 20 Sitzungen entfernt. Der
Import-Filter ist wieder draußen (`scripts/import-ics.mjs` steht wieder exakt auf dem Stand davor),
`0048_nichtoeffentliche_gremien_zurueck.sql` hat die 7 Sitzungen aus Juni/Juli 2026
wiederhergestellt, die außerhalb des rollierenden ALLRIS-Fensters liegen und deshalb nicht von
allein zurückkommen – mit unveränderter `ics_uid`, also ohne Dublettenrisiko. Die übrigen 13 ab
dem 31.08.2026 holt der nächste ICS-Import zurück. Möglich war das nur, weil 0047 nichts gelöscht
hat, woran etwas hing, und weil die Bestandsdaten unmittelbar vor dem Löschen noch vorlagen.

Die Entscheidung in einem Satz: **Termin ja, Inhalt nein.** Für dailyallris heißt das, Kleine
Kommissionen, Verwaltungs- und Aufsichtsräte beim Tagesordnungs-Import zu überspringen.

### Supabase-Linter: Suchpfad der SECURITY-DEFINER-Funktionen (2026-10-17)

Mit dem Supabase-MCP-Connector kam erstmals `get_advisors` ins Spiel – ein Linter über Sicherheit
und Performance des Projekts. Das wichtigste Ergebnis ist ein Negativbefund: **kein ERROR, und kein
einziger Treffer zu fehlendem RLS oder fehlenden Policies.** Bei einem Projekt, in dem RLS die
einzige Zugriffskontrolle ist, ist genau das der Test, auf den es ankommt.

Behoben wurde der klarste Befund (`0049_search_path_fixieren.sql`): Zehn der elf
SECURITY-DEFINER-Funktionen in `public` hatten keinen festen `search_path`. Sie laufen mit den
Rechten ihres Eigentümers, lösten ihre Tabellen aber über den Suchpfad des Aufrufers auf – und es
sind genau die Funktionen, an denen die RLS hängt (`current_user_partei`,
`dokument_ist_geteilt_mit`, …).

`public, pg_temp` statt nur `public`, weil `pg_temp` sonst implizit **zuerst** durchsucht wird und
eine temporäre Tabelle gleichen Namens die echte verdecken könnte; explizit ans Ende gestellt ist
das ausgeschlossen. `current_user_fraktion()` ist mitgenommen, obwohl der Linter sie nicht meldete:
Sie trug bereits `search_path=public`, aber ohne `pg_temp`.

Die Funktionskörper blieben unangetastet – vorher über `pg_proc.prosrc` geprüft, dass sie
ausschließlich `public`-Tabellen anfassen und das auth-Schema bereits qualifiziert ansprechen
(`auth.uid()`), was vom Suchpfad unabhängig ist. Ein `do`-Block am Ende der Migration bricht ab,
falls eine SECURITY-DEFINER-Funktion ohne Suchpfad übrig bleibt; damit fällt auch jede künftig
hinzugefügte auf. Nach dem Anwenden ist `function_search_path_mutable` aus den Befunden
verschwunden.

Die übrigen Befunde sind in `docs/UEBERGABE-CLOUD.md` festgehalten, mit Begründung, warum der
naheliegende Fix beim größten davon (`revoke execute` auf die RPC-erreichbaren Helfer) **falsch**
wäre: Policy-Ausdrücke laufen mit den Rechten der aufrufenden Rolle – ohne EXECUTE schlüge jede
Abfrage fehl.

### Umgebung ohne Meldungen: Lint, Sicherheitsupdates, Tailwind 4 (2026-10-17)

Beim ersten Start in einer Cloud-Sitzung kamen Dev-Server und Build zwar durch, aber mit einer Reihe
von Meldungen. Nutzerwunsch: alle beheben, keine Meldungen mehr.

- **`npm run lint` lief gar nicht**: Das Skript stand in `package.json`, aber ESLint war keine
  Abhängigkeit und es gab keine Konfiguration. Jetzt `eslint.config.js` nach dem Vite-Template
  (typescript-eslint, react-hooks, react-refresh), Edge Functions und Node-Skripte ausgenommen.
  Behoben, was die Regeln fanden: `Date.now()` im Render (Antrags-Überfälligkeit, jetzt einmal beim
  Mounten festgehalten), fehlende Effekt-Abhängigkeiten in `DokumentDetailModal.tsx`, und die
  Datei-Helfer `fileNameFromPath`/`fileExtension`/`IMAGE_EXTENSIONS` liegen jetzt in
  `src/lib/dateien.ts` statt in der Modal-Komponente (Fast Refresh kann nur Dateien hot-reloaden,
  die ausschließlich Komponenten exportieren). **Abgeschaltet** ist `react-hooks/set-state-in-effect`:
  Die Regel meldet 24-mal das im ganzen Projekt verwendete Lade-Muster `useEffect(() => { loadX() })`,
  weil loadX vor dem ersten `await` den Ladezustand setzt – beabsichtigt, und ein Umbau auf
  Suspense/Data-Router wäre ein eigenes Vorhaben.
- **16 Sicherheitswarnungen von `npm audit` → 0.** Fünf gingen mit `npm audit fix`, der Rest nur über
  Major-Upgrades: **Vite 5 → 8**, **React Router 6 → 7**, **Tailwind 3 → 4**. Die React-Router-
  Warnungen zu den v7-Future-Flags sind damit ebenfalls weg. Die Lücken betrafen überwiegend den
  Dev-Server bzw. Build-Werkzeuge, React Router aber den ausgelieferten Code (Open Redirect über
  Backslash in `<Link>`/`useNavigate`).
- **Tailwind 4** per offiziellem Upgrade-Werkzeug migriert (24 Dateien, rein mechanische
  Klassen-Umbenennungen). Danach von Hand: ein Kompatibilitätsblock für drei geänderte v3-Standards
  (Rahmenfarbe, Placeholder-Farbe, Button-Cursor) und ein verrutschter Kommentar. Verglichen per
  Screenshot der öffentlichen Seiten vorher/nachher: pixelgleich bis auf Kantenglättung. Die Seiten
  hinter dem Login ließen sich nicht im Browser prüfen (Passworteingabe tabu).
- **Bundle unter 500 kB**: Die geschützten Seiten werden per `React.lazy` nachgeladen; der
  Einstiegs-Chunk schrumpft von 806 auf 401 kB, die Login-Seite lädt weder Markdown-Renderer noch
  Drag & Drop.
- **Favicon** (`public/favicon.svg`) – vorher fragte jeder Seitenaufruf `/favicon.ico` an und bekam 404.
- **`autocomplete`** an Login (`username`/`current-password`), Kontaktformular (`email`) und
  Benutzerverwaltung (`off` für die E-Mail des anzulegenden Kontos, damit der Passwortmanager nicht
  die eigene einträgt).
- **Deploy-Workflow auf Node 22** (vorher 20): Vite 8 verlangt mindestens 20.19, und Node 20 ist
  seit April 2026 ohne Support. Der ICS-Import lief schon auf 22.

### Migrationen aus der Cloud-Sitzung: über den Supabase-Connector (2026-10-17)

Die Übergabe-Doku sah vor, `SUPABASE_ACCESS_TOKEN` und `SUPABASE_DB_PASSWORD` in die Cloud-Umgebung
zu legen, damit `supabase db push` dort läuft. Getestet: Das geht nicht, mit keinem Zugang. Der
Container darf nach außen nur HTTPS; die Postgres-Ports 5432/6543 des Poolers sind direkt gesperrt,
und durch den Proxy der Umgebung kommt Postgres auch nicht, weil der Proxy den Tunnel als HTTPS
aufbricht (Postgres verhandelt TLS innerhalb seines eigenen Protokolls – Verbindung wird
zurückgesetzt). Freigegebene Domains ändern daran nichts.

Entscheidung (Nutzer): Migrationen aus der Cloud laufen über den Supabase-Connector, der über HTTPS
geht und am Konto hängt – damit auch aus Sitzungen, die am Handy oder iPad gestartet werden.
DB-Zugangsdaten kommen nicht in die Umgebung. Verfahren: committete Datei per `execute_sql` in einem
`begin … commit` ausführen und im selben Aufruf unter ihrer Nummer in
`supabase_migrations.schema_migrations` eintragen. Bewusst **nicht** `apply_migration`: das trägt
einen Zeitstempel statt der Dateinummer ein, die bisher lückenlose Historie (`0001`–`0049`, exakt
die Dateinamen) käme aus dem Takt, und der nächste `supabase db push` vom Mac bräche ab. So bleiben
Mac und Cloud austauschbar. Festgehalten in `docs/UEBERGABE-CLOUD.md`, CLAUDE.md und im Skill
`supabase-migration`.

### RLS-Umbau: Helfer nach `private`, `auth.uid()` einmal pro Abfrage, nur `authenticated` (2026-10-17)

Die vier offenen Datenbank-Befunde des Linters, auf Nutzerwunsch in einem Rutsch inklusive des
größeren Umbaus (Helfer in ein eigenes Schema). Zwei Migrationen, beide über den Supabase-Connector
eingespielt.

**`0050_rls_helfer_privat.sql`** fasst drei Befunde zusammen, weil alle dieselben 84 Policies anfassen:

- **Helfer per REST erreichbar.** Vorher von außen geprüft: `POST /rest/v1/rpc/current_user_partei`
  mit dem öffentlichen anon-Key → HTTP 200. Die elf SECURITY-DEFINER-Funktionen liegen jetzt im
  Schema `private`, das PostgREST nicht ausliefert (danach 404). `alter function ... set schema`
  genügt, weil Policies und Trigger Funktionen über ihre OID speichern; die Funktionskörper
  sprechen ihre Tabellen bereits qualifiziert an und rufen sich nicht gegenseitig auf (geprüft über
  `pg_proc.prosrc`). Kein RPC-Aufruf aus App, Edge Functions oder Skripten, kein pg_graphql – also
  niemand, der die Funktionen per REST gebraucht hätte. `authenticated` behält EXECUTE (Policies
  laufen mit den Rechten des Aufrufers), `anon` nicht mehr.
- **`auth.uid()` pro Zeile** in 79 Policies → `(select auth.uid())`; ebenso die drei Helfer ohne
  Argumente. Ausnahme `ebene = ANY (current_user_ebenen())`: Mit `(select ...)` liest Postgres
  ANY als Vergleich gegen eine Ergebnismenge (`text = text[]`) – gefunden von der Generalprobe.
- **71 Policies ohne Rollenangabe** → `to authenticated`. Ein echtes latentes Leck darunter:
  `summaries_select_shared` prüfte nur `sichtbarkeit = 'geteilt'` und galt auch für anon. Zum
  Zeitpunkt 0 betroffene Einträge, nichts abgeflossen.

Die Policy-Texte sind aus `pg_policies` erzeugt, nicht von Hand geschrieben. Absicherung in drei
Schichten:

1. **Sichtbarkeits-Momentaufnahme**: pro Konto (6) und anon die über RLS sichtbaren Zeilen in jeder
   der 29 Tabellen (inkl. `storage.objects`), als Fingerabdruck. Eine `pg_temp`-Funktion schaltet
   per `set_config('role', 'authenticated', true)` und `request.jwt.claims` auf jeden Nutzer um.
   Plausibilisiert: die Konten sehen unterschiedlich viel (1.182 bis 5.594 Zeilen), anon 0.
2. **Policy-Text-Vergleich**: nach dem Umbau die drei Ersetzungen zurückgerechnet → derselbe
   Fingerabdruck wie vorher. Beweist, dass sich außer den beabsichtigten Ersetzungen kein Zeichen
   geändert hat.
3. **Generalprobe**: Messung vorher, Migration, Messung nachher in *einem* `execute_sql`-Aufruf, der
   absichtlich mit `raise exception` endet. Ein Aufruf ist eine Transaktion (vorher mit einer
   Probetabelle geprüft), der Abbruch rollt alles zurück und transportiert das Ergebnis in der
   Fehlermeldung. Die Generalprobe liest ihren eigenen Text über `current_query()` mit und meldet
   die Prüfsumme des Migrationsteils – so ist belegt, dass exakt die Datei im Repo geprobt wurde.
   Beim echten Einspielen bricht derselbe Prüfsummenvergleich vor dem `commit` ab, falls der Text
   abweicht.

Erster Anlauf der Generalprobe scheiterte am `ANY`-Fall oben; der zweite: 0 Abweichungen,
Fingerabdrücke vorher = nachher (`7be402df…` Sichtbarkeit, `b680f489…` Policy-Texte). Nach dem echten
Einspielen dieselben Werte. MCP-Server (Service-Role) danach geprüft, funktioniert.

Ein Sicherheitsnetz am Ende von 0050 bricht künftig ab, wenn eine SECURITY-DEFINER-Funktion in
`public` liegt, eine in `public`/`private` keinen Suchpfad hat oder eine Policy `auth.uid()` ohne
`select` enthält.

**`0051_fremdschluessel_indizes.sql`**: 34 Indizes für Fremdschlüssel ohne passenden Index, aus
`pg_constraint` erzeugt. `create index if not exists` prüft nur den Namen; ein Sicherheitsnetz zählt
deshalb am Ende nach, ob noch ein Fremdschlüssel ohne Index übrig ist.

Linter danach: Security nur noch Leaked-Password-Protection (Dashboard-Schalter, nicht per Migration).
Performance nur noch „unused index" für die gerade angelegten Indizes und „multiple permissive
policies" (bewusst so gelassen, siehe `docs/UEBERGABE-CLOUD.md`).

Nebenbei: `supabase/functions/share-todo/` hatte als einzige Function kein eigenes `deno.json`, `deno
check` schlug dort fehl (CLAUDE.md-Fallstrick zur Modulauflösung). Nachgezogen; alle vier Functions
prüfen sauber.

### Leaked-Password-Protection bleibt aus (2026-10-17)

Der letzte offene Befund des Sicherheits-Linters (`auth_leaked_password_protection`) lässt sich im
Free-Tier nicht beheben: Der Abgleich gegen HaveIBeenPwned ist eine Pro-Plan-Funktion, der Schalter
ließ sich im Dashboard nicht speichern. Bewusst so belassen und in `docs/UEBERGABE-CLOUD.md` als
erledigt-mit-Begründung vermerkt, damit künftige Sitzungen den WARN nicht erneut verfolgen.

### Tagesordnungs-PDFs: bereits aufgeräumt; Entscheidung Fraktionsbüro (2026-10-17)

**Tagesordnungs-PDFs.** Laut Übergabe lagen noch 33 im Dokumenten-Hub. Geprüft: Es sind keine mehr
da – vermutlich hat dailyallris sie nach dem Einlesen der strukturierten Tagesordnungen selbst
entfernt (das stand dort als Aufgabe). Der Hub enthält 1.141 Drucksachen und 2 eigene
Ausarbeitungen, die 1.141 Dateien im Bucket `dokumente` sind alle einem Dokument zugeordnet, nichts
verwaist. Eine erste Titelsuche nach „Tagesordnung" hatte 19 Treffer geliefert – das waren durchweg
Drucksachen („Antrag zur Tagesordnung des Sportausschusses …"), also echte Anträge. Gelöscht wurde
nichts.

**Fraktionsbüro (offene Design-Entscheidung aus KONZEPT.md Abschnitt 11, jetzt entschieden).**
Das Fraktionsbüro darf selbst angelegte Termine jederzeit nachträglich ändern und löschen, auch wenn
das Mitglied sie inzwischen bearbeitet hat. Offen bleibt, was dann mit den Daten des Mitglieds
passiert, die am Termin hängen (Notizen, Dateien, Verknüpfungen) – das soll in die anstehende
Grundsatzüberlegung zu Zusammenfassungen, Notizen, eigenen Dokumenten und ToDos einfließen,
zusammen mit einer grundsätzlichen Neubetrachtung der Kalender-Einbindung. Die Rolle wird erst danach
gebaut.

### MCP: `get_document`, `seit`-Filter – und die 1.000-Zeilen-Grenze (2026-10-17)

**Anlass (Nutzerwunsch):** Das Politikbüro sah über den MCP-Server von den Drucksachen nur Titel,
Tags und Sitzungen, nicht den Text – `list_documents` gibt ihn nicht aus, ein Lese-Tool fehlte.
Dazu sollte der tägliche ALLRIS-Scan nur neue Drucksachen holen können.

- **`get_document(dokument_id, ab_zeichen?, max_zeichen?)`** liefert ein Dokument mit seinem
  Markdown-Text und Kopfdaten (Sichtbarkeit, Ersteller*in, Tags, Sitzungen mit TOP, Archivstatus,
  Datei, Zahl der sichtbaren Notizen). Sichtbarkeit wie `list_documents` über `darfSehen()`, weil
  der MCP-Server RLS umgeht; ein unsichtbares Dokument meldet sich wie ein nicht vorhandenes, damit
  das Tool keine Ids bestätigt. Lange Texte (bis über 30.000 Zeichen) kommen in Abschnitten von
  höchstens 20.000 Zeichen – dieselbe Vorsicht wie bei `update_document_inhalt`, sehr große
  MCP-Nachrichten werden unzuverlässig. Auch `id` statt `dokument_id` wird angenommen.
- **`list_documents(seit)`**: nur Dokumente ab einem Upload-Zeitpunkt, als DB-Filter vor dem Limit.
  Ein reines Datum gilt ab Mitternacht **deutscher** Zeit (Versatz je Tag aus `Intl`, an beiden
  Umstellungstagen getestet) – in UTC fehlten einem Tages-Scan sonst die Uploads zwischen 0 und
  2 Uhr. Für einen Scan `archiv="alle"`: eine neue Drucksache zu einer schon vergangenen Sitzung
  gilt sonst als archiviert.

**Dabei gefunden: `list_documents` war unvollständig.** PostgREST liefert pro Abfrage höchstens
1.000 Zeilen (Supabase-Voreinstellung) und schneidet ohne Fehlermeldung ab. Die Abfrage der
geteilten Dokumente lief unsortiert über alle 1.141 Drucksachen – es fehlten zufällige 141, und
geprüft fehlten tatsächlich die neuesten (DB: DS10/3729 um 14:13 Uhr als neuestes, das Tool lieferte
Dokumente von früher am Tag). Für einen Scan nach Neuem wäre das der schlimmste Fall gewesen.
Dasselbe in `ladeSitzungen()`: 1.344 Sitzungsverknüpfungen, also konnte auch der Archivstatus
einzelner Dokumente falsch sein. Behoben mit `alleZeilen()` (seitenweise, stabil sortiert nach
`erstellt_am, id`, gibt Fehler zurück statt zu werfen – `index.ts` fängt keine Exceptions, das wäre
HTTP 500) und `inStuecken()` für lange `.in()`-Listen. Ladefehler brechen jetzt mit einer Meldung ab,
statt eine unvollständige Liste als vollständig auszugeben. Gibt es mehr Treffer als `limit`, nennt
die letzte Zeile die Gesamtzahl.

Außerdem lädt `list_documents` den Text nicht mehr mit: Er wurde nie angezeigt, waren aber rund
10 MB je Aufruf.

Geprüft: `deno check`; `seitAlsIso` mit 8 Fällen (Sommer-/Winterzeit, beide Umstellungstage, volle
Zeitstempel, ungültige Eingaben); `alleZeilen` mit 0/5/999/1.000/1.001/2.500 simulierten Zeilen und
einem Fehler auf Seite 2.

**Offen, nicht Teil dieser Änderung:** Die Web-UI hat dieselbe Grenze – `Dokumente.tsx` und
`Archiv.tsx` laden den Hub in einer Abfrage und zeigen nur die neuesten 1.000 Dokumente.

### Web-UI: Dokumenten-Hub und Archiv ohne 1.000-Zeilen-Lücke (2026-10-17)

Dieselbe Grenze wie im MCP-Server (Eintrag davor), hier mit sichtbaren Folgen für alle Mitglieder:

- **Dokumente-Reiter und Archiv** luden den Hub in einer Abfrage, neueste zuerst – die ältesten rund
  140 der 1.139 sichtbaren Drucksachen fehlten in Liste und Suche, im Archiv also gerade das, was
  dorthin gehört.
- **`ladeSitzungenJeDokument()`** (`src/lib/dokumenteArchiv.ts`) bekam von 2.324 Verknüpfungen nur
  1.000. Für die übrigen Dokumente war keine Sitzung bekannt – sie galten damit als **nicht
  archiviert** und standen in der Arbeitsliste, und der Filter „Meine Gremien" griff bei ihnen nicht.
  Dazu stand die ganze Id-Liste (1.139 UUIDs, rund 42 KB) in einer einzigen URL.
- Vorsorglich mit umgestellt: die vergangenen Sitzungen im Archiv (552, wachsen täglich, allein die
  Fraktions-Terminquelle bringt über 400) und die Notizen für die Fett-Markierung ungelesener
  Dokumente (249, wachsen mit den automatisch angelegten Notizen).

Lösung wie im MCP-Server: `src/lib/alleZeilen.ts` mit `alleZeilen()` (seitenweise, stabil sortiert)
und `inStuecken()` (lange `.in()`-Listen aufteilen) – bewusst doppelt zur Deno-Fassung, kein
gemeinsames Build-Tooling. Bricht das Laden der Dokumente ab, zeigt der Dokumente-Reiter jetzt
einen eigenen Hinweis, statt eine halbe Liste wie eine vollständige aussehen zu lassen.

Geprüft mit einem nachgebauten Supabase-Client mit echter 1.000-Zeilen-Grenze und echten
Größenordnungen (1.139 Dokumente, 552 Sitzungen, 2.324 Verknüpfungen): neue Fassung 2.324/2.324
Verknüpfungen, größte `in()`-Liste 150 Ids; die alte Fassung aus `main` im selben Test 1.000/2.324.
Lint und Build ohne Meldungen. Die Seiten selbst sind hinter dem Login und nicht im Browser geprüft.

Unverändert: Der Dokumente-Reiter lädt weiterhin den vollen Text aller Drucksachen (rund 10 MB),
weil Suche und Vorschau ihn brauchen.

### Keine Datei-Uploads mehr für Nutzer (2026-10-17)

**Entscheidung (Nutzer):** Nutzer laden keine Dateien mehr hoch, Notizen sind Text. Dateien bringt
nur noch das technische Konto (ALLRIS-Import) in den Hub, ohne Größengrenze. Ausnahme Profilbilder,
höchstens 2 MB. Eine Speicher-Quota pro Nutzer war im Gespräch, ist damit aber überflüssig – bei
15+ Nutzern wäre jede brauchbare Quota ohnehin zu klein für eigene Dokumente gewesen.

**`0052_uploads_sperren.sql`:** neuer Helfer `private.ist_technisch()`; `dokumente_storage_insert_own`
verlangt das technische Konto; `zusammenfassungen_insert_own` steht auf `with check (false)`;
Bucket `profilbilder` mit 2 MB und Bildformaten. Generalprobe als Funktionstest in einer
zurückgerollten Transaktion: als normales Konto in `dokumente` und `zusammenfassungen` gesperrt
(42501), als ALLRIS-Konto in `dokumente` erlaubt, Profilbild erlaubt.

Dabei gelernt: Die Policy zuerst per `DROP POLICY` zu entfernen, hing über den Supabase-Connector
jedes Mal 60 s und lief dann in einen Timeout – auch mit `lock_timeout` und `statement_timeout`.
Gewartet hat also nicht die Datenbank, sondern der Connector auf eine Bestätigung für eine
destruktive Anweisung, die in der Cloud-Sitzung nicht ankommt. `alter policy ... with check (false)`
ist gleichwertig und lief sofort.

**Oberfläche:** Datei-Felder entfernt an Sitzungs-Notizen, neuen Hub-Dokumenten, Notizen an
Dokumenten, ToDos und Anträgen. Die Datei-Listen an ToDos und Anträgen erscheinen nur noch, wenn es
Altbestand gibt. Nebenbei behoben: Das Löschen einer Datei-Notiz an ToDo oder Antrag entfernte nur
den Datenbankeintrag, die Datei blieb im Bucket liegen – so sind die 8 Dateien ohne Verweis
entstanden. Profilbild: Größe und Format werden vor dem Hochladen geprüft und auf Deutsch gemeldet.

**MCP-Server:** `uploadBase64File()` und `start_file_upload` weisen andere Konten als das technische ab
(`darfDateienHochladen()`), die Tool-Beschreibungen sagen das.

**Aufräumen der Dateien** über einen neuen, nur von Hand startbaren Workflow
(`wartung-dateien.yml`, `scripts/wartung-dateien.mjs`), weil sich Dateien nur über die Storage-API
mit Service-Schlüssel verschieben lassen; den Schlüssel holt der Lauf zur Laufzeit über das
vorhandene `SUPABASE_ACCESS_TOKEN`. Er zieht die 237 Drucksachen-Dateien (16 MB) aus dem Ordner von
Thorsten Kois in den des ALLRIS-Kontos, übernimmt den Text von 4 Markdown-Redebeiträgen in die
ToDo-Notizen, löscht seine 16 Sitzungs-PDFs samt Notiz, löst 2 PDFs von ToDo-Notizen (Text bleibt)
und löscht seine 8 Dateien ohne Verweis. Alles Gelöschte wird vorher als Workflow-Artefakt für
30 Tage gesichert. Die einzige Datei von Benjamin Korte (ohne Verweis) bleibt, bis er bzw. der Nutzer
entscheidet.

### Löschprotokoll (2026-10-17)

**Entscheidung (Nutzer):** Löschungen sollen nachvollziehbar sein; eine Oberfläche dafür braucht es
nicht. Anlass waren zwei Drucksachen, die am selben Tag verschwanden – der Nutzer hatte sie selbst
gelöscht, aber in der Datenbank war das nicht mehr festzustellen.

**`0053_loeschprotokoll.sql`:** Tabelle `private.protokoll` (nicht ausgeliefert, keine Policies,
für `anon`/`authenticated` ohne Rechte) und ein Trigger `protokoll_loeschung` auf 16
Inhaltstabellen. Jede gelöschte Zeile wird mit Zeitpunkt, Konto, Weg, Tabelle, Titel und der
vollständigen Zeile als JSON festgehalten – damit ließe sich ein Eintrag auch wiederherstellen.
Kaskaden erscheinen einzeln. Nicht protokolliert: reine Zustände (gelesen, Board-Platz, Abos),
Tokens, Upload-Zwischenstände.

**Zuordnung:** In der Web-Oberfläche `auth.uid()`. Der MCP-Server arbeitet mit dem
Service-Role-Schlüssel, dort ist `auth.uid()` leer – er legt deshalb nach der Token-Prüfung einen
zweiten Client an, der das Konto als Header `x-mc-user` mitschickt (alle 36 Tool-Aufrufe);
Wartungsskripte schicken `x-mc-quelle`. Die Header wertet die Datenbank **nur bei der Service-Role**
aus – sonst könnte sich ein Nutzer eine fremde Identität geben. Eine kaputte Kennung wird
ignoriert statt die Löschung abzubrechen.

**Generalprobe ohne Löschung:** Ein Test mit echten `DELETE`s hing über den Connector wie zuvor das
`DROP` (destruktive Anweisungen warten auf eine Bestätigung, die nicht ankommt) – auch innerhalb
eines `do`-Blocks. Statt die Erkennung zu umgehen, liegt die Zuordnung in einer eigenen Funktion
`private.protokoll_herkunft()`, die sich ohne Löschung prüfen lässt. Sechs Fälle geprüft: Web;
Web mit gefälschtem `x-mc-user` eines anderen Mitglieds (bleibt beim echten Konto); MCP; Wartung;
kaputter Header; nicht angemeldet. Alle 16 Trigger angelegt. Der Trigger selbst wird mit dem
ersten echten Wartungslauf bestätigt.

### Nächtliches Backup (2026-10-17)

**Entscheidung (Nutzer):** Backup ja, aber ohne eigenes Repository „Mandatscockpit backup". Ein
Dump enthält personenbezogene Daten, und was einmal in einer Git-Historie liegt, bekommt man dort
nicht mehr heraus.

**`.github/workflows/backup.yml`:** jede Nacht 01:17 UTC (und von Hand) drei Dumps über die
Supabase-CLI – Rollen, Schema, Daten –, verschlüsselt mit `gpg --symmetric` (AES256) und als
Workflow-Artefakt 14 Tage aufbewahrt. Nur die Datenbank: Seit der Upload-Sperre stehen
Nutzerinhalte als Text darin, die Drucksachen-PDFs lassen sich aus ALLRIS neu holen. Ein Teil-Dump
ohne die Kerntabellen (`dokumente`, `todos`, `sessions`, `profiles`) bricht den Lauf ab, statt ein
scheinbar gutes Artefakt zu hinterlassen.

**Braucht zwei neue Repository-Secrets:** `SUPABASE_DB_PASSWORD` und `BACKUP_PASSWORT` (frei
gewählt, getrennt aufbewahren – ohne es ist das Backup wertlos). Fehlen sie, scheitert der Lauf
mit einem klaren Hinweis. Wiederherstellen: siehe Kopf der Workflow-Datei.

### Speicheranzeige für Admins (2026-10-17)

**Entscheidung (Nutzer):** statt einer Quota pro Nutzer eine Anzeige der Belegung. Neuer
Einstellungs-Reiter „Speicher" (nur Admins, `SpeicherBelegung.tsx`): Dateien gegen 1 GB,
Datenbank gegen 500 MB, darunter je Bucket die Belegung pro Person.

**`0054_speicherbelegung.sql`:** `public.speicherbelegung()` fasst `storage.objects` je Bucket und
Ordner (= Konto) zusammen und liefert `pg_database_size`. Sie liegt in `public`, weil der
Service-Role-Client sie nur so per `rpc` erreicht, ist aber für `anon`/`authenticated` gesperrt –
die Belegung je Person verrät, wer was hochgeladen hat. Aufgerufen über die neue Aktion
`speicher` der Edge Function `admin-users`, die vorher die Admin-Rolle prüft.

**Nebenbei behoben:** `admin-users` (`list`) gab `technisch` nicht zurück. Das Bearbeiten-Formular
zeigte die Checkbox deshalb immer leer, und ein Speichern hätte dem ALLRIS-Konto still die
Markierung genommen – seit 0052 hängt daran das Recht, Drucksachen abzulegen.

**Stand nach dem Wartungslauf** (17.10.): 1.139 Drucksachen-Dateien (87 MB) beim ALLRIS-Konto, zwei
Profilbilder, eine Datei von Benjamin Korte; Datenbank 29 MB.

### Ein Notiz-System: nur an ToDos und Dokumenten (2026-10-17)

**Entscheidung (Nutzer):** Notizen gibt es nur noch an ToDo-Karten und an Dokumenten im Hub.
Kommentare entfallen, bestehende ToDo-Kommentare werden zu Notizen. Sitzungen und Termine haben
weder Notizen noch Kommentare; die Sitzungsansicht zeigt Notizen nur indirekt über verknüpfte
Karten und Dokumente. Bestehende Sitzungs-/Termin-Notizen werden gesichert und gelöscht, fremde
vorher vorgelegt.

**`0055_notizen_nur_todo.sql`** sperrt nur die alten Wege: `summaries_manage_own` verlangt beim
Schreiben eine Karte (`todo_id`), keine anderen Bezüge, keine Datei und eine für den Aufrufer
sichtbare Karte (Unterabfrage auf `todos` mit seinen Rechten – eigene oder platzierte). Erledigte
eigene Karten haben oft keine Platzierung mehr, deshalb reicht die Platzierung allein nicht.
`summaries_select_shared` (aus 0001, gab „geteilte" Notizen an *alle* Angemeldeten frei; keine
Zeile betroffen) liefert nichts mehr. Kommentar-Inserts sind gesperrt. Generalprobe als Thorsten
Kois: Notiz an eigener Karte ok; an fremder Karte, an einer Sitzung und als Kommentar 42501.
DROP der leeren Kommentar-Tabellen kommt mit dem nächsten `db push` vom Mac (über den Connector
hängen destruktive Anweisungen).

**Altdaten** räumt `scripts/wartung-notizen.mjs` ab (Workflow `wartung-dateien.yml`, jetzt mit
Auswahl `skript`): der eine ToDo-Kommentar wird Notiz an derselben Karte, Sitzungs-/Termin-Notizen
von Thorsten Kois werden als Markdown gesichert und gelöscht; die eine Notiz von Fabian Tigges
bleibt, bis sie vorgelegt ist (`auch_von`).

**Oberfläche:** ToDo-Detail mit einer Liste „Notizen" (Autor, Datum, Löschen nur eigener) statt
„Dateien" + „Kommentare". Sitzungsansicht: „Notizen" aus verknüpften Karten und Dokumenten, ein
Klick öffnet die Quelle. Antrags-Detail ohne Notizen/Kommentare; dabei die seit 0052 unerfüllbare
Bedingung entfernt, dass für „Gestellt" ein Dokument hochgeladen sein muss. „Meine Dokumente" ohne
Sitzungs-Notizen, ToDo-Zeilen mit Notizzahl. Kalender und Archiv markieren Sitzungen/Termine mit 📝,
wenn eine verknüpfte Karte Notizen hat (`src/lib/notizFlags.ts`). Archiv ohne die alten
Datei-Uploads.

**MCP-Server:** `create_session_note`, `create_event_note`, `create_antrag_note` entfallen (33 statt
36 Tools); `create_todo_note` nur noch Text; `list_notes` liest mit `session_id`/`event_id` die
Notizen der verknüpften Karten. `finish_file_upload` kennt nur noch `ziel="dokument"`. Neue Tools
erst in einem neuen Chat sichtbar (Tool-Liste ist pro Unterhaltung eingefroren).

**Öffentliches Repository:** Beim Bau fiel auf, dass das Repo öffentlich ist – Protokolle und
Artefakte der Actions-Läufe sind für jeden angemeldeten GitHub-Nutzer lesbar. Das unverschlüsselte
Artefakt `geloeschte-dateien` des Datei-Wartungslaufs musste deshalb gelöscht werden. Wartungsläufe
verschlüsseln ihre Sicherung seither mit `BACKUP_PASSWORT` und brechen ohne das Secret vor jeder
Änderung ab; das Notiz-Skript schreibt nur Längen, keine Inhalte ins Protokoll.

### ToDo-Zuweisung an Personen (2026-10-17)

**Entscheidung (Nutzer):** statt Freitext eine Person; die zugewiesene Person sieht die Karte und
darf sie bearbeiten; zuweisbar sind Kolleg*innen gleicher Partei und Ebene.

**`0056_todo_zuweisung.sql`:** Spalte `todos.zustaendig_user_id` (FK auf `profiles`, `on delete set
null`). Statt einer eigenen Zugriffsregel hängt alles an der vorhandenen Platzierung: wer die Karte
auf dem Board hat, sieht und bearbeitet sie schon, und auf ein fremdes Board kommt sie nur über
`share-todo`, das Partei und Ebene prüft. Der Trigger `pruefe_zustaendigkeit` verlangt deshalb nur,
dass die zuständige Person die Karte angelegt hat oder platziert ist (23514 sonst); das Löschen
einer Platzierung löst die Zuständigkeit mit (`zustaendigkeit_mit_freigabe_loesen`). Generalprobe
als Thorsten Kois: an platzierte Person ok, an nicht platzierte 23514, an sich selbst ok. Der alte
Freitext war in keiner Zeile befüllt (und hatte in der Oberfläche gar kein Eingabefeld mehr).

**Oberfläche:** Abschnitt „Zuständig" im Karten-Detail mit Auswahl; für den Ersteller stehen auch
noch nicht geteilte Kandidat*innen der Karten-Ebene darin („wird dabei geteilt"). Board und Archiv
zeigen den Namen; Karten, die mir jemand anderes zugewiesen hat, sind amber hervorgehoben.
**MCP:** `update_todo(zustaendig)` nimmt einen Namen und weist nur unter Personen zu, die die
Karte schon haben; `list_todos` nennt den Namen.

**Backup, Nachtrag:** Der erste Lauf (9,4 MB Daten, verschlüsselt 2,5 MB) lief durch; pg_dump
warnt wegen der Selbstreferenz `dokumente.parent_id`. Die Wiederherstellungsanleitung im Kopf von
`backup.yml` nennt jetzt `session_replication_role = replica`.

### Neuigkeiten im Cockpit statt Mails (2026-10-17)

**Entscheidung (Nutzer):** vorerst keine Mails; das Cockpit zeigt selbst, was passiert ist.

**Dashboard, oberhalb des Boards** (`NeuigkeitenSection.tsx`, Logik `src/lib/neuigkeiten.ts`):
- *Neu für dich* seit dem letzten „Alles gesehen": Zuweisungen an mich, mit mir geteilte Karten,
  Notizen anderer an meinen Karten (je Karte eine Zeile), neue Tagesordnungspunkte für kommende
  Sitzungen meiner Gremien („Tagesordnung ist da" bzw. „n neue Punkte").
- *Demnächst*, unabhängig vom letzten Besuch: Sitzungen meiner Gremien in den nächsten 7 Tagen
  (mit TOP-Zahl oder „noch keine Tagesordnung"), Aufgaben auf meinem Board, die in 3 Tagen fällig
  oder überfällig sind, Fristen eigener Antragsentwürfe in 7 Tagen. Heute/überfällig amber.
- Ein Klick öffnet Karte, Sitzung oder Antrag. Sind beide Listen leer, bleibt der Abschnitt weg.

**`0057_neuigkeiten.sql`:** `neuigkeiten_stand` (je Nutzer `gesehen_am`, Policy nur für sich) –
bewusst nicht in `profiles`, weil Kolleg*innen das Profil lesen dürfen und der letzte Besuch sie
nichts angeht. `todo_placements.erstellt_am` (seit wann eine Karte auf dem Board liegt; Bestand
bekommt den Migrationszeitpunkt, unschädlich, weil der erste Besuch erst den Ausgangsstand setzt
und davor nichts als neu gilt) und `todos.zustaendig_seit`, gesetzt im Zuständigkeits-Trigger aus
0056. Generalprobe: Zuweisen setzt, Lösen leert `zustaendig_seit`; fremder Stand weder lesbar noch
setzbar (42501). Alle Abfragen des Loaders gegen das Live-Schema geprüft.

Berechnet wird in der Oberfläche statt in einer Datenbankfunktion: die Regeln (Fristen,
Gremienauswahl, „überfällig" ab Tagesende) sind dieselben wie in Board, Kalender und Anträgen,
und alles läuft mit den Rechten des Nutzers.

### Dokumenten-Suche in der Datenbank, Vorschau gespeichert (2026-10-17)

**Anlass (Plan „Code und Leistung"):** `/dokumente` lud bei jedem Aufruf den vollen Text aller
1.141 Drucksachen (5,6 MB Rohtext), nur für zwei Zeilen Vorschau und eine Suche im Browser.

**`0058_dokumente_suche_vorschau.sql`:** Spalte `vorschau` (beim Schreiben berechnet) und die
generierte Spalte `suchtext` (Titel, Tags, Text; klein, Weißraum zusammengezogen – wie die alte
`suchtext()` im Browser) mit Trigramm-Index (`pg_trgm` im Schema `extensions`). Gesucht wird per
`ILIKE '%…%'`, also mit derselben Teilwort-Semantik wie vorher – bewusst nicht mit der
Wortstamm-Volltextsuche, die „Schule" in „Grundschule" nicht fände. Generalprobe: Index wird
genutzt, 1,7 ms; Treffer als Thorsten Kois mit RLS. `array_to_string` ist nur STABLE deklariert,
deshalb steckt der Ausdruck in `private.dokument_suchtext()` (IMMUTABLE).

**Eine Vorschau-Logik für beide Seiten:** `vorlageMarkdown.ts` liegt jetzt unter
`supabase/functions/_shared/` (keine Importe, läuft in Browser und Deno gleich);
`src/lib/vorlageMarkdown.ts` reicht sie nur durch. Der MCP-Server setzt `vorschau` bei
`create_document` und `update_document_inhalt`, die Web-Oberfläche beim Anlegen. Den Bestand füllt
`scripts/wartung-vorschau.mjs` (Workflow `wartung-dateien.yml`, `skript=vorschau`). Die
PR-Prüfung überspringt `_shared` beim `deno check` (keine eigene Function).

**Oberfläche:** Listen laden `DOKUMENT_LISTEN_SPALTEN` (ohne Text), geöffnet wird über
`ladeDokument()`. Die Suche fragt nach 250 ms Tipppause die Datenbank (`sucheDokumente()`); nur der
Name der Autorin/des Autors wird weiter im Browser verglichen. Nirgends mehr `select('*')` auf
`dokumente`: `suchtext` ist eine zweite Kopie des Textes und käme sonst überall mit.

**Nebenbei behoben:** Die Zahl ungelesener Dokumente in der Kopfleiste wurde aus höchstens 1.000
Zeilen berechnet (PostgREST-Grenze) und war dadurch zu niedrig; jetzt seitenweise.

### Tests und erzeugte Typen (2026-10-17)

**Tests:** Vitest (`npm test`), 25 Tests in `src/lib/__tests__/` für die reinen Hilfsfunktionen –
Archiv-Regel (letzte Sitzung zählt, numerischer Zeitvergleich `+00:00` gegen `Z`), Gelesen-Status,
Vorlagen-Aufbereitung (Vorschau bevorzugt den Beschlussvorschlag, keine Absatz-Verklebung,
Formular-Schwelle 6 Leerzeichen), Antragsfristen, Gliederung, `inStuecken`, Dateinamen. Läuft in
der PR-Prüfung mit.

**Typen:** `src/lib/database.types.ts` ist aus der Datenbank erzeugt. Die Typen in `types.ts`
bleiben handgeschrieben, weil die Oberfläche engere Typen braucht als die Datenbank liefert (Ebene
als Auswahl statt `string`) – `src/lib/typenPruefung.ts` vergleicht sie aber beim Build: fehlende
oder erfundene Spalten, fehlendes `null`, zu weite Typen. Beim Einführen fehlten sieben Spalten
(`profiles.created_at`, `calendar_sources.created_at`, `sessions.ics_uid`, `documents.created_at`,
`events.created_at`, `todos.zustaendig_seit`, `todo_placements.erstellt_am`). Der Supabase-Client
bleibt ungetypt: ein `createClient<Database>` hätte jede Abfrage auf `string` statt der engeren
Typen gezogen und einen Umbau aller Komponenten verlangt.

**Datenzugriff bündeln – Stand:** Neue Bereiche haben ihre Abfragen in eigenen Lade-Funktionen
(`dokumentSpalten.ts`, `neuigkeiten.ts`, `notizFlags.ts`). Die bestehenden großen Komponenten
(`TodoDetailModal`, `TerminDetailPanel`, `DokumentDetailModal`, `Settings`) fragen weiter selbst
ab; sie ohne die Möglichkeit eines angemeldeten Rundgangs im Browser umzubauen, wäre ein großer
Umbau ohne Prüfnetz. Sinnvoll schrittweise, wenn eine dieser Komponenten ohnehin angefasst wird.

### Migrationen über GitHub, Kommentare und Sicherungen entfernt (2026-10-17)

**Klarstellung (Nutzer):** Es gibt keinen Mac im Ablauf; gearbeitet wird ausschließlich im Repo
über Claude-Code-Cloud-Sitzungen. Damit fehlte ein Weg für `DROP`/`DELETE`, die über den
Supabase-Connector hängen.

**`.github/workflows/migrationen.yml`:** `supabase db push` vom GitHub-Runner (über den Pooler,
Secret `SUPABASE_DB_PASSWORD` – seit dem Backup vorhanden). Im PR nur Trockenlauf, nach dem Merge
auf `main` wird eingespielt, was in `schema_migrations` noch fehlt. Mit dem Connector-Weg
verträglich, weil beide unter der Dateinummer eintragen; die Historie war vor dem ersten Lauf
deckungsgleich mit den Dateien (`0001`–`0058`).

**`0059_kommentare_und_sicherungen_entfernen.sql`** (erste Migration über den Workflow): löscht die
leeren Tabellen `todo_comments`/`antrag_comments` (bricht ab, falls doch etwas darin steht) und das
Schema `backup` mit der Sicherung der am 17.10. von Hand bereinigten Notizen – laut Nutzer nicht
mehr benötigt. `scripts/wartung-notizen.mjs` entfällt (lief einmal, liest die Kommentar-Tabellen),
ebenso die Typen `TodoComment`/`AntragComment`.

### Feste Board-Spalten, Altlasten entfernt, Actions aktualisiert (2026-10-17)

**Entscheidungen (Nutzer):** Die ToDo-Spalten sind nicht mehr frei konfigurierbar, es gibt nur
noch **Neu, Geplant, Ergebnis erstellt, Fertig**. Die aktive Sitzung wird **manuell** aufgerufen
(keine automatische Auswahl, keine Markierung). **Zusammenfassungen** werden nicht mehr gebraucht.
Die letzte Datei im alten Notiz-Speicher (Benjamin Korte) soll weg. Damit sind die offenen Fragen
aus KONZEPT.md Abschnitt 11 entschieden.

**`0060_feste_spalten_und_altlasten.sql`** (über `migrationen.yml`):
- Je Konto die vier Spalten angelegt bzw. vorhandene in anderer Schreibweise umbenannt; Karten aus
  anderen Spalten umgezogen – „Wartet…" nach Geplant, alles andere nach Neu (betraf eine Karte bei
  Thorsten Kois und zwei bei Benjamin Korte aus dessen eigenen Spalten „Fraktion"/„Kreistag").
  Generalprobe: alle 40 Karten landen in den vier Spalten. Danach die übrigen Spalten gelöscht,
  Constraint `todo_columns_feste_spalten` und eindeutiger Name je Konto; Nutzer dürfen ihre
  Spalten nur noch lesen (`todo_columns_select_own` statt `todo_columns_manage_own`);
  `handle_new_user` legt die vier neuen an.
- `summaries`: Spalten `session_id`, `event_id`, `antrag_id`, `document_id`, `datei_url`,
  `sichtbarkeit` entfernt samt der Policies, die daran hingen; `todo_id` und `inhalt` sind jetzt
  Pflicht, leerer Text ist ausgeschlossen. Alle 79 Notizen erfüllten das bereits.
- `todos.zustaendig` (Freitext, in keiner Zeile befüllt) und `todos.dokument_id` (Verweis auf die
  ungenutzte `documents`-Tabelle) entfernt.
- Storage-Policies des Buckets `zusammenfassungen` entfernt. Datei und Bucket löscht
  `scripts/wartung-speicher.mjs` über die Storage-API – direkte Löschungen in `storage.*` blockiert
  Supabase per Trigger (`protect_objects_delete`/`protect_buckets_delete`).

**Oberfläche/MCP:** Einstellungen zeigen die Spalten nur noch an. `create_todo`/`update_todo`
nehmen für `spalte` nur die vier Namen (`festeSpalte()`), legen keine Spalten mehr an.

**Wartung:** `wartung-dateien.yml` heißt jetzt `wartung.yml` und kennt nur noch `vorschau` und
(einmalig) `speicher`; die erledigten Läufe für Dateien und Notizen sind samt Skripten entfernt.

**Actions:** auf die aktuellen Hauptversionen gehoben (node24 statt des auslaufenden node20):
`checkout@v7`, `setup-node@v7`, `upload-artifact@v7`, `upload-pages-artifact@v5`,
`deploy-pages@v5`, `supabase/setup-cli@v3`. Die Breaking Changes (setup-node: Caching-Vorgaben,
entfallenes `always-auth`) betreffen die Workflows nicht – sie setzen `cache: npm` ausdrücklich.

## 18.10.2026 – Anträge und `documents` entfernt, Konten löschen mit Dokumenten

Nutzerwunsch: „5 löschen, 6 abbauen, 8 prüf ob das im Header übergeben werden kann. Zu 9: wenn
Nutzer gelöscht werden, sollen auch seine Dokumente gelöscht werden. Außer technische Nutzer, die
Dokumente des ALLRIS-Nutzers sind für alle Nutzer relevant."

**`0061_antraege_documents_entfernen.sql`** (über `migrationen.yml`, enthält DROP):
- `antraege`, `antrag_shares`, `antrag_deadline_settings` und die Helfer
  `private.antrag_gehoert_nutzer`/`antrag_ist_geteilt_mit` entfernt. Vorher geprüft: 0 Anträge,
  0 Freigaben, 4 Fristen-Einstellungen (reine Einstellungen, ohne Anträge wertlos). Die Migration
  bricht ab, falls doch noch Anträge da sind.
- `documents` (0001, für einen RIS-Import gedacht, den heute dailyallris in `dokumente` macht)
  entfernt, war leer.
- Trigger `technisches_konto_schuetzen` (`before delete on profiles`): ein Konto mit
  `technisch = true` lässt sich nicht löschen, auch nicht über `auth.users` oder das
  Supabase-Dashboard. Grund: `dokumente.user_id` ist `on delete cascade`, mit dem ALLRIS-Konto
  verschwänden alle 1.141 Drucksachen für alle Mitglieder.

**Oberfläche:** „Meine Dokumente" heißt jetzt „Meine Notizen" (`NotizenSection.tsx`, nur noch
ToDo-Karten mit Notizen). Entfallen: `AntraegeSection`, `AntragDetailModal`, Archiv-Reiter
„Anträge", „Verknüpfte Anträge" in der Sitzung, Antragsfristen in „Demnächst", Einstellungsseite
„Antrags-Fristen", `antragStatus.ts`/`antragDeadline.ts` samt Test.

**MCP-Server:** `create_antrag`, `list_antraege`, `update_antrag_status`, `list_antrag_fristen`
entfernt (29 statt 33 Tools); `search` durchsucht keine Anträge mehr. Offene Claude-Chats sehen die
alten Tools noch, bis ein neuer Chat beginnt.

**Konto löschen (`admin-users`):** lehnt technische Konten ab (zusätzlich zum Trigger). Bei
normalen Konten löscht es vorher die Dateien unter `<user_id>/` in `profilbilder` **und
`dokumente`** (seitenweise, je 100), die Dokument-Zeilen gehen per Cascade – samt fremder Notizen
daran, das sagt der Bestätigungsdialog jetzt auch. Der Löschknopf ist bei technischen Konten
ausgegraut. Die Schleife über den entfernten Bucket `zusammenfassungen` ist raus.

**MCP-Token im Header (geprüft):** Der Server nimmt `Authorization: Bearer` schon immer an, Header
vor Query-Parameter. Der Custom-Connector-Dialog von claude.ai kann aber keine Header setzen (nur
URL und OAuth), dort bleibt `?token=`. Für Clients mit Header-Unterstützung (Claude Code, API,
dailyallris) steht die Header-Variante jetzt in README Abschnitt 9. Ganz ohne Token in der URL ginge
es für claude.ai nur mit OAuth in der Function.

**CLAUDE.md:** veralteter Punkt „RIS-Dokumenten-Import in `documents`" aus den nächsten Schritten
gestrichen.

## 18.10.2026 – iCal-Export gestrichen, Typen geprüft

Nutzerentscheidung: kein iCal-Export. Aus den nächsten Schritten in CLAUDE.md gestrichen, in KONZEPT.md
Abschnitt 5 als gestrichen markiert.

`src/lib/database.types.ts` nach 0061 frisch über den Connector erzeugt und Zeile für Zeile mit der
von Hand gekürzten Fassung verglichen: alle 23 Tabellen identisch, keine Änderung nötig.

## 18.10.2026 – Tag „Enthält Bilder" statt Bilder im Hub

Nutzerentscheidung: Ein Anhang-System für Bilder (eigene Tabelle, erweiterte Speicherregel, MCP-Tool)
ist zu viel. Die Original-PDFs liegen ohnehin bei jeder ALLRIS-Vorlage im Hub (1.139 von 1.139,
zusammen 83 MB, Median 62 kB); es reicht zu wissen, wo sich der Blick hinein lohnt.

`scripts/wartung-bilder.py` (PyMuPDF, über `wartung.yml` skript=bilder) prüft jedes PDF: ein Bild
zählt ab 300×200 px und 10 % der Seitenfläche, außer es kommt identisch (gleiche Prüfsumme) in 5
oder mehr PDFs vor – das sind Logo, Wappen, Briefkopf. Gefundene Dokumente bekommen den Tag
„Enthält Bilder", veraltete Tags werden entfernt; nicht lesbare PDFs bleiben unverändert. Ins
Protokoll kommen nur Zahlen. dailyallris übernimmt dieselbe Regel für neue Vorlagen.

`wartung-speicher.mjs` (einmaliger Lauf vom 17.10.) ist entfernt, die Option heißt jetzt `bilder`.

**Nachtrag:** dailyallris prüft jetzt zusätzlich die Anlagen jeder Vorlage aus ALLRIS (Variante b:
nur prüfen, nicht speichern) und hat den Bestand nachgetragen – 131 Vorlagen tragen den Tag statt
17; die meisten Pläne stecken in Anlagen. `wartung-bilder.py` setzt den Tag seitdem nur noch und
entfernt ihn nie, sonst hätte ein erneuter Lauf diese Befunde wieder gelöscht.

## 18.10.2026 – Öffentlicher und persönlicher ALLRIS-Kalender

Nutzeridee: Der öffentliche ALLRIS-Kalender steht allen Mitgliedern der Ebene zur Verfügung, jeder
wählt daraus seine Gremien. Zusätzlich kann jeder sein persönliches Abo hinterlegen, das nur die
nichtöffentlichen Gremien beisteuert – alle davon, auch Vertretungen, und auswählbar wie die übrigen
(die Fraktionssitzung soll man dort ebenfalls an- und abwählen können; die Google-Quelle „CDU
Fraktion Iserlohn intern" ist ein anderer Kalender und bleibt).

**Befund vorher:** Die gemeinsame Quelle „Stadtrat Iserlohn" hing am persönlichen Abo von Thorsten
Kois (`/personal/ics/…?bid=…&sid=…`). Gemeinsame Quellen sieht jedes angemeldete Konto, samt URL und
aller Sitzungen – also auch Fraktion, Aufsichtsräte und Kleine Kommissionen. Zudem schrieb der
tägliche Import die volle Feed-URL ins Protokoll der Actions-Läufe, und die sind in diesem
öffentlichen Repository für jeden angemeldeten GitHub-Nutzer lesbar. Empfehlung an den Nutzer: den
Abo-Link in ALLRIS neu erzeugen und in der persönlichen Quelle eintragen.

**Vergleich der Feeds** (18.10.): öffentlich 47 Termine, persönlich 69, alle 47 mit gleicher UID
(`ALLRIS-Sitzung-<Nummer>`) auch im persönlichen. Der Abgleich läuft deshalb über die UID, nicht über
Gremiennamen.

**`0062_persoenlicher_allris_kalender.sql`** (über den Connector, mit Generalprobe):
- `calendar_sources.nur_ergaenzend`: nur Termine übernehmen, deren UID in keiner gemeinsamen Quelle
  derselben Ebene vorkommt.
- Neue private Quelle „ALLRIS persönlich" für Thorsten Kois mit dem bisherigen Abo; die 82 Sitzungen
  der zehn nichtöffentlichen Gremien (davon 62 Fraktionssitzungen, auch vergangene, die längst aus
  dem Feed gerollt sind) dorthin **verschoben**, nicht neu angelegt. Keine davon hatte TOPs oder
  ToDos (Sicherheitsnetz in der Migration). Die gemeinsame Quelle liest jetzt den öffentlichen Feed,
  113 Sitzungen bleiben dort.

**Import** (`scripts/import-ics.mjs`, `import-ics-source`): zwei Runden, erst alle anderen Quellen,
dann die ergänzenden (sonst landete eine heute neu veröffentlichte Sitzung doppelt). Ausgeschlossene
UIDs zählen für die Absage-Erkennung als „im Feed", ein öffentlich gewordener Termin gilt also nicht
als abgesagt. Keine Feed-URL mehr im Protokoll oder in Fehlerantworten (`ohneUrl()`), `quelle_url`
fällt nur noch auf die URL ohne Query zurück.

**Oberfläche:** Beim Anlegen/Bearbeiten einer Sitzungsquelle die Option „Persönliches ALLRIS-Abo";
in der Liste das Kennzeichen „Persönlich, ergänzend".

**Für die anderen Mitglieder:** Wer bisher Fraktion, Aufsichtsräte oder Kleine Kommissionen über
die gemeinsame Quelle sah, sieht sie erst wieder mit eigenem persönlichem Abo. Kreistag-, LWL- und
die Google-Quelle bleiben unverändert (Absprache mit den betroffenen Mitgliedern steht aus).

