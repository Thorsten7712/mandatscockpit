-- Kalenderquellen sollen laut KONZEPT.md Abschnitt 5.1/7 nach Nutzern
-- getrennt konfigurierbar sein: eine gemeinsame Grundausstattung
-- (verwaltet_von = null, z. B. "Stadtrat Iserlohn") bleibt für alle
-- sichtbar, zusätzlich vom Mitglied selbst angelegte Quellen
-- (verwaltet_von = <user_id>) sollen NUR für dieses Mitglied sichtbar sein.
--
-- Bug bisher: "calendar_sources_select_all" (0001_init.sql) hatte
-- "using (true)" - jedes Mitglied sah damit auch die privat angelegten
-- Quellen aller anderen Mitglieder (in der Kalenderquellen-Liste UND in der
-- "Meine Gremien"-Ableitung). Admins behalten Sichtbarkeit auf alle Quellen,
-- konsistent mit den bestehenden update/delete-Policies aus
-- 0006_calendar_sources_admin.sql, die Admins bereits erlauben, fremde
-- Quellen zu verwalten.

drop policy if exists "calendar_sources_select_all" on public.calendar_sources;
create policy "calendar_sources_select_shared_or_own"
  on public.calendar_sources for select
  to authenticated
  using (
    verwaltet_von is null
    or verwaltet_von = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and rolle = 'admin')
  );

-- sessions werden aus calendar_sources importiert und müssen dieselbe
-- Sichtbarkeit erben, sonst wären private Quellen zwar in den Einstellungen
-- versteckt, ihre importierten Sitzungen aber weiterhin für alle im Kalender
-- sichtbar (sessions_select_all hatte ebenfalls "using (true)").
drop policy if exists "sessions_select_all" on public.sessions;
create policy "sessions_select_visible_source"
  on public.sessions for select
  to authenticated
  using (
    source_id is null
    or exists (
      select 1 from public.calendar_sources cs
      where cs.id = sessions.source_id
        and (
          cs.verwaltet_von is null
          or cs.verwaltet_von = auth.uid()
          or exists (select 1 from public.profiles where id = auth.uid() and rolle = 'admin')
        )
    )
  );
