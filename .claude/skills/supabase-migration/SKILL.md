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
   `current_user_fraktion()`, `antrag_gehoert_nutzer()`, `antrag_ist_geteilt_mit()`).
5. **Reihenfolge bei `language sql`-Funktionen beachten**: Solche Funktionen werden beim
   `CREATE FUNCTION` sofort gegen das Schema geparst, nicht erst beim ersten Aufruf. Jede Tabelle, die
   die Funktion referenziert, muss also **vorher** in derselben Migration angelegt sein – sonst bricht
   die komplette Migration transaktional ab (`relation "..." does not exist`).
6. **Policy-Muster wählen**:
   - Rein privat: `user_id = auth.uid()` (Beispiel: `todos_manage_own`).
   - Gemeinsam lesbar, privat schreibbar: separate SELECT/INSERT/UPDATE/DELETE-Policies.
   - Geteilt mit ausgewählten Kolleg*innen (Partei/Ebene/Gliederung): siehe `antrag_shares`/
     `todo_placements` als Vorlage, inkl. der SECURITY DEFINER-Helper aus Punkt 4.
7. **Deployen**: `supabase db push` gegen das Live-Projekt bringt die Migration sofort auf die
   Produktiv-DB – das ist **getrennt** vom App-Deploy. Ohne anschließenden `git commit` + `git push`
   bleibt Frontend/Edge-Function-Code auf dem alten Stand, auch wenn die DB schon aktuell ist.
8. **Verifizieren**: kurzer REST-Smoke-Test (Select/Insert gegen die neue Tabelle/Policy) und/oder
   `tsc -b`/`vite build`, falls sich `src/lib/types.ts` ändert.
