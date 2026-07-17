-- Notizen & Dokumente pro Termin (sowohl eigene Termine als auch
-- importierte Sitzungen). summaries hatte bisher nur document_id/session_id
-- als optionale Verknüpfung - event_id kommt als dritte dazu, damit ein
-- Eintrag wahlweise an ein Dokument, eine Sitzung oder einen eigenen Termin
-- gehängt werden kann.
--
-- Für Datei-Uploads ("Dokumente hochladen") ein eigenes, privates Storage-
-- Bucket samt RLS-Policies: jede Datei liegt unter <user_id>/<dateiname>,
-- Zugriff nur für den Uploader selbst (privat by default, siehe
-- KONZEPT.md Abschnitt 5.2/11).

alter table public.summaries add column event_id uuid references public.events(id) on delete cascade;

insert into storage.buckets (id, name, public)
values ('zusammenfassungen', 'zusammenfassungen', false)
on conflict (id) do nothing;

create policy "zusammenfassungen_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'zusammenfassungen'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "zusammenfassungen_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'zusammenfassungen'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "zusammenfassungen_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'zusammenfassungen'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
