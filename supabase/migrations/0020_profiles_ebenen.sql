-- Mehrfach-Mandate: ein Nutzer kann gleichzeitig Mandate auf mehreren Ebenen
-- haben (z. B. Stadtrat UND Kreistag). Anders als `partei` (admin-verwaltet,
-- siehe 0014_profiles_partei.sql) trägt jeder Nutzer seine eigenen Ebenen
-- SELBST in den Settings ein - profiles_update_own (0001_init.sql) deckt das
-- Selbst-Editieren bereits ab, keine neue Update-Policy nötig.
alter table public.profiles
  add column ebenen text[] not null default '{}'::text[]
  check (ebenen <@ array['kommune', 'kreis', 'land', 'bund']);

-- Kandidatensuche fürs Teilen von ToDo-Karten (siehe 0021): Kolleg*innen
-- gleicher Partei mit mindestens einer gemeinsamen Ebene sichtbar machen.
-- SECURITY DEFINER-Helper statt direktem Sub-Select auf profiles in der
-- eigenen Policy - eine Policy auf profiles, die in ihrer USING-Klausel
-- wieder profiles abfragt, verursacht "infinite recursion detected in
-- policy" (Postgres 42P17), siehe 0007_fix_profiles_rls_recursion.sql.
create or replace function public.current_user_partei()
returns text as $$
  select partei from public.profiles where id = auth.uid();
$$ language sql security definer stable;

create or replace function public.current_user_ebenen()
returns text[] as $$
  select ebenen from public.profiles where id = auth.uid();
$$ language sql security definer stable;

-- Die konkrete Ziel-Ebene einer einzelnen Karte filtert das Frontend
-- zusätzlich clientseitig aus dieser bereits eng gescopten Menge (gleiche
-- Partei + Ebenen-Überschneidung insgesamt).
create policy "profiles_select_same_partei_ebene"
  on public.profiles for select
  using (
    partei is not null
    and partei = public.current_user_partei()
    and ebenen && public.current_user_ebenen()
  );
