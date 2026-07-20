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
6. Für den Deploy der Edge Function (siehe Abschnitt 8) zusätzlich zwei weitere Repository Secrets:
   - `SUPABASE_ACCESS_TOKEN` – ein **Personal Access Token** deines Supabase-Accounts (nicht das
     Projekt-API-Secret!), erzeugbar unter [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).
   - `SUPABASE_PROJECT_REF` – die Projekt-Referenz, der Teil vor `.supabase.co` in deiner Project URL
     (z. B. `abcdefghijklmnop`).

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

## 8. Kalenderquelle einzeln neu laden (Edge Function)

Neben jeder Kalenderquelle in den Settings gibt es einen „Aktualisieren"-Link, der **nur diese eine
Quelle** sofort neu importiert (statt auf den nächsten täglichen Job zu warten):

- Supabase Edge Function: `supabase/functions/import-ics-source/index.ts` (Deno), aufgerufen per
  `supabase.functions.invoke('import-ics-source', { body: { source_id } })` aus `Settings.tsx`.
- Läuft serverseitig mit `SUPABASE_SERVICE_ROLE_KEY`, den Supabase Edge Functions automatisch als
  Umgebungsvariable bekommen (kein manuelles Secret nötig, anders als beim GitHub-Actions-Job).
- Deploy erfolgt automatisch bei jedem Push, der `supabase/functions/**` ändert
  (`.github/workflows/deploy-edge-functions.yml`), braucht dafür die beiden Secrets aus Abschnitt 3,
  Schritt 6 (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`).
- Teilt sich die ICS-Parsing-Logik konzeptionell mit `scripts/import-ics.mjs` (Node-Skript für den
  Gesamt-Import aller Quellen); aus Deno/Node-Kompatibilitätsgründen bewusst als eigener Code dupliziert.

Lokal testen (Deno muss installiert sein): `deno check --config supabase/functions/import-ics-source/deno.json supabase/functions/import-ics-source/index.ts`.

## 9. MandatsCockpit per Chat aus Claude steuern (MCP-Server)

Über eine weitere Edge Function (`supabase/functions/mcp-server/index.ts`) lässt sich MandatsCockpit
direkt aus Claude heraus per Chat bedienen (z. B. „Leg mir ein ToDo an: XY im nächsten
Verkehrsausschuss fragen"). Sie implementiert das MCP-JSON-RPC-Protokoll (`initialize`, `tools/list`,
`tools/call`) über einen einzigen HTTP-Endpunkt und stellt drei Tools bereit: `create_todo`,
`create_event`, `list_next_sessions`.

**Auth-Modell:** Kein OAuth, sondern ein **persönliches Token pro Mitglied** – jeder Nutzer erzeugt es
sich selbst, die Function agiert dann über den `SUPABASE_SERVICE_ROLE_KEY` im Namen genau dieses
Kontos. Gespeichert wird dabei nur der SHA-256-Hash des Tokens (Tabelle `mcp_tokens`,
`supabase/migrations/0016_mcp_tokens.sql`), nie der Klartext.

⚠️ Claudes „Custom Connector“-Dialog bietet (Stand jetzt) **nur ein einzelnes URL-Feld** an, kein
separates Bearer-Token-/API-Key-Feld (nur eine optionale OAuth-Client-ID für Server, die echtes
OAuth sprechen). Das Token wird deshalb direkt **als Teil der URL** übergeben
(`...?token=<token>`) – die Edge Function liest es dort per Query-Parameter aus (zusätzlich wird,
falls vorhanden, weiterhin auch ein `Authorization: Bearer`-Header akzeptiert, falls ein anderer
MCP-Client das unterstützt). Zwei weitere Stolpersteine, die dabei aufgetreten sind:

- Die Function muss mit `verify_jwt = false` deployt sein (siehe `supabase/config.toml`), sonst weist
  Supabases eigenes API-Gateway jede Anfrage schon vor Erreichen der Function mit
  `UNAUTHORIZED_INVALID_JWT_FORMAT` ab, weil es den Token-String als Supabase-Auth-JWT zu parsen
  versucht.
- `mcp-server` gibt bei fehlendem/ungültigem Token **nie HTTP 401** zurück, sondern immer HTTP 200 mit
  einem JSON-RPC-Fehler im Body. Grund: Claudes MCP-Client startet einen OAuth-Registrierungsversuch
  („Registrierung beim Anmeldedienst … fehlgeschlagen“), sobald der Server irgendwann mit 401
  antwortet (Standardverhalten laut MCP-Authorization-Spezifikation) – das schlägt hier immer fehl, da
  diese Function kein OAuth implementiert. Mit HTTP 200 + JSON-RPC-Fehler bleibt der Connector nutzbar,
  ohne dass Claude eine OAuth-Registrierung versucht.

1. **Migration einspielen:** `supabase/migrations/0016_mcp_tokens.sql` wie in Abschnitt 3, Schritt 3
   beschrieben im SQL Editor ausführen (oder `supabase db push`).
2. **Zugangs-URL erzeugen:** In der App unter **Einstellungen → MCP Connection** auf
   „Zugangs-URL erzeugen“ klicken. Die komplette URL (inkl. `?token=...`) wird nur **einmalig** im
   Klartext angezeigt – sofort kopieren und sicher aufbewahren (z. B. im Passwort-Manager). Ein neues
   Token zu erzeugen macht das alte ungültig.
3. **Deploy:** Läuft automatisch mit, sobald `supabase/functions/**` gepusht wird (siehe Abschnitt 8,
   `deploy-edge-functions.yml` deployt alle Functions inkl. `mcp-server` ohne weitere Anpassung) –
   `supabase/config.toml` (`verify_jwt = false` für `mcp-server`) wird dabei automatisch mit
   berücksichtigt.
4. **In Claude als Custom Connector eintragen:**
   - In Claude unter **Connectors** (bzw. **Settings → Connectors**, je nach Claude-Version) einen
     **Custom Connector** hinzufügen.
   - Die in Schritt 2 kopierte **komplette URL** (inklusive `?token=...`) in das eine URL-Feld
     einfügen – nicht nur den Teil vor dem `?`.
   - Danach stehen die drei Tools in Claude-Chats zur Verfügung.

Jedes Mitglied verwaltet seine eigene Zugangs-URL selbst; es gibt keine globale, gemeinsam genutzte
Zugangskennung. Lokal typprüfbar mit `deno check --config supabase/functions/mcp-server/deno.json
supabase/functions/mcp-server/index.ts`.

## 10. Weiterentwicklung mit Claude Code

Im Projektordner einfach `claude` starten – die Datei `CLAUDE.md` gibt Claude Code den vollen
Projektkontext (Architektur, aktueller Stand, nächste Schritte, offene Design-Fragen). Guter
Einstiegs-Prompt:

> Lies CLAUDE.md und docs/KONZEPT.md. Baue als Nächstes den ICS-Import-Job für die
> Kalenderquellen (siehe CLAUDE.md, Punkt 1 unter "Nächste Schritte").
