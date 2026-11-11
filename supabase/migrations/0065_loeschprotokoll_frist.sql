-- 0065: Löschprotokoll nach 90 Tagen leeren (Entscheidung 11.11.2026).
--
-- private.protokoll (0053) hält jede gelöschte Zeile der Inhaltstabellen samt
-- vollständigem Inhalt fest, bisher ohne Ende. Das widerspricht der
-- Speicherbegrenzung (Art. 5 Abs. 1 lit. e DSGVO), sobald mehr Mitglieder das
-- Cockpit nutzen: Wer einen Eintrag löscht, darf erwarten, dass er irgendwann
-- wirklich weg ist. 90 Tage reichen, um ein versehentliches Löschen zu
-- bemerken und rückgängig zu machen; die Datenschutzerklärung nennt die Frist.
--
-- Umsetzung mit pg_cron in der Datenbank selbst, nicht als GitHub-Action: es
-- braucht dafür keine Zugangsdaten außerhalb der Datenbank, und der Job läuft
-- auch dann, wenn GitHub-Workflows pausieren (inaktive Repos nach 60 Tagen).
--
-- Enthält DELETE (im Funktionsrumpf) und läuft deshalb über den Workflow
-- migrationen.yml, nicht über den Supabase-Connector.

create extension if not exists pg_cron;

create or replace function private.protokoll_aufraeumen()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  anzahl integer;
begin
  delete from private.protokoll where zeitpunkt < now() - interval '90 days';
  get diagnostics anzahl = row_count;
  return anzahl;
end;
$$;

-- Nur der Cron-Job (läuft als postgres) ruft das auf, kein Nutzer.
revoke all on function private.protokoll_aufraeumen() from public, anon, authenticated;

-- Täglich 03:17 UTC, außerhalb des ICS-Imports (04:00) und des Backups.
-- cron.schedule mit Namen ersetzt einen gleichnamigen Job, ist also wiederholbar.
select cron.schedule('protokoll-aufraeumen', '17 3 * * *', 'select private.protokoll_aufraeumen()');
