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
  (`Settings`) – nutzt die bereits bestehenden `calendar_sources_insert_own`/`_delete_own`-Policies
- Vollständiges DB-Schema inkl. RLS-Policies (`supabase/migrations/0001_init.sql`,
  `0002_sessions_ics_uid.sql`, `0003_sessions_ics_uid_constraint.sql`,
  `0004_sessions_source_cascade.sql`, `0005_user_gremien.sql`)
- Settings-Seite hat außerdem einen „Meine Gremien"-Bereich: Checkliste aller distinct
  `sessions.gremium`-Werte, Auswahl landet in `user_gremien` (user_id, gremium). Der Dashboard-Kalender
  (`CalendarView`) zeigt dadurch nur noch Sitzungen der angehakten Gremien – bei keiner Auswahl leer,
  mit Hinweis auf die Settings-Seite.
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

Noch NICHT vorhanden (nächste Schritte, grob nach Konzept-Phasen sortiert):

1. **UI zum Anlegen/Umbenennen/Sortieren von ToDo-Spalten** und zum Erstellen neuer ToDo-Karten
   (aktuell nur Drag & Drop zwischen bereits existierenden Spalten/Karten).
2. **Termin-Erstellung im UI** (aktuell nur Anzeige) – inkl. Variante für die Fraktionsbüro-Rolle, bei der
   ein Zielmitglied aus der eigenen Fraktion ausgewählt werden kann.
3. **Dokumenten-Hub** (Phase 2): Liste/Suche für `documents`, zunächst manuell gepflegt.
4. **Zusammenfassungs-Upload** (Phase 2): Formular zum Hochladen/Einfügen einer Zusammenfassung,
   Verknüpfung mit `document_id` und `session_id`, Speicherung in Supabase Storage bei Dateien.
5. **Sitzungsdetailsicht** (Phase 2): Seite pro Sitzung, die Dokumente + eigene Zusammenfassungen +
   verknüpfte ToDos bündelt (siehe KONZEPT.md Abschnitt 5.5).
6. **iCal-Export** des zusammengeführten persönlichen Kalenders.

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
