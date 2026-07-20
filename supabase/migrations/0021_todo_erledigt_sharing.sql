-- ToDo-Board-Ausbau: echte "Erledigt"-Checkbox (statt reinem
-- Spalten-Titel-Matching), Auto-Verschwinden vom Board 5 Tage nach dem
-- Abhaken (rein clientseitig gefiltert, siehe TodoBoard.tsx - kein Cronjob
-- nötig), und Teilen mit Kolleg*innen gleicher Partei+Ebene.
--
-- Teilen verlangt, dass eine Karte auf MEHREREN Boards mit jeweils EIGENER
-- Spalte/Position erscheinen kann - column_id/position wandern deshalb von
-- `todos` in eine neue 1:n-Tabelle `todo_placements` (eine Zeile je
-- (Karte, Nutzer), inkl. der bisherigen alleinigen Platzierung des
-- Erstellers).

alter table public.todos add column erledigt boolean not null default false;
alter table public.todos add column erledigt_am timestamptz;
alter table public.todos add column ebene text check (ebene in ('kommune', 'kreis', 'land', 'bund'));

create table public.todo_placements (
  id uuid primary key default gen_random_uuid(),
  todo_id uuid not null references public.todos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  column_id uuid not null references public.todo_columns(id) on delete cascade,
  position int not null default 0,
  unique (todo_id, user_id)
);

-- Backfill: bisherige column_id/position pro Karte wird zur Platzierung
-- ihres (einzigen) Eigentümers.
insert into public.todo_placements (todo_id, user_id, column_id, position)
select id, user_id, column_id, position from public.todos;

alter table public.todos drop column column_id;
alter table public.todos drop column position;

alter table public.todo_placements enable row level security;

-- ─────────────────────────────────────────────────────────────
-- todos: Ersteller ODER jede Person mit einer Platzierung darf lesen/
-- bearbeiten (volle Gleichberechtigung laut Nutzerentscheidung); nur der
-- Ersteller darf löschen (komplett, für alle) bzw. neue Karten anlegen.
-- ─────────────────────────────────────────────────────────────
drop policy "todos_manage_own" on public.todos;

create policy "todos_select_own_or_placed"
  on public.todos for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.todo_placements tp where tp.todo_id = id and tp.user_id = auth.uid())
  );

create policy "todos_update_own_or_placed"
  on public.todos for update
  using (
    user_id = auth.uid()
    or exists (select 1 from public.todo_placements tp where tp.todo_id = id and tp.user_id = auth.uid())
  );

create policy "todos_insert_own"
  on public.todos for insert
  with check (user_id = auth.uid());

create policy "todos_delete_own"
  on public.todos for delete
  using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- todo_placements: jede Person verwaltet die eigene Platzierung (Drag&Drop,
-- Board-Sichtbarkeit). Anlegen einer Platzierung für ANDERE Nutzer (= Teilen)
-- läuft ausschließlich über die Edge Function share-todo (Service Role) -
-- der Ersteller kann per RLS nicht die todo_columns eines anderen Nutzers
-- lesen, um dort die richtige Zielspalte zu finden. Der Ersteller darf aber
-- fremde Platzierungen LÖSCHEN (Freigabe entziehen), das braucht keinen
-- Column-Lookup.
-- ─────────────────────────────────────────────────────────────
create policy "todo_placements_select"
  on public.todo_placements for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.todos t where t.id = todo_id and t.user_id = auth.uid())
    or exists (
      select 1 from public.todo_placements tp2
      where tp2.todo_id = todo_placements.todo_id and tp2.user_id = auth.uid()
    )
  );

create policy "todo_placements_insert_own"
  on public.todo_placements for insert
  with check (user_id = auth.uid());

create policy "todo_placements_update_own"
  on public.todo_placements for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "todo_placements_delete"
  on public.todo_placements for delete
  using (
    user_id = auth.uid()
    or exists (select 1 from public.todos t where t.id = todo_id and t.user_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────
-- todo_comments: Sichtbarkeit/Schreibrecht folgt jetzt der Platzierung statt
-- reiner Eigentümerschaft der Karte (volle Gleichberechtigung - jede
-- platzierte Person darf auch fremde Kommentare löschen).
-- ─────────────────────────────────────────────────────────────
drop policy "todo_comments_manage_via_todo_owner" on public.todo_comments;

create policy "todo_comments_select_via_placement"
  on public.todo_comments for select
  using (
    exists (select 1 from public.todo_placements tp where tp.todo_id = todo_comments.todo_id and tp.user_id = auth.uid())
  );

create policy "todo_comments_insert_via_placement"
  on public.todo_comments for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.todo_placements tp where tp.todo_id = todo_id and tp.user_id = auth.uid())
  );

create policy "todo_comments_delete_via_placement"
  on public.todo_comments for delete
  using (
    exists (select 1 from public.todo_placements tp where tp.todo_id = todo_comments.todo_id and tp.user_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────
-- summaries: zusätzliche (additive) Policies, damit alle platzierten
-- Personen aufgabenbezogene Dokumente sehen/löschen können, unabhängig von
-- sichtbarkeit='privat'/'geteilt' (die bestehende summaries_manage_own aus
-- 0001_init.sql bleibt für die eigene Upload-Verwaltung unverändert
-- bestehen, mehrere permissive Policies für dieselbe Aktion werden von
-- Postgres per OR verknüpft).
-- ─────────────────────────────────────────────────────────────
create policy "summaries_select_via_todo_placement"
  on public.summaries for select
  using (
    todo_id is not null
    and exists (select 1 from public.todo_placements tp where tp.todo_id = summaries.todo_id and tp.user_id = auth.uid())
  );

create policy "summaries_delete_via_todo_placement"
  on public.summaries for delete
  using (
    todo_id is not null
    and exists (select 1 from public.todo_placements tp where tp.todo_id = summaries.todo_id and tp.user_id = auth.uid())
  );
