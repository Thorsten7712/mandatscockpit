-- Neuigkeiten im Cockpit statt Mails (Entscheidung 17.10.2026,
-- docs/ARCHITEKTUR-PLAN.md): Das Dashboard zeigt, was seit dem letzten
-- Besuch passiert ist - neue Zuweisungen, mit mir geteilte Karten, neue
-- Notizen anderer an meinen Karten, neue Tagesordnungspunkte für kommende
-- Sitzungen meiner Gremien. Berechnet wird das in der Oberfläche
-- (src/lib/neuigkeiten.ts); die Datenbank liefert nur die Zeitpunkte.


-- Bis wann jemand die Neuigkeiten gesehen hat. Eigene Tabelle statt einer
-- Spalte in profiles: profiles ist für Kolleg*innen lesbar, und wann jemand
-- zuletzt ins Cockpit geschaut hat, geht niemanden etwas an.
create table public.neuigkeiten_stand (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  gesehen_am timestamptz not null default now()
);

alter table public.neuigkeiten_stand enable row level security;

create policy neuigkeiten_stand_own
  on public.neuigkeiten_stand for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- Seit wann eine Karte auf einem Board liegt ("neu mit dir geteilt").
-- Bestehende Platzierungen bekommen den Zeitpunkt dieser Migration - das ist
-- unschädlich, weil der erste Besuch erst den Ausgangsstand setzt und davor
-- nichts als neu gilt.
alter table public.todo_placements
  add column erstellt_am timestamptz not null default now();


-- Seit wann jemand zuständig ist ("neu dir zugewiesen"). Gesetzt im
-- vorhandenen Trigger aus 0056, damit niemand es von Hand pflegen muss.
alter table public.todos
  add column zustaendig_seit timestamptz;

create or replace function private.pruefe_zustaendigkeit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.zustaendig_user_id is not null
     and new.zustaendig_user_id <> new.user_id
     and not exists (
       select 1 from public.todo_placements p
       where p.todo_id = new.id and p.user_id = new.zustaendig_user_id
     ) then
    raise exception 'Die zuständige Person hat die Karte nicht auf ihrem Board - bitte zuerst teilen.'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' or new.zustaendig_user_id is distinct from old.zustaendig_user_id then
    new.zustaendig_seit := case when new.zustaendig_user_id is null then null else now() end;
  end if;
  return new;
end;
$$;


-- Sicherheitsnetz
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'neuigkeiten_stand' and policyname = 'neuigkeiten_stand_own') then
    raise exception 'Policy für neuigkeiten_stand fehlt';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'todo_placements' and column_name = 'erstellt_am')
     or not exists (select 1 from information_schema.columns where table_name = 'todos' and column_name = 'zustaendig_seit') then
    raise exception 'Zeitspalten fehlen';
  end if;
end $$;
