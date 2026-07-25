-- Bisher konnten sessions ausschließlich vom ICS-Import-Job (Service Role)
-- angelegt werden (siehe 0001_init.sql, Kommentar "Schreiben später nur via
-- Service Role / Import-Job") - es gab nie eine INSERT-Policy für
-- eingeloggte Nutzer. Für rückwirkend zu erfassende Gremiensitzungen (z. B.
-- ohne ICS-Feed oder vor dessen Einrichtung), an die im Nachhinein noch
-- Dokumente/Notizen gehängt werden sollen (Notizen&Dokumente-Sektion in
-- TerminDetailPanel.tsx funktioniert dafür bereits unverändert, siehe
-- .claude/skills/document-feature), sollen Mitglieder Sitzungen jetzt auch
-- manuell anlegen können.

alter table public.sessions add column erstellt_von uuid references public.profiles(id);

-- Manuell angelegte Sitzungen bleiben klar von importierten unterscheidbar:
-- source_id muss null bleiben (kein Vortäuschen einer ICS-Quelle) und
-- erstellt_von muss der einfügende Nutzer selbst sein. source_id is null
-- sorgt zugleich dafür, dass die neue Sitzung wie bisherige manuelle
-- Datensätze über "sessions_select_visible_source" für alle sichtbar ist.
create policy "sessions_insert_manuell"
  on public.sessions for insert
  to authenticated
  with check (source_id is null and erstellt_von = auth.uid());

-- Bearbeiten/Löschen nur für die eigene manuell angelegte Sitzung -
-- importierte Sitzungen (erstellt_von ist null) bleiben wie bisher für
-- niemanden über die App veränderbar (nur der Import-Job selbst via Service
-- Role Key, RLS-unabhängig).
create policy "sessions_update_own_manuell"
  on public.sessions for update
  using (erstellt_von = auth.uid())
  with check (erstellt_von = auth.uid() and source_id is null);

create policy "sessions_delete_own_manuell"
  on public.sessions for delete
  using (erstellt_von = auth.uid());
