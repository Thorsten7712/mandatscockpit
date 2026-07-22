-- Kontaktformular auf der öffentlich (ohne Login) erreichbaren
-- Impressum-Seite (siehe src/pages/Impressum.tsx) - braucht eine Tabelle,
-- in die auch nicht angemeldete Besucher*innen schreiben dürfen. Erste
-- Tabelle im Projekt mit einer anonymen Insert-Policy.
create table public.kontakt_anfragen (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  nachricht text not null,
  gelesen boolean not null default false,
  erstellt_am timestamptz not null default now()
);

alter table public.kontakt_anfragen enable row level security;

-- Jede*r darf eine Anfrage einreichen, auch ohne Login.
create policy "kontakt_anfragen_insert_all"
  on public.kontakt_anfragen for insert
  to anon, authenticated
  with check (true);

-- Nur Admins lesen/verwalten die eingegangenen Anfragen (neuer Bereich in
-- Settings.tsx, analog zur Benutzerverwaltung).
create policy "kontakt_anfragen_select_admin"
  on public.kontakt_anfragen for select
  using (exists (select 1 from public.profiles where id = auth.uid() and rolle = 'admin'));

create policy "kontakt_anfragen_update_admin"
  on public.kontakt_anfragen for update
  using (exists (select 1 from public.profiles where id = auth.uid() and rolle = 'admin'));

create policy "kontakt_anfragen_delete_admin"
  on public.kontakt_anfragen for delete
  using (exists (select 1 from public.profiles where id = auth.uid() and rolle = 'admin'));
