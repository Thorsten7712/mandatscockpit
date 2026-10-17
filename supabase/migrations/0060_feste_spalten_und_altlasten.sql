-- Entscheidungen vom 17.10.2026 (docs/ARCHITEKTUR-PLAN.md):
--   - Das ToDo-Board hat feste Spalten: Neu, Geplant, Ergebnis erstellt, Fertig.
--     Frei konfigurierbare Spalten entfallen.
--   - Altlasten aus der Zeit vor dem Notiz-Umbau (0055) und der ToDo-Zuweisung
--     (0056) werden entfernt: Spalten, die nichts mehr beschreibt.
--
-- Enthält UPDATE/DELETE/DROP und läuft deshalb über den Workflow
-- migrationen.yml (supabase db push), nicht über den Supabase-Connector.


-- 1. Feste Board-Spalten -----------------------------------------------------

-- Fehlende der vier Spalten je Konto anlegen, vorhandene (auch in anderer
-- Schreibweise) auf Namen und Reihenfolge bringen.
insert into public.todo_columns (user_id, titel, reihenfolge)
select p.id, z.titel, z.reihenfolge
from public.profiles p
cross join (values ('Neu', 0), ('Geplant', 1), ('Ergebnis erstellt', 2), ('Fertig', 3)) as z(titel, reihenfolge)
where not exists (
  select 1 from public.todo_columns c where c.user_id = p.id and lower(btrim(c.titel)) = lower(z.titel)
);

update public.todo_columns c
   set titel = z.titel, reihenfolge = z.reihenfolge
  from (values ('Neu', 0), ('Geplant', 1), ('Ergebnis erstellt', 2), ('Fertig', 3)) as z(titel, reihenfolge)
 where lower(btrim(c.titel)) = lower(z.titel);

-- Karten aus allen anderen Spalten umziehen: "Wartet…" nach Geplant (die Karte
-- ist angestoßen, es fehlt eine Rückmeldung), alles andere nach Neu. Hinten
-- anstellen, damit die bestehende Reihenfolge der Zielspalte bleibt.
update public.todo_placements tp
   set column_id = ziel.id,
       position = tp.position + 1000
  from public.todo_columns alt, public.todo_columns ziel
 where tp.column_id = alt.id
   and alt.titel not in ('Neu', 'Geplant', 'Ergebnis erstellt', 'Fertig')
   and ziel.user_id = alt.user_id
   and ziel.titel = case when alt.titel ilike 'wartet%' then 'Geplant' else 'Neu' end;

do $$
begin
  if exists (
    select 1 from public.todo_placements tp
    join public.todo_columns c on c.id = tp.column_id
    where c.titel not in ('Neu', 'Geplant', 'Ergebnis erstellt', 'Fertig')
  ) then
    raise exception 'Es liegen noch Karten in Spalten, die gleich gelöscht würden.';
  end if;
end $$;

delete from public.todo_columns where titel not in ('Neu', 'Geplant', 'Ergebnis erstellt', 'Fertig');

alter table public.todo_columns
  add constraint todo_columns_feste_spalten
  check (titel in ('Neu', 'Geplant', 'Ergebnis erstellt', 'Fertig'));
create unique index todo_columns_user_titel_key on public.todo_columns (user_id, titel);

-- Nutzer lesen ihre Spalten nur noch; angelegt werden sie mit dem Konto.
drop policy todo_columns_manage_own on public.todo_columns;
create policy todo_columns_select_own on public.todo_columns
  for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, name, rolle)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email), 'mitglied');

  insert into public.todo_columns (user_id, titel, reihenfolge)
  values
    (new.id, 'Neu', 0),
    (new.id, 'Geplant', 1),
    (new.id, 'Ergebnis erstellt', 2),
    (new.id, 'Fertig', 3);

  return new;
end;
$$;


-- 2. Notizen: nur noch Text an einer Karte -----------------------------------

drop policy summaries_select_shared on public.summaries;
drop policy summaries_select_via_antrag_share on public.summaries;
drop policy summaries_delete_via_antrag_share on public.summaries;

alter policy summaries_manage_own on public.summaries
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.todos t where t.id = todo_id)
  );

alter table public.summaries
  drop column session_id,
  drop column event_id,
  drop column antrag_id,
  drop column document_id,
  drop column datei_url,
  drop column sichtbarkeit;

alter table public.summaries
  alter column todo_id set not null,
  alter column inhalt set not null,
  add constraint summaries_inhalt_nicht_leer check (btrim(inhalt) <> '');


-- 3. ToDos: Freitext-Zuständigkeit und Verweis auf die alte documents-Tabelle --

alter table public.todos
  drop column zustaendig,
  drop column dokument_id;


-- 4. Speicherbereich "zusammenfassungen": Zusammenfassungen gibt es nicht mehr.
-- Die letzte Datei und den Bucket selbst entfernt scripts/wartung-speicher.mjs
-- über die Storage-API (direkte Löschungen in storage.* verbietet Supabase).

drop policy if exists zusammenfassungen_select_own on storage.objects;
drop policy if exists zusammenfassungen_insert_own on storage.objects;
drop policy if exists zusammenfassungen_delete_own on storage.objects;
