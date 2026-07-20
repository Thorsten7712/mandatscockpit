-- Hotfix: 0021 führte "infinite recursion detected in policy" (Postgres
-- 42P17) auf todos/todo_placements ein - alle Karten wirkten dadurch komplett
-- verschwunden (PostgREST liefert bei 42P17 einen Fehler, den das Frontend
-- als leere Daten behandelt). Ursache, exakt das gleiche Muster wie
-- 0007_fix_profiles_rls_recursion.sql:
--   1) todos_select_own_or_placed fragt in seiner USING-Klausel
--      todo_placements ab, dessen eigene Policy wiederum todos abfragt ->
--      zirkulär zwischen zwei Tabellen.
--   2) todo_placements_select fragt in seiner USING-Klausel zusätzlich
--      todo_placements selbst ab (Self-Join-Subquery) -> direkte Rekursion
--      auf derselben Tabelle.
-- Fix: SECURITY DEFINER-Helper, die die jeweils andere Prüfung OHNE erneute
-- RLS-Auswertung durchführen (laufen mit den Rechten des Funktions-
-- eigentümers, der Row Level Security umgeht).

create or replace function public.todo_hat_platzierung(p_todo_id uuid, p_user_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.todo_placements
    where todo_id = p_todo_id and user_id = p_user_id
  );
$$ language sql security definer stable;

create or replace function public.todo_gehoert_nutzer(p_todo_id uuid, p_user_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.todos
    where id = p_todo_id and user_id = p_user_id
  );
$$ language sql security definer stable;

drop policy "todos_select_own_or_placed" on public.todos;
drop policy "todos_update_own_or_placed" on public.todos;

create policy "todos_select_own_or_placed"
  on public.todos for select
  using (user_id = auth.uid() or public.todo_hat_platzierung(id, auth.uid()));

create policy "todos_update_own_or_placed"
  on public.todos for update
  using (user_id = auth.uid() or public.todo_hat_platzierung(id, auth.uid()));

drop policy "todo_placements_select" on public.todo_placements;
drop policy "todo_placements_delete" on public.todo_placements;

create policy "todo_placements_select"
  on public.todo_placements for select
  using (
    user_id = auth.uid()
    or public.todo_gehoert_nutzer(todo_id, auth.uid())
    or public.todo_hat_platzierung(todo_id, auth.uid())
  );

create policy "todo_placements_delete"
  on public.todo_placements for delete
  using (user_id = auth.uid() or public.todo_gehoert_nutzer(todo_id, auth.uid()));

drop policy "todo_comments_select_via_placement" on public.todo_comments;
drop policy "todo_comments_insert_via_placement" on public.todo_comments;
drop policy "todo_comments_delete_via_placement" on public.todo_comments;

create policy "todo_comments_select_via_placement"
  on public.todo_comments for select
  using (public.todo_hat_platzierung(todo_id, auth.uid()));

create policy "todo_comments_insert_via_placement"
  on public.todo_comments for insert
  with check (user_id = auth.uid() and public.todo_hat_platzierung(todo_id, auth.uid()));

create policy "todo_comments_delete_via_placement"
  on public.todo_comments for delete
  using (public.todo_hat_platzierung(todo_id, auth.uid()));

drop policy "summaries_select_via_todo_placement" on public.summaries;
drop policy "summaries_delete_via_todo_placement" on public.summaries;

create policy "summaries_select_via_todo_placement"
  on public.summaries for select
  using (todo_id is not null and public.todo_hat_platzierung(todo_id, auth.uid()));

create policy "summaries_delete_via_todo_placement"
  on public.summaries for delete
  using (todo_id is not null and public.todo_hat_platzierung(todo_id, auth.uid()));
