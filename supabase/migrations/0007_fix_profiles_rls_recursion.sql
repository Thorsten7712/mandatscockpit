-- Fix für "infinite recursion detected in policy for relation 'profiles'"
-- (Postgres 42P17): Die ursprüngliche Policy "profiles_select_own_or_same_fraktion"
-- (0001_init.sql) fragt in ihrer eigenen USING-Klausel wieder profiles ab
-- ("fraktion = (select fraktion from public.profiles where id = auth.uid())").
-- Zur Auswertung dieser Bedingung muss Postgres dieselbe Policy erneut
-- auswerten -> endlose Rekursion. Der Bug ist so alt wie das Schema, fiel
-- aber nie auf, weil bislang kein Client-Code direkt aus profiles gelesen
-- hat - bis zur Admin-Rollen-Abfrage in Settings.tsx.
--
-- Standard-Fix: die Selbstabfrage über eine SECURITY DEFINER-Funktion
-- laufen lassen, die RLS für ihre interne Abfrage umgeht und damit den
-- Rekursions-Zirkel durchbricht.

create or replace function public.current_user_fraktion()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select fraktion from public.profiles where id = auth.uid();
$$;

drop policy if exists "profiles_select_own_or_same_fraktion" on public.profiles;
create policy "profiles_select_own_or_same_fraktion"
  on public.profiles for select
  using (
    id = auth.uid()
    or fraktion = public.current_user_fraktion()
  );
