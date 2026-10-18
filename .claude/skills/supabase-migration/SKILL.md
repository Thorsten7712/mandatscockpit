---
name: supabase-migration
description: Checklist for adding or changing a Supabase migration (new table, column, or RLS policy) in MandatsCockpit. Use whenever a task needs a new/changed table, RLS policy, or DB function under supabase/migrations/.
---

# Supabase-Migration in MandatsCockpit anlegen

Kontext: RLS ist die einzige Zugriffskontrolle im Projekt (kein eigener Server). Jede neue Tabelle
braucht eine durchdachte Policy, nicht nur `enable row level security`. Details/Historie zu
bestehenden Policies stehen in `docs/CHANGELOG.md`, falls eine Design-Entscheidung unklar ist.

## Ablauf

1. **Nummer bestimmen**: höchste bestehende Nummer in `supabase/migrations/` + 1, Datei
   `NNNN_kurze_beschreibung.sql`.
2. **Additiv bleiben**: neue Migrationen fügen hinzu (Tabellen, Spalten, Policies), droppen nichts
   ohne explizite Nutzerfreigabe – Drops sind eine riskante, destruktive Entscheidung.
3. **Deutsche Feld-/Tabellennamen** verwenden (`titel`, `erstellt_am`, `fällig_am`-Stil, siehe
   `src/lib/types.ts`), passend zum Rest des Schemas.
4. **RLS-Rekursions-Falle vermeiden**: Eine Policy, die in ihrer eigenen USING-Klausel dieselbe
   Tabelle per Subquery abfragt (z. B. eine `profiles`-Policy, die wieder `profiles` abfragt), wirft
   „infinite recursion detected in policy" (Postgres 42P17). Stattdessen eine `SECURITY DEFINER`-
   Helper-Funktion schreiben, die die Tabelle direkt abfragt und RLS damit umgeht (Beispiele im Repo:
   `current_user_fraktion()`, `dokument_ist_geteilt_mit()`). Neue Helfer
   **immer im Schema `private`** anlegen (`create function private.<name>(...) ... security definer
   set search_path = public, pg_temp`) und in Policies als `private.<name>(...)` aufrufen – in
   `public` wären sie per `/rest/v1/rpc` für jeden erreichbar. `authenticated` braucht EXECUTE
   (`grant execute on function private.<name>(...) to authenticated`), weil Policies mit den
   Rechten des Aufrufers laufen.
5. **Reihenfolge bei `language sql`-Funktionen beachten**: Solche Funktionen werden beim
   `CREATE FUNCTION` sofort gegen das Schema geparst, nicht erst beim ersten Aufruf. Jede Tabelle, die
   die Funktion referenziert, muss also **vorher** in derselben Migration angelegt sein – sonst bricht
   die komplette Migration transaktional ab (`relation "..." does not exist`).
6. **Policy-Muster wählen**:
   - Jede Policy bekommt **`to authenticated`** (außer sie ist bewusst für nicht angemeldete
     Aufrufer, wie `kontakt_anfragen_insert_all`) und nutzt **`(select auth.uid())`** statt
     `auth.uid()` – einmal pro Abfrage statt pro Zeile. Ausnahme: in `x = ANY (...)` kein
     `select` (sonst `text = text[]`-Fehler).
   - Rein privat: `user_id = (select auth.uid())` (Beispiel: `todos_manage_own`).
   - Gemeinsam lesbar, privat schreibbar: separate SELECT/INSERT/UPDATE/DELETE-Policies.
   - Geteilt mit ausgewählten Kolleg*innen (Partei/Ebene/Gliederung): siehe `dokument_shares`/
     `todo_placements` als Vorlage, inkl. der SECURITY DEFINER-Helper aus Punkt 4.
7. **Deployen**: Die Migration geht sofort auf die Produktiv-DB – das ist **getrennt** vom
   App-Deploy. Gearbeitet wird ausschließlich in Cloud-Sitzungen (dort kommt keine
   Postgres-Verbindung durch). Zwei Wege, die zueinander kompatibel sind, weil beide unter der
   Dateinummer in `supabase_migrations.schema_migrations` eintragen:
   - **Workflow `migrationen.yml`** (`supabase db push` vom GitHub-Runner): Trockenlauf im PR,
     Einspielen nach dem Merge. Pflicht für `DROP`/`DELETE` – die hängen über den Connector.
   - **Supabase-Connector**, wenn der Code im selben PR das neue Schema braucht (sonst ginge das
     Frontend vor der Migration live): Datei erst committen, dann per `execute_sql` mit
     `begin; <Dateiinhalt>; insert into supabase_migrations.schema_migrations (version, name,
     statements) values ('NNNN', 'kurze_beschreibung', array['-- eingespielt über den
     Supabase-Connector']); commit;` und mit `list_migrations` nachprüfen. **Nicht
     `apply_migration`** – das trägt einen Zeitstempel statt der Nummer ein und bringt die Historie
     aus dem Takt. Ohne anschließenden `git commit` + `git push`
   bleibt Frontend/Edge-Function-Code auf dem alten Stand, auch wenn die DB schon aktuell ist.
8. **Verifizieren**: kurzer REST-Smoke-Test (Select/Insert gegen die neue Tabelle/Policy) und/oder
   `tsc -b`/`vite build`, falls sich `src/lib/types.ts` ändert. Bei Änderungen an bestehenden
   Policies: Sichtbarkeits-Momentaufnahme vorher/nachher und Generalprobe in einer
   zurückgerollten Transaktion (Vorlage im CHANGELOG-Eintrag zu `0050`).
9. **Linter**: nach dem Einspielen `get_advisors` (security + performance) laufen lassen.
