-- ToDo-Board-Ausbau: Beschreibung, Zuständigkeit (Freitext, echte
-- Nutzer-Zuweisung folgt später), Termin-Verknüpfung (eigener Termin
-- zusätzlich zu Sitzung/Datum), Kommentare, Dokumenten-Upload,
-- Standard-Spalten für alle Mitglieder.

alter table public.todos add column beschreibung text;
alter table public.todos add column zustaendig text;
alter table public.todos add column event_id uuid references public.events(id) on delete set null;

-- ─────────────────────────────────────────────────────────────
-- Kommentare pro Karte
-- ─────────────────────────────────────────────────────────────
create table public.todo_comments (
  id uuid primary key default gen_random_uuid(),
  todo_id uuid not null references public.todos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  inhalt text not null,
  erstellt_am timestamptz not null default now()
);

alter table public.todo_comments enable row level security;

-- Sichtbarkeit/Verwaltung von Kommentaren folgt der Sichtbarkeit der
-- zugehörigen Karte (aktuell: nur der Karten-Eigentümer, da Zuständigkeit
-- noch Freitext ist und keine echte Nutzer-Zuweisung existiert).
create policy "todo_comments_manage_via_todo_owner"
  on public.todo_comments for all
  using (exists (select 1 from public.todos t where t.id = todo_id and t.user_id = auth.uid()))
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.todos t where t.id = todo_id and t.user_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────
-- Dokumenten-Upload für Karten: summaries um todo_id erweitern
-- (gleiches Muster wie schon event_id für Termine, siehe 0009).
-- Bestehende summaries-Policies (user_id = auth.uid()) decken die neue
-- Spalte automatisch mit ab, keine neue Policy nötig.
-- ─────────────────────────────────────────────────────────────
alter table public.summaries add column todo_id uuid references public.todos(id) on delete cascade;

-- ─────────────────────────────────────────────────────────────
-- Standard-Spalten für alle: bereits bestehende Nutzer ohne eigene
-- Spalten nachrüsten, künftige Nutzer über den Signup-Trigger.
-- ─────────────────────────────────────────────────────────────
insert into public.todo_columns (user_id, titel, reihenfolge)
select p.id, spalte.titel, spalte.reihenfolge
from public.profiles p
cross join (values ('Neu', 0), ('Geplant', 1), ('Wartet', 2), ('Fertig', 3)) as spalte(titel, reihenfolge)
where not exists (select 1 from public.todo_columns tc where tc.user_id = p.id);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, rolle)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email), 'mitglied');

  insert into public.todo_columns (user_id, titel, reihenfolge)
  values
    (new.id, 'Neu', 0),
    (new.id, 'Geplant', 1),
    (new.id, 'Wartet', 2),
    (new.id, 'Fertig', 3);

  return new;
end;
$$ language plpgsql security definer;
