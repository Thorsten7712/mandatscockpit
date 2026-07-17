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
  Gremiumsnamen, keine „X – Sitzung"-Heuristik nötig. node-ical liefert Properties mit ICS-Parametern
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
  Bearbeiten/Absagen/Löschen (Inline-Formular). Darunter „Notizen & Dokumente": nutzt die
  `summaries`-Tabelle (mit `event_id`-Spalte, `0009_summaries_termine.sql`) für Freitext-Notizen und
  Datei-Uploads. Dateien landen im privaten Storage-Bucket `zusammenfassungen` unter
  `<user_id>/<dateiname>` (RLS-Policies auf `storage.objects` scopen Zugriff auf den Uploader, per
  `(storage.foldername(name))[1] = auth.uid()::text`). Downloads laufen über `createSignedUrl()`
  (60s gültig), da das Bucket nicht public ist. Zwei Verwendungen:
  - **Inline/Split-View** in `CalendarView.tsx`: Klick auf einen Eintrag in „Nächste Termine" setzt
    `selected` und rendert das Panel in einer zweiten Spalte rechts daneben (kein Navigieren weg vom
    Dashboard).
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
    `src/pages/TodoDetail.tsx` unter `/todo/:id` wurde entfernt, es gibt keine Route mehr dafür). Inhalt:
    Titel, Beschreibung, Zuständigkeit (`zustaendig`, aktuell **Freitext**, bewusst noch keine echte
    Nutzer-Zuweisung, siehe unten), Termin-Verknüpfung (Radio: kein/Datum/eigener Termin/Sitzung –
    exklusiv, beim Speichern werden die jeweils anderen beiden Felder genullt; die Links zu
    „Verknüpfter Termin"/„Verknüpfte Sitzung" zeigen auf `/termin/:kind/:id`, die Standalone-Seite bleibt
    dafür also bewusst bestehen), Kommentare (Tabelle `todo_comments`) und Dokumenten-Upload
    (wiederverwendet `summaries` + Storage-Bucket `zusammenfassungen`, mit `todo_id`-Spalte – bewusst nur
    Datei-Upload, kein Freitext-Feld dort, um nicht mit den Kommentaren zu überlappen). Backdrop-Klick
    schließt das Modal (`stopPropagation` auf dem inneren Panel); Speichern/Löschen ruft `onChanged`
    bzw. schließt via `onClose`, statt zu navigieren – `TodoBoard.tsx` hält dafür `openTodoId` im State
    und lädt die Karten nach Änderungen per `onChanged={load}` neu.
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
