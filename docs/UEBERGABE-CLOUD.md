# Übergabe an eine Claude-Code-Cloud-Sitzung

Stand: 16.10.2026, Commit `1a0668a` auf `main`. Alles ist gepusht, Arbeitsverzeichnis sauber
(einzige Ausnahme: `docs/ZUSAMMENARBEIT.md` ist unversioniert und stammt nicht aus dieser Arbeit).

---

## Teil 1 — Was in den letzten beiden Tagen passiert ist

### Tagesordnungen: Modell, Werkzeug, Daten

Der Dokumenten-Hub kannte bis dahin nur „Dokument hängt an Sitzung". Jetzt **ist** die
Verknüpfungszeile der Tagesordnungspunkt.

| Migration | Inhalt |
|---|---|
| `0044_tagesordnungspunkte.sql` | `dokument_id` nullable, Feld `ergebnis`, partieller Unique-Index auf (`session_id`, `top_nummer`), alle vier RLS-Policies neu |
| `0045_sitzungen_nachtragen.sql` | 36 fehlende Ausschusssitzungen Nov 2025 – Mai 2026 |
| `0046_sitzung_09122025_tagesordnung.sql` | Erste echte Tagesordnung (Rat 09.12.2025, 84 Punkte) |
| `0047` / `0048` | Nichtöffentliche Gremien entfernt – und wieder zurückgeholt (siehe unten) |

Die drei nicht offensichtlichen Entscheidungen:

- **`dokument_id` muss nullable sein.** Gemessen am Rat vom 09.12.2025: 84 Punkte, davon **21 ohne
  Drucksache** („Eröffnung der Sitzung", „Einwohnerfragen"). Ohne sie springt die Nummerierung.
- **Der partielle Unique-Index trägt die Idempotenz.** `unique (session_id, dokument_id)` greift bei
  NULL nicht (NULL ist in Postgres zu jedem anderen NULL ungleich) – ein zweiter Import-Lauf hätte
  alle Punkte ohne Drucksache verdoppelt.
- **Die SELECT-Policy prüfte nur das Dokument.** Bei `dokument_id = null` wäre ihr `exists()` false
  und der Punkt für *niemanden* sichtbar gewesen.

**MCP-Server:** `set_session_agenda` schreibt die ganze Tagesordnung in einem Aufruf,
`list_session_agenda` liest sie zurück. Die Sitzung lässt sich über `session_id`, `ics_uid` oder
`gremium`+`datum` benennen; im letzten Fall trägt der Server eine mitgelieferte `ics_uid` nach.
Drucksachennummern werden über den Dokumenttitel aufgelöst (mit Trennerprüfung, damit „DS11/0470"
nicht auf „DS11/0470-1" trifft); fehlende nennt die Antwort namentlich.

**Der Schlüssel, der die ganze Zeit da war:** `sessions.ics_uid` enthält `ALLRIS-Sitzung-<SILFDNR>` –
dieselbe Nummer, die im Kopf jeder ALLRIS-Tagesordnung steht. An 21 Terminen geprüft, 21-mal
identisch.

### Der Leser ist die Sitzungsansicht

Eine Sitzung öffnet direkt dreispaltig: links die Tagesordnung, in der Mitte das Dokument, rechts
die Notizen. Die frühere Listenansicht existiert für Sitzungen **nicht mehr** – sie lag nach dem
Schließen wieder frei, obwohl sie gerade übersprungen worden war. Die Sitzung selbst (Kopfdaten,
Aufgaben, Anträge, Notizen, Dateien) ist der **erste Eintrag über der Tagesordnung**.

Das Modal-Chrome liegt deshalb in `TerminDetailPanel` (`layout="modal"`), nicht mehr in
`TerminDetailModal` – nur die Komponente weiß, ob sie überhaupt eines braucht. Rückfall auf die
Liste bleibt, wo es nichts zu lesen gibt: eigene Termine und Sitzungen ganz ohne Dokument.

### Daten-Stand

- **dailyallris ist umgestellt und gelaufen.** Tagesordnungen samt Ergebnissen liegen für die
  Gremiensitzungen von 11.11.2025 bis 13.10.2026 vor (stichprobenartig über die ganze Spanne
  geprüft, nicht lückenlos). Die 9 beim Rat 09.12.2025 fehlenden Drucksachen wurden nachgeladen.
- **49 Tagesordnungs-PDFs** lagen im Hub; **16 sind gelöscht**, 33 stehen noch da. Sie werden nicht
  mehr gebraucht, seit die Tagesordnung strukturiert an der Sitzung hängt.
- **Nichtöffentliche Gremien** (Kleine Kommissionen, Verwaltungs- und Aufsichtsräte): bleiben als
  Kalendertermin, bekommen aber keinen Inhalt. Ich hatte das zwischendurch als Löschauftrag
  missverstanden und 20 Sitzungen entfernt – `0048` und ein ICS-Import haben sie zurückgeholt.

### Offene Punkte

1. **dailyallris:** Kleine Kommissionen, Verwaltungs- und Aufsichtsräte beim Tagesordnungs-Import
   überspringen. Dazu: die 33 verbliebenen Tagesordnungs-PDFs nach dem Einlesen löschen.
2. **Datenbank-Hygiene aus dem Linter-Durchlauf vom 17.10.2026** – siehe eigener Abschnitt unten.
3. Die sechs Punkte unter „Geplante nächste Schritte" in `CLAUDE.md` (ToDo-Zuständigkeit,
   Fraktionsbüro-Termine, RIS-Import, iCal-Export, Bilder in Vorlagen, MCP-Tools für Fakten).

### Befunde des Supabase-Linters (17.10.2026)

`get_advisors` über beide Kategorien. **Kein ERROR, und kein einziger Befund zu fehlendem RLS oder
fehlenden Policies** – bei einem Projekt, in dem RLS die einzige Zugriffskontrolle ist, ist das der
Test, auf den es ankommt. Erledigt ist bereits:

- ✅ **`search_path` der SECURITY-DEFINER-Funktionen** (`0049_search_path_fixieren.sql`). Alle elf
  Funktionen in `public` haben jetzt `public, pg_temp`; die Migration bricht ab, falls später eine
  ohne Suchpfad dazukommt.

Am 17.10.2026 nachmittags erledigt (Details im CHANGELOG):

- ✅ **`auth.uid()` einmal pro Abfrage** statt pro Zeile, in allen 79 betroffenen Policies
  (`0050_rls_helfer_privat.sql`).
- ✅ **`to authenticated`** an allen 71 Policies, denen die Rolle fehlte (`0050`). Dabei aufgefallen:
  `summaries_select_shared` hätte als „geteilt" markierte Zusammenfassungen für nicht angemeldete
  Aufrufer lesbar gemacht – zu dem Zeitpunkt 0 betroffene Einträge.
- ✅ **SECURITY-DEFINER-Helfer aus der REST-API genommen**: alle elf liegen im nicht ausgelieferten
  Schema `private` (`0050`). Vorher HTTP 200 ohne Anmeldung, nachher 404.
- ✅ **34 Fremdschlüssel-Indizes** (`0051_fremdschluessel_indizes.sql`). Der Linter meldet sie
  danach als „unused index" – sie waren in dem Moment schlicht neu. Nicht löschen.

Bewusst offen gelassen: **„Multiple Permissive Policies"** (5 Tabellen mit mehreren Lesewegen,
z. B. eigenes / Ebene-weit geteilt / mit mir geteilt). Zusammengelegt würde daraus eine schwer
prüfbare Policy; bei der Datenmenge ohne messbaren Nutzen.

Offen:

**5. Leaked-Password-Protection ist aus.** Ein Schalter im Supabase-Dashboard (Auth-Einstellungen),
der Passwörter gegen HaveIBeenPwned prüft. Passt zum Projekt, das bereits erzwungenen
Passwortwechsel kennt. **Muss Thorsten selbst klicken**, das geht nicht über eine Migration.

Keiner dieser Befunde stammt aus der Tagesordnungs-Arbeit – die neuen Tabellen `sitzung_dokumente`
und `fakten` zeigen dieselben Muster wie der Bestand, weil sie denselben Konventionen folgen.

---

## Teil 2 — Die Cloud-Umgebung einrichten

Es gibt bereits eine Cloud-Umgebung namens **„Mandatscockpit"** (gehostet). Sie ist **nicht** die
Standard-Umgebung – beim Start einer Cloud-Sitzung also ausdrücklich auswählen, sonst landet die
Sitzung in „DailyNewspaper".

Was die Umgebung konkret braucht, damit dort dasselbe möglich ist wie hier:

### 1. Repository

`Thorsten7712/mandatscockpit` (privat). Die Cloud-Sitzung klont es selbst; Branch und PR entstehen
dort. **Achtung:** Ein Push auf `main` löst sofort zwei Deploys aus (GitHub Pages und, bei
Änderungen unter `supabase/functions/**`, die Edge Functions).

### 2. Node 22

`npm ci`, `npx tsc -b`, `npx vite build`. Der ICS-Import-Skript braucht zwingend 22 (nicht 20),
wegen des Realtime-Clients in supabase-js.

### 3. Migrationen: über den Supabase-Connector, nicht per `supabase db push`

**`supabase db push` funktioniert in der Cloud-Umgebung nicht**, auch nicht mit Zugangsdaten.
Getestet am 17.10.2026: Nach außen geht aus dem Container nur HTTPS. Die Postgres-Ports 5432/6543
sind direkt gesperrt; der Proxy der Umgebung öffnet zwar einen Tunnel zum Pooler, bricht ihn aber
als HTTPS auf – Postgres verhandelt TLS innerhalb seines eigenen Protokolls, das passt nicht
zusammen (Verbindung wird zurückgesetzt). Daran ändern auch die „Allowed domains" nichts
(`*.supabase.co`/`*.supabase.com` standen bereits drin), sie regeln nur das Ziel, nicht das Protokoll.

`SUPABASE_ACCESS_TOKEN` und `SUPABASE_DB_PASSWORD` gehören deshalb **nicht** in die
Cloud-Umgebung: `db push` könnte sie dort nie nutzen, und das DB-Passwort ist Vollzugriff an RLS
vorbei.

**Stattdessen über den Supabase-Connector** (läuft über HTTPS, Schreibwerkzeuge sind
freigeschaltet). Ablauf für eine neue Migration `NNNN_name.sql`:

1. Datei unter `supabase/migrations/` anlegen und **committen** – eingespielt wird nur, was im
   Repository steht.
2. Mit `execute_sql` in **einem** Aufruf, damit beides gemeinsam gelingt oder scheitert:

   ```sql
   begin;
   -- ... vollständiger Inhalt der Migrationsdatei ...
   insert into supabase_migrations.schema_migrations (version, name, statements)
   values ('NNNN', 'name', array['-- eingespielt über den Supabase-Connector']);
   commit;
   ```

3. Mit `list_migrations` prüfen, dass `NNNN` dasteht.

**Nicht `apply_migration` verwenden.** Es trägt die Migration unter einem Zeitstempel statt unter
der Dateinummer ein. Die Historie ist heute sauber (`0001`–`0049`, exakt die Dateinamen); ein
Zeitstempel-Eintrag brächte sie aus dem Takt, und der nächste `supabase db push` vom Mac bräche mit
„Remote migration versions not found in local migrations directory" ab. Mit dem Eintrag unter der
Dateinummer bleiben Mac und Cloud austauschbar – der Mac sieht `NNNN` als erledigt an.

`raise notice`-Ausgaben kommen über `execute_sql` nicht zurück; wer Zahlen aus einer
Daten-Migration braucht, fragt sie danach per `select` ab.

### 4. `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (nur für Dev-Server/Preview)

Sind als Umgebungsvariablen der Cloud-Umgebung eingetragen (17.10.2026); Vite liest sie direkt aus
der Umgebung, eine `.env.local` ist nicht nötig. Die GitHub-Repository-Secrets gleichen Namens
erreichen Cloud-Sitzungen **nicht**, die stehen nur Actions-Läufen zur Verfügung. Für `tsc`/`vite build` sind sie **nicht** nötig – der Client fällt ohne sie auf Platzhalter zurück
und baut durch. Nur ein Vorschau-Server ohne diese Werte zeigt eine Seite ohne Daten.

### 5. Zwei MCP-Connectoren

**MandatsCockpit** (unsere eigene Edge Function): `list_sessions`, `list_documents`,
`list_session_agenda`, `set_session_agenda`, `delete_document`, … Authentifiziert über das
persönliche Bearer-Token aus `mcp_tokens`, braucht **kein** Secret in der Umgebung. Darüber lief
der größte Teil der bisherigen Arbeit.

**Supabase** (der offizielle Server): `execute_sql`, `list_tables`, `apply_migration`,
`list_migrations`, `get_advisors`, … Seit dem 17.10.2026 verbunden und ein echter Gewinn – vorher
gab es **keinen SQL-Zugriff**. Auswertungen liefen über Tool-Aufrufe mit Limits und
Stichproben, und die Migrationen `0045`–`0048` tragen `raise notice`-Zeilen, deren einziger Zweck
es war, Zahlen aus der Datenbank zu berichten. Beispiel für den Unterschied: Die Frage „welchen
vergangenen Sitzungen fehlt eine Tagesordnung?" war vorher nur stichprobenartig zu beantworten –
mit SQL ist sie eine Abfrage.

Der Supabase-Server ist ein claude.ai-Connector am Konto – er braucht kein Secret in der Umgebung
und steht in jeder Cloud-Sitzung zur Verfügung, egal ob sie am Rechner, Handy oder iPad gestartet
wurde. Die Schreibwerkzeuge sind bewusst freigeschaltet, weil Migrationen darüber laufen (siehe 3.).
Die Regel dazu: Geschrieben wird ausschließlich, was als Migrationsdatei im Repository steht –
`execute_sql` sonst nur lesend.

### 6. Was **nicht** gebraucht wird

Kein lokaler Supabase-Stack (`supabase start`), kein Docker. Das Projekt arbeitet ausschließlich
gegen die Live-Datenbank; es gibt bewusst keine lokale Entwicklungsdatenbank.

### 7. Eine Warnung zur Reihenfolge

Der Deploy ist **zweistufig**: Eine Migration (Connector oder `supabase db push` vom Mac) wirkt
sofort auf die Live-DB, Frontend und Edge Functions gehen erst mit dem Push nach `main` live. Code, der ein neues Schema erwartet, darf also nie vor der
Migration gepusht werden. Umgekehrt ist eine Migration ohne Push harmlos.

---

## Teil 3 — Prompt für die Cloud-Sitzung

> Alles ab hier in die neue Cloud-Sitzung kopieren.

---

Du übernimmst die Weiterentwicklung von **MandatsCockpit**, einem Dashboard für Mitglieder des
Stadtrats Iserlohn. Repository: `Thorsten7712/mandatscockpit`, Stand `1a0668a` auf `main`.

**Lies zuerst `CLAUDE.md`** – dort steht der aktuelle Architekturstand und, wichtiger, eine Liste
technischer Fallstricke, die aus echten Fehlern dieses Projekts stammen. `docs/CHANGELOG.md` hält
die Begründung zu jeder Design-Entscheidung fest; schlag dort nach, bevor du eine bestehende
Entscheidung änderst. `docs/UEBERGABE-CLOUD.md` fasst den Stand der letzten beiden Arbeitstage
zusammen.

**Prüfe als Erstes, ob beide MCP-Connectoren verfügbar sind:** MandatsCockpit (`list_sessions`
mit `limit: 3`) und Supabase (`execute_sql`). Melde das Ergebnis – ohne sie fehlt dir der Blick auf
die Live-Daten. Der Supabase-Server ist der wichtigere: Er gibt SQL-Zugriff, und ohne den bleiben
Auswertungen Stichproben.

**Arbeitsweise in diesem Projekt:**

- Verifikation läuft über `npx tsc -b`, `npx vite build` und statische Test-Harnesses. Echte
  Login-Durchläufe im Browser sind tabu (Passworteingabe ist eine Sicherheitsregel). Für
  UI-Änderungen lohnt ein Wegwerf-Harness, der die Komponente gegen eine Supabase-Attrappe rendert.
- Edge Functions zusätzlich mit `deno check index.ts` in `supabase/functions/mcp-server/`.
- Deploy ist zweistufig: erst die Migration einspielen, dann `git push` nach `main`. Nie umgekehrt,
  wenn Code ein neues Schema erwartet. Migrationen laufen in der Cloud über den Supabase-Connector
  (`execute_sql` + Eintrag unter der Dateinummer in `supabase_migrations.schema_migrations`), **nicht**
  über `apply_migration` – Ablauf in `docs/UEBERGABE-CLOUD.md`, Teil 2, Abschnitt 3.
- Deutsche Feld- und Tabellennamen in der Datenbank. RLS ist die **einzige** Zugriffskontrolle – es
  gibt keine Backend-Schicht, jede neue Tabelle braucht durchdachte Policies.
- Commits und Changelog-Einträge auf Deutsch, mit der Begründung, nicht nur der Änderung. Das
  CHANGELOG ist das Gedächtnis des Projekts.
- Migrationen dürfen Daten anfassen (`0045`–`0048` tun das), sollen dann aber idempotent sein und
  per `raise notice` berichten, was sie getan haben.

**Was ansteht**, in der Reihenfolge, die ich vorschlagen würde:

1. Die 33 verbliebenen Tagesordnungs-PDFs im Dokumenten-Hub aufräumen, sobald die jeweilige
   Tagesordnung strukturiert vorliegt (`delete_document`; der Hub-Bestand gehört dem Konto
   „ALLRIS-Import", Admins dürfen dessen Dokumente löschen).
2. ~~`auth.uid()` → `(select auth.uid())`, `to authenticated`, Helfer nach `private`~~ –
   erledigt am 17.10.2026 (`0050`, `0051`). Neue Policies und Helfer folgen dem Muster in
   CLAUDE.md („Muster für neue Policies und RLS-Helfer"). Offen bleibt nur der
   Leaked-Password-Schalter im Dashboard.
3. Danach die Punkte unter „Geplante nächste Schritte" in `CLAUDE.md`.

**Zwei Dinge, die dich sonst Zeit kosten:**

- Die Tool-Liste eines MCP-Connectors ist **pro Unterhaltung eingefroren**. Nach einer Änderung am
  MCP-Server siehst du das neue Tool erst in einem neuen Chat.
- `supabase db push` geht in der Cloud-Umgebung **nicht** (nur HTTPS nach außen, Postgres-Ports
  gesperrt). Gar nicht erst versuchen, sondern den Connector-Weg nehmen.

Frag nach, bevor du etwas Unumkehrbares tust – Löschen von Dokumenten oder Sitzungen trifft alle
Mitglieder, nicht nur den Aufrufer.
