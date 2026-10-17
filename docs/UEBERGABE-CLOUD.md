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

Offen, in der Reihenfolge des Nutzens:

**1. `auth.uid()` wird in 70 Policies pro Zeile ausgewertet** statt einmal (`auth_rls_initplan`).
Der Fix ist mechanisch – `auth.uid()` → `(select auth.uid())`, semantisch identisch – und betrifft
jede größere Abfrage im Projekt. Das ist der Befund mit dem besten Verhältnis von Aufwand zu
Wirkung, aber er schreibt die **einzige Zugriffskontrolle** des Projekts um. Mit dem
Supabase-Connector lässt sich das jetzt absichern: vorher und nachher dieselbe Abfrage als
betroffener Nutzer laufen lassen und vergleichen, dass genau dieselben Zeilen sichtbar sind.

**2. Einigen Policies fehlt `to authenticated`.** Aufgefallen daran, dass
`multiple_permissive_policies` Befunde für die Rolle `anon` meldet – diese Policies werden also
auch für nicht angemeldete Aufrufer ausgewertet. Ein Loch ist das nicht (`auth.uid()` ist dort
null, es kommt keine Zeile zurück), aber unsauber und unnötige Arbeit für die Datenbank.

**3. Die SECURITY-DEFINER-Helfer sind als REST-Endpunkte erreichbar**
(`/rest/v1/rpc/dokument_ist_geteilt_mit` & Co., für `anon` wie `authenticated`). **Achtung:
`revoke execute` ist der falsche Fix** – Policy-Ausdrücke laufen mit den Rechten der aufrufenden
Rolle, ohne EXECUTE schlägt jede Abfrage fehl. Der saubere Weg wäre ein eigenes, nicht exponiertes
Schema für die Helfer, und das heißt: jede Policy anfassen, die sie referenziert. Die reale
Angriffsfläche ist gering – die meisten Funktionen liefern Daten des Aufrufers selbst, für `anon`
also nichts; `dokument_ist_geteilt_mit`/`antrag_ist_geteilt_mit` verraten bei bekannten UUIDs, ob
ein Dokument mit einer Person geteilt ist. Bewusste Entscheidung nötig, keine schnelle Aufgabe.

**4. 34 Fremdschlüssel ohne Index** (`unindexed_foreign_keys`, nur INFO). Spürbar beim Löschen in
der Elterntabelle, weil jede gelöschte Zeile die Kindtabellen durchsucht. Bei 799 Sitzungen
irrelevant – die 20 Löschungen in `0047` liefen in Millisekunden. Im Hinterkopf behalten.

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

### 3. Supabase CLI + zwei Umgebungsvariablen

Das ist der Punkt, an dem es hier am häufigsten geklemmt hat: Auf dem Mac holt sich die CLI den
Zugangstoken aus dem Schlüsselbund, und jede Abfrage blieb an einem Dialog hängen. In der Cloud gibt
es keinen Schlüsselbund – dort laufen Migrationen **zuverlässiger**, sobald diese Variablen gesetzt
sind:

| Variable | Wofür |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Persönlicher Supabase-Zugangstoken (nicht anon/service_role!). Existiert bereits als Repository-Secret gleichen Namens. |
| `SUPABASE_DB_PASSWORD` | Datenbank-Passwort des Projekts. Ohne das fragt `supabase db push` interaktiv – in einer Cloud-Sitzung bleibt es dann hängen. |

Dazu einmalig im Projektordner:

```bash
supabase link --project-ref cbxfeijnvnesahgksiad
```

`supabase/.temp/` ist git-ignoriert, die Verknüpfung kommt also nicht aus dem Repo mit.

### 4. `.env.local` (nur für Dev-Server/Preview)

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Beide existieren bereits als Repository-Secrets (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
Für `tsc`/`vite build` sind sie **nicht** nötig – der Client fällt ohne sie auf Platzhalter zurück
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

Der Supabase-Server läuft über einen Personal Access Token. In einer Cloud-Sitzung muss der in der
Umgebung liegen (GitHub-Repository-Secrets erreichen die Sitzung **nicht**, die stehen nur
Actions-Läufen zur Verfügung). Read-only-Modus und Beschränkung auf die Projekt-Referenz
einschalten, wo möglich: Lesen ist das, was fehlt – geschrieben wird weiter über Migrationsdateien,
die im Repository nachvollziehbar bleiben.

### 6. Was **nicht** gebraucht wird

Kein lokaler Supabase-Stack (`supabase start`), kein Docker. Das Projekt arbeitet ausschließlich
gegen die Live-Datenbank; es gibt bewusst keine lokale Entwicklungsdatenbank.

### 7. Eine Warnung zur Reihenfolge

Der Deploy ist **zweistufig**: `supabase db push` wirkt sofort auf die Live-DB, Frontend und Edge
Functions gehen erst mit `git push` live. Code, der ein neues Schema erwartet, darf also nie vor der
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
- Deploy ist zweistufig: erst `supabase db push`, dann `git push`. Nie umgekehrt, wenn Code ein
  neues Schema erwartet.
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
2. **`auth.uid()` → `(select auth.uid())` in den 70 betroffenen Policies.** Mechanisch, aber es
   schreibt die einzige Zugriffskontrolle des Projekts um: vorher und nachher mit `execute_sql`
   prüfen, dass als derselbe Nutzer genau dieselben Zeilen sichtbar sind. Dabei gleich die
   fehlenden `to authenticated`-Klauseln ergänzen. Details im Abschnitt „Befunde des
   Supabase-Linters" in `docs/UEBERGABE-CLOUD.md` – dort steht auch, warum `revoke execute` bei
   den RPC-erreichbaren Helfern der **falsche** Fix wäre.
3. Danach die Punkte unter „Geplante nächste Schritte" in `CLAUDE.md`.

**Zwei Dinge, die dich sonst Zeit kosten:**

- Die Tool-Liste eines MCP-Connectors ist **pro Unterhaltung eingefroren**. Nach einer Änderung am
  MCP-Server siehst du das neue Tool erst in einem neuen Chat.
- `supabase db push` braucht `SUPABASE_ACCESS_TOKEN` und `SUPABASE_DB_PASSWORD` als
  Umgebungsvariablen, sonst fragt es interaktiv und hängt.

Frag nach, bevor du etwas Unumkehrbares tust – Löschen von Dokumenten oder Sitzungen trifft alle
Mitglieder, nicht nur den Aufrufer.
