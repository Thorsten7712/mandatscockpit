-- Aufräumen nach dem Notiz-Umbau (0055) und der Notiz-Bereinigung vom
-- 17.10.2026. Erste Migration, die über den Workflow migrationen.yml
-- (supabase db push) eingespielt wird statt über den Supabase-Connector: dort
-- hängen DROP- und DELETE-Anweisungen (siehe CLAUDE.md).
--
-- 1. Kommentare: seit 0055 ohne Schreibweg, beide Tabellen sind leer - der
--    eine ToDo-Kommentar wurde zur Notiz (scripts/wartung-notizen.mjs).
-- 2. Schema backup: Sicherung der am 17.10. von Hand gelöschten Notizen und
--    ToDos (245 Dokument-Notizen, 73 ToDo-Notizen, 33 ToDos). Laut Nutzer nicht
--    mehr benötigt; das nächtliche verschlüsselte Backup hält sie noch 14 Tage.


-- Abbrechen statt still Inhalte mitzunehmen, falls doch wieder etwas darin steht.
do $$
begin
  if exists (select 1 from public.todo_comments) or exists (select 1 from public.antrag_comments) then
    raise exception 'Kommentar-Tabellen sind nicht leer - erst prüfen, was dort steht.';
  end if;
end $$;

drop table public.todo_comments;
drop table public.antrag_comments;

drop schema if exists backup cascade;
