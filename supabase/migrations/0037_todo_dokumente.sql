-- Nutzerwunsch: ToDos und Dokumente sollen sich gegenseitig mit MEHREREN
-- Gegenstücken verknüpfen lassen ("Verknüpfte Dokumente" bei ToDos,
-- "Verknüpfte ToDos" bei Dokumenten - beide Mehrzahl, anders als die
-- 1:n-Beziehungen zu Sitzungen, wo je Karte/Dokument nur eine einzige
-- session_id existiert). Reine n:m-Verknüpfungstabelle, analog
-- dokument_shares/antrag_shares, aber ohne user_id-Spalte - die Zeile
-- selbst trägt keine eigene Sichtbarkeit, die richtet sich nach dem
-- Zugriff auf Todo ODER Dokument (siehe Policies unten).
create table public.todo_dokumente (
  id uuid primary key default gen_random_uuid(),
  todo_id uuid not null references public.todos(id) on delete cascade,
  dokument_id uuid not null references public.dokumente(id) on delete cascade,
  erstellt_am timestamptz not null default now(),
  unique (todo_id, dokument_id)
);

alter table public.todo_dokumente enable row level security;

-- SELECT bewusst breiter als INSERT/DELETE: sichtbar, wer das Dokument sehen
-- kann (die Subquery gegen dokumente läuft NICHT als SECURITY DEFINER, wird
-- also automatisch durch dokumente_select_own/dokumente_select_shared
-- gefiltert - Standard-Postgres-RLS-Komposition) ODER wer die Karte sehen
-- kann (eigene oder platziert). So zeigt sowohl die ToDo-Detailansicht als
-- auch die Dokument-Detailansicht die Verknüpfung korrekt an.
create policy "todo_dokumente_select"
  on public.todo_dokumente for select
  using (
    exists (select 1 from public.dokumente d where d.id = dokument_id)
    or exists (
      select 1 from public.todos t
      where t.id = todo_id
        and (t.user_id = auth.uid() or exists (select 1 from public.todo_placements tp where tp.todo_id = t.id and tp.user_id = auth.uid()))
    )
  );

-- Anlegen/Entfernen einer Verknüpfung darf, wer die Karte VERWALTEN darf
-- (eigene oder platziert - todos_update_own_or_placed) ODER wer das Dokument
-- BESITZT (dokumente_update_own ist strikt Owner-only, anders als die
-- geteilte SELECT-Sichtbarkeit oben) - eine geteilte Ansicht allein
-- berechtigt nicht zum Verknüpfen fremder Dokumente.
create policy "todo_dokumente_insert"
  on public.todo_dokumente for insert
  with check (
    exists (
      select 1 from public.todos t
      where t.id = todo_id
        and (t.user_id = auth.uid() or exists (select 1 from public.todo_placements tp where tp.todo_id = t.id and tp.user_id = auth.uid()))
    )
    or exists (select 1 from public.dokumente d where d.id = dokument_id and d.user_id = auth.uid())
  );

create policy "todo_dokumente_delete"
  on public.todo_dokumente for delete
  using (
    exists (
      select 1 from public.todos t
      where t.id = todo_id
        and (t.user_id = auth.uid() or exists (select 1 from public.todo_placements tp where tp.todo_id = t.id and tp.user_id = auth.uid()))
    )
    or exists (select 1 from public.dokumente d where d.id = dokument_id and d.user_id = auth.uid())
  );
