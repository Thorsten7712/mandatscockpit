-- Ein Dokument kann an MEHREREN Sitzungen hängen.
--
-- Anlass: Eine Verwaltungsvorlage durchläuft typischerweise mehrere Gremien -
-- erst den Fachausschuss, dann den Rat (z. B. Finanzausschuss 07.10., Rat
-- 13.10.). Die bisherige Spalte dokumente.session_id (0036) kannte nur eine
-- Sitzung, und update_document_session hat sie überschrieben: faktisch gewann
-- immer die zuletzt gesetzte. Für den geplanten Tagesordnungs-Import aus ALLRIS
-- ist das unbrauchbar.
--
-- Aufbau nach dem Muster von todo_dokumente (0037): reine Verknüpfungstabelle
-- ohne eigene user_id - die Zeile trägt keine eigene Sichtbarkeit, die richtet
-- sich nach dem Zugriff auf das Dokument.
create table public.sitzung_dokumente (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  dokument_id uuid not null references public.dokumente(id) on delete cascade,
  erstellt_am timestamptz not null default now(),
  unique (session_id, dokument_id)
);

alter table public.sitzung_dokumente enable row level security;

-- SELECT: sichtbar, wer das Dokument sehen darf. Die Subquery gegen dokumente
-- läuft NICHT als SECURITY DEFINER und wird daher automatisch durch
-- dokumente_select_own/_shared gefiltert (Standard-RLS-Komposition, gleiches
-- Vorgehen wie todo_dokumente_select). Sitzungen sind ohnehin breiter sichtbar
-- als Dokumente, deshalb hängt die Sichtbarkeit allein am Dokument.
create policy "sitzung_dokumente_select"
  on public.sitzung_dokumente for select
  using (exists (select 1 from public.dokumente d where d.id = dokument_id));

-- INSERT/DELETE strikt beim Eigentümer des Dokuments - analog
-- dokumente_update_own. Eine geteilte Leseansicht berechtigt nicht dazu,
-- fremde Dokumente an Sitzungen zu hängen.
create policy "sitzung_dokumente_insert"
  on public.sitzung_dokumente for insert
  with check (exists (select 1 from public.dokumente d where d.id = dokument_id and d.user_id = auth.uid()));

create policy "sitzung_dokumente_delete"
  on public.sitzung_dokumente for delete
  using (exists (select 1 from public.dokumente d where d.id = dokument_id and d.user_id = auth.uid()));

-- Bestehende 1:1-Verknüpfungen übernehmen.
insert into public.sitzung_dokumente (session_id, dokument_id)
select d.session_id, d.id from public.dokumente d where d.session_id is not null
on conflict (session_id, dokument_id) do nothing;

-- Sicherheitsnetz: Die Spalte wird gleich gedroppt, deshalb muss die Übernahme
-- nachweislich vollständig sein. Migrationen laufen in einer Transaktion - bei
-- einer Abweichung bricht hier alles ab und nichts wird angewendet.
do $$
declare
  vorher integer;
  nachher integer;
begin
  select count(*) into vorher from public.dokumente where session_id is not null;
  select count(*) into nachher from public.sitzung_dokumente;
  if vorher <> nachher then
    raise exception 'Übernahme unvollständig: % Spaltenwerte, aber % Zeilen in sitzung_dokumente', vorher, nachher;
  end if;
end $$;

-- Genau eine Quelle der Wahrheit: Die alte Spalte entfällt, sonst driften
-- beide Stände auseinander, sobald jemand noch die Spalte liest oder schreibt.
alter table public.dokumente drop column session_id;
