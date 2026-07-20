-- Nutzerentscheidung nach Testen von 0018: die Trennung soll STRIKT sein,
-- auch für Admins - ein Admin-Account soll private Kalenderquellen anderer
-- Mitglieder ebenfalls nicht sehen (0018 hatte dafür noch eine bewusste
-- Ausnahme analog zu den bestehenden update/delete-Policies aus
-- 0006_calendar_sources_admin.sql, die sich in der Praxis als unerwünscht
-- herausstellte: ein Admin-Testaccount sah weiterhin fremde private Quellen
-- wie "Kreistag MK").

drop policy if exists "calendar_sources_select_shared_or_own" on public.calendar_sources;
create policy "calendar_sources_select_shared_or_own"
  on public.calendar_sources for select
  to authenticated
  using (
    verwaltet_von is null
    or verwaltet_von = auth.uid()
  );

drop policy if exists "sessions_select_visible_source" on public.sessions;
create policy "sessions_select_visible_source"
  on public.sessions for select
  to authenticated
  using (
    source_id is null
    or exists (
      select 1 from public.calendar_sources cs
      where cs.id = sessions.source_id
        and (cs.verwaltet_von is null or cs.verwaltet_von = auth.uid())
    )
  );

-- update/delete: die Admin-Ausnahme bleibt NUR für die gemeinsam verwaltete
-- Quelle (verwaltet_von is null, z. B. "Stadtrat Iserlohn") bestehen - die
-- kann sonst niemand bearbeiten, da "verwaltet_von = auth.uid()" bei null
-- nie zutrifft (siehe 0006). Der "sowie fremde Kalenderquellen"-Teil aus
-- 0006 entfällt: er wäre nach der SELECT-Einschränkung oben ohnehin nur noch
-- eine unsichtbare, aber immer noch nutzbare Schreibrechte-Lücke gewesen
-- (Admin könnte per erratener/bekannter UUID weiterhin fremde private
-- Quellen ändern/löschen, obwohl die Liste sie nicht mehr anzeigt).

drop policy if exists "calendar_sources_update_own_or_admin" on public.calendar_sources;
create policy "calendar_sources_update_own_or_shared_admin"
  on public.calendar_sources for update
  using (
    verwaltet_von = auth.uid()
    or (
      verwaltet_von is null
      and exists (select 1 from public.profiles where id = auth.uid() and rolle = 'admin')
    )
  );

drop policy if exists "calendar_sources_delete_own_or_admin" on public.calendar_sources;
create policy "calendar_sources_delete_own_or_shared_admin"
  on public.calendar_sources for delete
  using (
    verwaltet_von = auth.uid()
    or (
      verwaltet_von is null
      and exists (select 1 from public.profiles where id = auth.uid() and rolle = 'admin')
    )
  );
