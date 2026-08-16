-- Notizen/Analyse-Dokumente an ein bestehendes (geteiltes) Dokument hängen,
-- statt sie als unabhängige "persönliche Dokumente" in einer eigenen Liste
-- zu verwalten (Nutzerwunsch: das Politikbüro erstellt Einschätzungen zu
-- konkreten Sitzungsvorlagen, die sollen direkt an der Vorlage sichtbar
-- sein, siehe docs/CHANGELOG.md). Zusätzlich: diese angehängten Notizen/
-- Dokumente sollen nicht nur privat oder Ebene-weit, sondern auch mit
-- einzelnen ausgewählten Personen teilbar sein.

-- null = Top-Level-Dokument (bisheriges Verhalten, z. B. eine
-- Sitzungsvorlage), gesetzt = eine an dieses Dokument gehängte Notiz/Analyse.
alter table public.dokumente
  add column parent_id uuid references public.dokumente(id) on delete cascade;

alter table public.dokumente drop constraint dokumente_sichtbarkeit_check;
alter table public.dokumente
  add constraint dokumente_sichtbarkeit_check
  check (sichtbarkeit in ('persoenlich', 'geteilt', 'einzelpersonen'));

-- ─────────────────────────────────────────────────────────────
-- Teilen mit einzelnen Personen (1:1 nach dem Muster von antrag_shares,
-- siehe 0023_antraege_sharing_status_fristen.sql) - nur relevant für
-- sichtbarkeit='einzelpersonen'. Bei sichtbarkeit='geteilt' übernehmen
-- ebene/gliederung beim Anlegen automatisch die Werte des Elternteils
-- (Frontend/MCP kopieren sie 1:1), wodurch die bestehende
-- dokumente_select_shared-Policy dafür unverändert weiterfunktioniert -
-- hier ist deshalb keine RLS-Änderung für den "ganze Ebene"-Fall nötig.
-- ─────────────────────────────────────────────────────────────
create table public.dokument_shares (
  id uuid primary key default gen_random_uuid(),
  dokument_id uuid not null references public.dokumente(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  unique (dokument_id, user_id)
);

alter table public.dokument_shares enable row level security;

create or replace function public.dokument_gehoert_nutzer(p_dokument_id uuid, p_user_id uuid)
returns boolean as $$
  select exists (select 1 from public.dokumente where id = p_dokument_id and user_id = p_user_id);
$$ language sql security definer stable;

create or replace function public.dokument_ist_geteilt_mit(p_dokument_id uuid, p_user_id uuid)
returns boolean as $$
  select exists (select 1 from public.dokument_shares where dokument_id = p_dokument_id and user_id = p_user_id);
$$ language sql security definer stable;

create policy "dokumente_select_via_share"
  on public.dokumente for select
  using (public.dokument_ist_geteilt_mit(id, auth.uid()));

create policy "dokument_shares_select"
  on public.dokument_shares for select
  using (
    user_id = auth.uid()
    or public.dokument_gehoert_nutzer(dokument_id, auth.uid())
    or public.dokument_ist_geteilt_mit(dokument_id, auth.uid())
  );

-- Kandidaten haben keine eigene Ebene (Kinder tragen keine ebene) - die
-- Kandidatenliste im Frontend ist ohnehin schon über
-- profiles_select_same_partei_ebene (0020_profiles_ebenen.sql) auf
-- Partei+Ebene-Überschneidung mit dem AUFRUFER begrenzt, hier reicht als
-- zusätzliche Absicherung der Partei-Abgleich.
create policy "dokument_shares_insert_by_owner"
  on public.dokument_shares for insert
  with check (
    public.dokument_gehoert_nutzer(dokument_id, auth.uid())
    and exists (
      select 1 from public.profiles target
      where target.id = dokument_shares.user_id
        and target.partei = public.current_user_partei()
    )
  );

create policy "dokument_shares_delete"
  on public.dokument_shares for delete
  using (user_id = auth.uid() or public.dokument_gehoert_nutzer(dokument_id, auth.uid()));

-- Storage-Select-Policy für "dokumente" (0033) muss um denselben
-- Freigabe-Weg ergänzt werden, sonst lässt sich die angehängte Datei zwar
-- in der DB sehen, aber keine signierte URL dafür erzeugen.
drop policy "dokumente_storage_select_own_or_shared" on storage.objects;
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
      or exists (
        select 1 from public.dokumente d
        where d.datei_url = storage.objects.name
          and d.sichtbarkeit = 'einzelpersonen'
          and public.dokument_ist_geteilt_mit(d.id, auth.uid())
      )
    )
  );
