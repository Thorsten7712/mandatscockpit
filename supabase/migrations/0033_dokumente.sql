-- Dokumenten-Hub: neuer Reiter (Dokumente.tsx) neben dem Archiv, mit zwei
-- Kategorien: "geteilt" (sichtbar für alle Mitglieder derselben Partei UND
-- derselben Ebene/Gliederung, z. B. "Kommune Iserlohn") und "persoenlich"
-- (nur für den Hochladenden). Sowohl über die Web-UI als auch über den
-- MCP-Server befüllbar (siehe supabase/functions/mcp-server/tools/dokumente.ts).
--
-- Das bereits bestehende documents-Table (0001_init.sql) wird bewusst NICHT
-- wiederverwendet: es hat kein user_id/Sichtbarkeitsmodell und ist für einen
-- späteren, anderen Zweck vorgesehen (öffentliche RIS-Importe, siehe
-- KONZEPT.md Abschnitt 5.1) - eine neue Tabelle verbaut dieses Vorhaben nicht.
create table public.dokumente (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  titel text not null,
  sichtbarkeit text not null check (sichtbarkeit in ('persoenlich', 'geteilt')),
  -- ebene/gliederung nur bei sichtbarkeit='geteilt' gesetzt. gliederung wird
  -- IMMER server-seitig aus dem eigenen Profil des Hochladenden übernommen
  -- (nie ein frei eingebbarer String) - sonst könnte sich jemand versehentlich
  -- oder absichtlich in die falsche Gliederung eintragen und ein Dokument an
  -- die falschen Leute "leaken" oder für die richtigen unsichtbar machen.
  ebene text check (ebene in ('kommune', 'kreis', 'land', 'bund')),
  gliederung text,
  tags text[] not null default '{}'::text[],
  inhalt text,
  datei_url text,
  erstellt_am timestamptz not null default now()
);

alter table public.dokumente enable row level security;

-- Gleiche Matching-Logik wie current_user_partei()/current_user_ebenen()
-- (0020_profiles_ebenen.sql) und gleicheGliederung() in src/lib/gliederung.ts
-- (bisher nur clientseitig, für die Teilen-Kandidatensuche bei ToDos/
-- Anträgen) - hier server-seitig für RLS nachgebaut. Bund braucht keinen
-- Gliederungs-Abgleich, es gibt nur einen Bundestag.
create or replace function public.current_user_gliederung_matches(p_ebene text, p_gliederung text)
returns boolean as $$
  select case p_ebene
    when 'bund' then true
    when 'kommune' then p_gliederung is not null and p_gliederung = (select gliederung_kommune from public.profiles where id = auth.uid())
    when 'kreis' then p_gliederung is not null and p_gliederung = (select gliederung_kreis from public.profiles where id = auth.uid())
    when 'land' then p_gliederung is not null and p_gliederung = (select gliederung_land from public.profiles where id = auth.uid())
    else false
  end;
$$ language sql security definer stable;

create policy "dokumente_select_own"
  on public.dokumente for select
  using (user_id = auth.uid());

create policy "dokumente_select_shared"
  on public.dokumente for select
  using (
    sichtbarkeit = 'geteilt'
    and exists (
      select 1 from public.profiles uploader
      where uploader.id = dokumente.user_id
        and uploader.partei is not null
        and uploader.partei = public.current_user_partei()
    )
    and dokumente.ebene = any(public.current_user_ebenen())
    and public.current_user_gliederung_matches(dokumente.ebene, dokumente.gliederung)
  );

create policy "dokumente_insert_own"
  on public.dokumente for insert
  with check (user_id = auth.uid());

create policy "dokumente_update_own"
  on public.dokumente for update
  using (user_id = auth.uid());

create policy "dokumente_delete_own"
  on public.dokumente for delete
  using (user_id = auth.uid());

-- Eigener, privater Storage-Bucket (analog zusammenfassungen in
-- 0009_summaries_termine.sql), aber mit einer zusätzlichen SELECT-Policy für
-- geteilte Dokumente - Postgres-RLS kann nicht auf die Policy einer anderen
-- Tabelle verweisen, daher hier dieselbe Partei/Ebene/Gliederung-Bedingung
-- wie oben, dupliziert für storage.objects.
insert into storage.buckets (id, name, public)
values ('dokumente', 'dokumente', false)
on conflict (id) do nothing;

create policy "dokumente_storage_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'dokumente'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "dokumente_storage_select_own_or_shared"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'dokumente'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.dokumente d
        join public.profiles uploader on uploader.id = d.user_id
        where d.datei_url = storage.objects.name
          and d.sichtbarkeit = 'geteilt'
          and uploader.partei is not null
          and uploader.partei = public.current_user_partei()
          and d.ebene = any(public.current_user_ebenen())
          and public.current_user_gliederung_matches(d.ebene, d.gliederung)
      )
    )
  );

create policy "dokumente_storage_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'dokumente'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
