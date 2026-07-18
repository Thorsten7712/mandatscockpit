-- Nutzerprofil: Profilfoto zusätzlich zum bereits vorhandenen Namen
-- (profiles.name existiert seit 0001_init.sql). Foto liegt in einem eigenen,
-- privaten Storage-Bucket unter <user_id>/<dateiname>, gleiches Muster wie
-- der "zusammenfassungen"-Bucket aus 0009_summaries_termine.sql.

alter table public.profiles add column foto_url text;

insert into storage.buckets (id, name, public)
values ('profilbilder', 'profilbilder', false)
on conflict (id) do nothing;

create policy "profilbilder_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profilbilder'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "profilbilder_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'profilbilder'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "profilbilder_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profilbilder'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
