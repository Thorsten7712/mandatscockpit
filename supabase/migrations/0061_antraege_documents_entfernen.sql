-- Entscheidungen vom 17.10.2026:
--   - Das Antragswesen (Anträge mit Status, Freigaben, Einreichungsfristen)
--     entfällt. Anträge der Fraktion liegen als Dokumente im Hub (Tag
--     "Antrag"), dafür braucht es keine eigene Tabelle.
--   - Die Tabelle documents aus 0001 (für einen nie gebauten RIS-Import)
--     wird entfernt. Den Import übernimmt dailyallris in die Tabelle
--     dokumente.
--   - Technische Konten (profiles.technisch, der ALLRIS-Import) dürfen nicht
--     gelöscht werden: dokumente.user_id cascaded über profiles, mit dem
--     Konto verschwände der gesamte Hub-Bestand für alle Mitglieder.
--
-- Enthält DROP und läuft deshalb über den Workflow migrationen.yml
-- (supabase db push), nicht über den Supabase-Connector.


-- 1. Antragswesen ------------------------------------------------------------

-- Sicherheitsnetz: nur leere Tabellen entfernen. antrag_deadline_settings
-- enthält reine Einstellungen (Tage vor der Sitzung je Ebene) und darf weg.
do $$
begin
  if exists (select 1 from public.antraege) or exists (select 1 from public.antrag_shares) then
    raise exception 'Es gibt noch Anträge oder Freigaben - erst sichten, dann löschen.';
  end if;
end $$;

-- Policies, Löschprotokoll-Trigger und Fremdschlüssel gehen mit den Tabellen.
drop table public.antrag_shares;
drop table public.antraege;
drop table public.antrag_deadline_settings;

drop function private.antrag_ist_geteilt_mit(uuid, uuid);
drop function private.antrag_gehoert_nutzer(uuid, uuid);


-- 2. Alte Tabelle documents --------------------------------------------------

do $$
begin
  if exists (select 1 from public.documents) then
    raise exception 'documents ist nicht leer.';
  end if;
end $$;

drop table public.documents;


-- 3. Technische Konten nicht löschbar ----------------------------------------

-- Greift auch beim Löschen über auth.users (cascade auf profiles), also auch
-- für die Edge Function admin-users und das Supabase-Dashboard. Wer ein
-- technisches Konto wirklich entfernen will, nimmt ihm vorher das Häkchen.
create or replace function private.technisches_konto_schuetzen()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.technisch then
    raise exception 'Technische Konten lassen sich nicht löschen - ihre Dokumente sind für alle Mitglieder da. Erst profiles.technisch zurücksetzen.';
  end if;
  return old;
end;
$$;

create trigger technisches_konto_schuetzen
  before delete on public.profiles
  for each row execute function private.technisches_konto_schuetzen();
