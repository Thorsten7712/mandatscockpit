-- Erlaubt Admins zusätzlich zu ihren eigenen auch gemeinsam verwaltete
-- (verwaltet_von = null, z. B. die vorkonfigurierte "Stadtrat Iserlohn"-Quelle)
-- sowie fremde Kalenderquellen zu bearbeiten/löschen. Vorher konnte niemand
-- eine Quelle mit verwaltet_von = null jemals ändern, da
-- "verwaltet_von = auth.uid()" bei null nie wahr wird.

drop policy if exists "calendar_sources_update_own" on public.calendar_sources;
create policy "calendar_sources_update_own_or_admin"
  on public.calendar_sources for update
  using (
    verwaltet_von = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and rolle = 'admin')
  );

drop policy if exists "calendar_sources_delete_own" on public.calendar_sources;
create policy "calendar_sources_delete_own_or_admin"
  on public.calendar_sources for delete
  using (
    verwaltet_von = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and rolle = 'admin')
  );
