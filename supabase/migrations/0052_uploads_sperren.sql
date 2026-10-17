-- Nutzer laden keine Dateien mehr hoch (Entscheidung 17.10.2026, siehe
-- docs/ARCHITEKTUR-PLAN.md): Notizen sind reiner Text, Dateien kommen nur noch
-- vom technischen Konto (ALLRIS-Import, profiles.technisch) in den Hub.
-- Einzige Ausnahme sind Profilbilder.
--
-- Damit braucht es auch keine Speicher-Quota pro Nutzer: Was nicht
-- hochgeladen werden kann, belegt keinen Platz.
--
-- Die Sperre steht hier in den Storage-Policies, also in der einzigen
-- Zugriffskontrolle des Projekts - ein Entfernen der Upload-Knöpfe in der
-- Oberfläche allein hielte niemanden ab, der die API direkt aufruft. Der
-- MCP-Server umgeht RLS (Service-Role) und prüft deshalb zusätzlich im
-- eigenen Code (shared.ts, darfDateienHochladen()).
--
-- Bestehende Dateien bleiben lesbar und löschbar; nur neue sind gesperrt.


-- Hilfsfunktion nach dem Muster aus 0050: Schema private, fester Suchpfad,
-- EXECUTE nur für angemeldete Nutzer.
create or replace function private.ist_technisch()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select technisch from public.profiles where id = auth.uid()), false);
$$;

revoke execute on function private.ist_technisch() from public, anon;
grant execute on function private.ist_technisch() to authenticated, service_role;


-- Bucket "dokumente": nur noch das technische Konto, in seinen eigenen Ordner.
-- Keine Größengrenze am Bucket - einzelne ALLRIS-Vorlagen sind groß, und
-- normale Nutzer kommen hier ohnehin nicht mehr hinein.
alter policy dokumente_storage_insert_own on storage.objects
  with check (
    (bucket_id = 'dokumente'::text)
    and ((storage.foldername(name))[1] = ((select auth.uid()))::text)
    and (select private.ist_technisch())
  );

-- Bucket "zusammenfassungen" (Dateien an Sitzungen, Terminen, ToDos,
-- Anträgen): keine neuen Uploads mehr. Lesen und Löschen bleiben. Die Policy
-- bleibt mit `false` stehen statt gelöscht zu werden - so steht die Sperre
-- sichtbar im Bestand, statt nur durch Abwesenheit zu wirken.
alter policy zusammenfassungen_insert_own on storage.objects
  with check (false);

-- Profilbilder: höchstens 2 MB, nur Bildformate. Der Bucket prüft das selbst,
-- auch bei Aufrufen an der Oberfläche vorbei.
update storage.buckets
set file_size_limit = 2 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'profilbilder';


-- Sicherheitsnetz: Außer Profilbildern und dem technischen Weg in "dokumente"
-- darf es keine Upload-Policy mehr geben.
do $$
declare
  offen text;
begin
  select string_agg(policyname, ', ') into offen
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and cmd in ('INSERT', 'ALL')
    and policyname not in ('profilbilder_insert_own', 'dokumente_storage_insert_own', 'zusammenfassungen_insert_own');
  if offen is not null then
    raise exception 'Unerwartete Upload-Policy: %', offen;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'dokumente_storage_insert_own'
      and with_check like '%ist_technisch%'
  ) then
    raise exception 'dokumente_storage_insert_own prüft das technische Konto nicht';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'zusammenfassungen_insert_own' and with_check = 'false'
  ) then
    raise exception 'zusammenfassungen_insert_own ist nicht gesperrt';
  end if;

  raise notice 'Uploads gesperrt: nur noch Profilbilder und das technische Konto in "dokumente".';
end $$;
