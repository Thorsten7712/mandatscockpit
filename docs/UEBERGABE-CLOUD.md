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
2. **Lückenlose Prüfung**, welchen vergangenen Sitzungen eine Tagesordnung fehlt – bisher nur
   stichprobenartig. Kann dailyallris selbst erzeugen (`list_session_agenda` über alle Sitzungen).
3. **Arbeitskreis Entwicklung Iserlohn** – nicht geklärt, ob öffentlich oder nicht.
4. Die sechs Punkte unter „Geplante nächste Schritte" in `CLAUDE.md` (ToDo-Zuständigkeit,
   Fraktionsbüro-Termine, RIS-Import, iCal-Export, Bilder in Vorlagen, MCP-Tools für Fakten).

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

### 5. Der MCP-Connector — bitte zuerst prüfen

Ein großer Teil der Arbeit hier lief über den MandatsCockpit-MCP-Connector (`list_sessions`,
`list_documents`, `list_session_agenda`, `delete_document`, …). **Ob der in einer Cloud-Sitzung
verfügbar ist, weiß ich nicht** – das hängt daran, wie Connectors dort durchgereicht werden. Das
bitte als Erstes testen (ein `list_sessions` mit kleinem Limit genügt).

Falls er fehlt, bleibt als Ersatz:

- Lesen/Schreiben über die Supabase-REST-API mit dem Service-Role-Key (umgeht RLS, entsprechend
  vorsichtig) – der liegt als Repository-Secret `SUPABASE_SERVICE_ROLE_KEY`.
- Oder einmalige Auswertungen als Migration mit `raise notice`, wie es `0045`–`0048` tun.

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

**Prüfe als Erstes, ob der MandatsCockpit-MCP-Connector in dieser Sitzung verfügbar ist**
(`list_sessions` mit `limit: 3`). Melde das Ergebnis – ohne ihn fehlt dir der Blick auf die
Live-Daten, und wir müssen einen anderen Weg finden.

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

1. Lückenlos prüfen, welchen vergangenen Sitzungen eine Tagesordnung fehlt. Bisher ist das nur
   stichprobenartig geschehen.
2. Die 33 verbliebenen Tagesordnungs-PDFs im Dokumenten-Hub aufräumen, sobald die jeweilige
   Tagesordnung strukturiert vorliegt (`delete_document`; der Hub-Bestand gehört dem Konto
   „ALLRIS-Import", Admins dürfen dessen Dokumente löschen).
3. Klären, ob der „Arbeitskreis Entwicklung Iserlohn" öffentlich tagt – falls nicht, gehört er zu
   den Gremien, die zwar im Kalender stehen, aber keinen Inhalt bekommen.
4. Danach die Punkte unter „Geplante nächste Schritte" in `CLAUDE.md`.

**Zwei Dinge, die dich sonst Zeit kosten:**

- Die Tool-Liste eines MCP-Connectors ist **pro Unterhaltung eingefroren**. Nach einer Änderung am
  MCP-Server siehst du das neue Tool erst in einem neuen Chat.
- `supabase db push` braucht `SUPABASE_ACCESS_TOKEN` und `SUPABASE_DB_PASSWORD` als
  Umgebungsvariablen, sonst fragt es interaktiv und hängt.

Frag nach, bevor du etwas Unumkehrbares tust – Löschen von Dokumenten oder Sitzungen trifft alle
Mitglieder, nicht nur den Aufrufer.
