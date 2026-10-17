-- ToDo-Zuweisung an Personen statt Freitext (Entscheidung 17.10.2026,
-- docs/ARCHITEKTUR-PLAN.md): Die zugewiesene Person sieht die Karte auf
-- ihrem Board und darf sie bearbeiten. Zuweisbar sind Kolleg*innen gleicher
-- Partei und Ebene.
--
-- Beides hängt an der vorhandenen Platzierung (todo_placements): Wer die
-- Karte auf dem Board hat, sieht und bearbeitet sie bereits
-- (todos_select_own_or_placed, todos_update_own_or_placed), und auf ein
-- fremdes Board kommt eine Karte nur über die Edge Function share-todo, die
-- gleiche Partei und Ebene prüft. Die Zuweisung verlangt deshalb nur, dass
-- die Person die Karte schon auf dem Board hat - die Oberfläche teilt sie
-- vorher mit, wenn nötig. So gibt es keinen zweiten Weg auf ein fremdes
-- Board und keine zweite Stelle, an der die Teilen-Regel stehen müsste.
--
-- Die Freitext-Spalte `zustaendig` ist in keiner Zeile befüllt; sie bleibt
-- vorerst stehen und wird nicht mehr beschrieben.


alter table public.todos
  add column zustaendig_user_id uuid references public.profiles(id) on delete set null;

create index todos_zustaendig_user_id_idx on public.todos (zustaendig_user_id);

comment on column public.todos.zustaendig_user_id is
  'Zuständige Person. Muss die Karte angelegt haben oder auf ihrem Board haben (todo_placements), siehe 0056.';


-- Zuweisung nur an jemanden mit Zugriff auf die Karte. SECURITY DEFINER,
-- weil der Aufrufer die Platzierungen anderer nicht unbedingt sehen darf.
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
  return new;
end;
$$;

create trigger pruefe_zustaendigkeit
  before insert or update of zustaendig_user_id on public.todos
  for each row execute function private.pruefe_zustaendigkeit();

-- Wird die Freigabe entzogen, endet auch die Zuständigkeit - sonst stünde auf
-- der Karte eine Person, die sie gar nicht mehr sieht.
create or replace function private.zustaendigkeit_mit_freigabe_loesen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.todos
     set zustaendig_user_id = null
   where id = old.todo_id
     and zustaendig_user_id = old.user_id
     and user_id <> old.user_id;
  return old;
end;
$$;

create trigger zustaendigkeit_mit_freigabe_loesen
  after delete on public.todo_placements
  for each row execute function private.zustaendigkeit_mit_freigabe_loesen();

revoke execute on function private.pruefe_zustaendigkeit() from public, anon;
revoke execute on function private.zustaendigkeit_mit_freigabe_loesen() from public, anon;


-- Sicherheitsnetz
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'pruefe_zustaendigkeit' and tgrelid = 'public.todos'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'zustaendigkeit_mit_freigabe_loesen' and tgrelid = 'public.todo_placements'::regclass) then
    raise exception 'Trigger der Zuweisung fehlen';
  end if;
end $$;
