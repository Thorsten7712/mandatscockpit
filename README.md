# MandatsCockpit

Interaktives Dashboard für Mitglieder des Stadtrats Iserlohn (und potenziell weiterer Gremien).
Das vollständige Konzept steht in [`docs/KONZEPT.md`](./docs/KONZEPT.md) – bei Fragen zu Architektur
oder Design-Entscheidungen dort zuerst nachlesen.

Dies ist ein **Starter-Scaffold** für Phase 1 (siehe KONZEPT.md Abschnitt 10): Login, Kalender
(importierte Sitzungstermine + eigene Termine), ToDo-Board. Weiterentwicklung ist für Claude Code
vorbereitet – siehe [`CLAUDE.md`](./CLAUDE.md) für den aktuellen Stand und die nächsten Schritte.

## 1. Voraussetzungen

- Node.js 20+
- Ein GitHub-Repository namens `mandatscockpit` (leer, noch nicht angelegt? Siehe Schritt 2)
- Ein Supabase-Projekt (Free-Tier reicht, siehe KONZEPT.md Abschnitt 3)

## 2. GitHub-Repository anlegen

1. Auf [github.com/new](https://github.com/new) ein neues Repository namens `mandatscockpit` anlegen
   (privat empfohlen, siehe KONZEPT.md Abschnitt 8).
2. Den Inhalt dieses Ordners in das leere Repo kopieren (oder das Repo klonen und die Dateien
   hineinkopieren) und pushen:
   ```bash
   cd mandatscockpit
   git init
   git add .
   git commit -m "Initial scaffold"
   git branch -M main
   git remote add origin https://github.com/<dein-github-name>/mandatscockpit.git
   git push -u origin main
   ```
3. Unter **Settings → Pages** als Quelle „GitHub Actions" auswählen (nicht „Deploy from a branch").

## 3. Supabase verknüpfen

1. Im Supabase-Dashboard unter **Project Settings → API** die **Project URL** und den **anon public
   key** kopieren.
2. Lokal `.env.example` zu `.env.local` kopieren und die beiden Werte eintragen:
   ```bash
   cp .env.example .env.local
   ```
3. Das Datenbank-Schema einspielen: Im Supabase-Dashboard unter **SQL Editor** den Inhalt von
   `supabase/migrations/0001_init.sql` einfügen und ausführen. (Alternativ mit installierter
   Supabase-CLI: `supabase link` + `supabase db push`.)
4. Für den GitHub-Actions-Build die gleichen zwei Werte als **Repository Secrets** hinterlegen
   (Settings → Secrets and variables → Actions → New repository secret):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Für den ICS-Import-Job (siehe Abschnitt 8) zusätzlich den **service_role key** (Project Settings →
   API → „service_role secret") als weiteres Repository Secret hinterlegen:
   - `SUPABASE_SERVICE_ROLE_KEY`

   ⚠️ Dieser Key umgeht Row-Level-Security komplett und darf **niemals** im Frontend/`VITE_`-Präfix oder
   in `.env.example`/`.env.local` landen – er wird ausschließlich als GitHub-Actions-Secret verwendet.

## 4. Ersten Account anlegen

Im MVP gibt es noch keine Selbstregistrierung. Accounts werden vom Ratsbüro im Supabase-Dashboard
angelegt: **Authentication → Users → Add user**. Beim ersten Login wird automatisch ein passendes
Profil in der Tabelle `profiles` erzeugt (Rolle standardmäßig `mitglied`). Rolle und Fraktion danach
direkt in der Tabelle `profiles` anpassen (z. B. `rolle = 'fraktionsbuero'` für einen
Fraktionsbüro-Account).

## 5. Lokal starten

```bash
npm install
npm run dev
```

Die App läuft dann unter `http://localhost:5173`.

## 6. Deployment

Jeder Push auf `main` löst automatisch Build + Deploy nach GitHub Pages aus
(`.github/workflows/deploy.yml`). Die App ist danach unter
`https://<dein-github-name>.github.io/mandatscockpit/` erreichbar.

Ein zweiter Workflow (`.github/workflows/keep-alive.yml`) pingt alle 4 Tage die Supabase-Datenbank an,
damit das kostenlose Projekt nicht nach 1 Woche Inaktivität automatisch pausiert (siehe KONZEPT.md,
Abschnitt 3).

## 7. ICS-Import-Job

Ein dritter Workflow (`.github/workflows/import-ics.yml`) läuft täglich um 04:00 UTC (per
`workflow_dispatch` auch manuell auslösbar) und importiert alle in `calendar_sources` hinterlegten
ICS-Feeds in die `sessions`-Tabelle:

- Skript: `scripts/import-ics.mjs`, lokal ausführbar mit `npm run import-ics` (braucht `SUPABASE_URL`
  und `SUPABASE_SERVICE_ROLE_KEY` als Umgebungsvariablen, siehe Abschnitt 3, Schritt 5).
- Parst jeden Feed mit `node-ical`. Am echten ALLRIS-Feed von Iserlohn verifiziert (siehe KONZEPT.md
  Abschnitt 11): `SUMMARY` enthält direkt den Gremiumsnamen (z. B. „Finanzausschuss"), keine
  „Gremium – Sitzung"-Heuristik nötig.
- Schreibt per Upsert (Konfliktschlüssel `source_id` + `ics_uid`, siehe
  `supabase/migrations/0002_sessions_ics_uid.sql` + `0003_sessions_ics_uid_constraint.sql`) –
  wiederholte Läufe erzeugen keine Duplikate, und ein manuell vom Ratsbüro gesetzter `status = 'aktiv'`
  wird beim Re-Import nicht überschrieben.

## 8. Weiterentwicklung mit Claude Code

Im Projektordner einfach `claude` starten – die Datei `CLAUDE.md` gibt Claude Code den vollen
Projektkontext (Architektur, aktueller Stand, nächste Schritte, offene Design-Fragen). Guter
Einstiegs-Prompt:

> Lies CLAUDE.md und docs/KONZEPT.md. Baue als Nächstes den ICS-Import-Job für die
> Kalenderquellen (siehe CLAUDE.md, Punkt 1 unter "Nächste Schritte").
