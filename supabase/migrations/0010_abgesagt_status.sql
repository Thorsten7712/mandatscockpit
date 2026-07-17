-- "Abgesagt" als eigener Status statt Hard-Delete: Sitzungen (sessions)
-- und eigene Termine (events) können jetzt als abgesagt markiert werden,
-- statt gelöscht zu werden - dadurch bleiben verknüpfte Notizen/Dokumente
-- (summaries) erhalten (die per on delete cascade sonst mitgelöscht würden).
--
-- Der bestehende Check-Constraint auf sessions.status wird per pg_constraint
-- dynamisch gesucht und ersetzt, statt den auto-generierten Namen zu raten
-- (robuster als "alter table ... drop constraint sessions_status_check").

do $$
declare
  found_constraint text;
begin
  select con.conname into found_constraint
  from pg_constraint con
  join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
  where con.conrelid = 'public.sessions'::regclass
    and con.contype = 'c'
    and att.attname = 'status';
  if found_constraint is not null then
    execute format('alter table public.sessions drop constraint %I', found_constraint);
  end if;
end $$;

alter table public.sessions add constraint sessions_status_check
  check (status in ('geplant', 'aktiv', 'abgeschlossen', 'abgesagt'));

alter table public.events add column status text not null default 'geplant'
  check (status in ('geplant', 'abgesagt'));
