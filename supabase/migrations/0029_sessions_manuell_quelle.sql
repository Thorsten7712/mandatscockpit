-- 0028 erlaubte beim manuellen Anlegen einer Sitzung nur source_id = null -
-- dadurch sah eine nachträglich erfasste Sitzung (z. B. "Rat der Stadt
-- Iserlohn") nie so aus wie die importierten Sitzungen derselben Quelle
-- (andere Badge-Farbe/-Beschriftung, siehe Archiv.tsx/TerminDetailPanel.tsx:
-- Badge-Text und Farbe hängen an calendar_sources, nicht an sessions.ebene) -
-- Nutzerfeedback nach dem ersten Test von 0028. source_id darf jetzt beim
-- manuellen Anlegen/Bearbeiten auf eine für den Nutzer sichtbare Quelle
-- (gemeinsam verwaltet ODER eigene) gesetzt werden, damit die Sitzung
-- optisch/inhaltlich in dieselbe Quelle einsortiert werden kann.

drop policy if exists "sessions_insert_manuell" on public.sessions;
create policy "sessions_insert_manuell"
  on public.sessions for insert
  to authenticated
  with check (
    erstellt_von = auth.uid()
    and (
      source_id is null
      or exists (
        select 1 from public.calendar_sources cs
        where cs.id = source_id
          and (cs.verwaltet_von is null or cs.verwaltet_von = auth.uid())
      )
    )
  );

drop policy if exists "sessions_update_own_manuell" on public.sessions;
create policy "sessions_update_own_manuell"
  on public.sessions for update
  using (erstellt_von = auth.uid())
  with check (
    erstellt_von = auth.uid()
    and (
      source_id is null
      or exists (
        select 1 from public.calendar_sources cs
        where cs.id = source_id
          and (cs.verwaltet_von is null or cs.verwaltet_von = auth.uid())
      )
    )
  );
