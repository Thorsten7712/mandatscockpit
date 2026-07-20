-- Anträge: Workflow überarbeitet, Teilen mit Kolleg*innen (gleiches Muster
-- wie ToDo-Karten, siehe 0021/0022), und konfigurierbare Einreichungsfristen
-- pro Ebene.

-- ─────────────────────────────────────────────────────────────
-- Status-Vokabular: 'eingereicht' -> 'gestellt' (Standard-Sprachgebrauch
-- "einen Antrag stellen"). 'beschlossen'/'abgelehnt' werden zu einem
-- gemeinsamen Status 'abgestimmt' mit separatem Ergebnis-Feld
-- (positiv/negativ) - beide waren dieselbe Phase ("im Ausschuss
-- abgestimmt"), unterscheiden sich nur im Ausgang (Badge-Farbe rot/grün).
-- Ergebnis-Backfill muss VOR der Status-Umbenennung laufen, solange die
-- WHERE-Klauseln noch auf die alten Statuswerte matchen.
-- ─────────────────────────────────────────────────────────────
alter table public.antraege add column ergebnis text check (ergebnis in ('positiv', 'negativ'));

update public.antraege set ergebnis = 'positiv' where status = 'beschlossen';
update public.antraege set ergebnis = 'negativ' where status = 'abgelehnt';
update public.antraege set status = 'gestellt' where status = 'eingereicht';
update public.antraege set status = 'abgestimmt' where status in ('beschlossen', 'abgelehnt');

-- Name des Check-Constraints aus 0017 ist nicht garantiert bekannt (implizit
-- von Postgres vergeben) - dynamisch alle Check-Constraints auf der
-- status-Spalte finden und droppen statt einen festen Namen zu raten.
do $$
declare
  cons record;
begin
  for cons in
    select conname from pg_constraint
    where conrelid = 'public.antraege'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.antraege drop constraint %I', cons.conname);
  end loop;
end $$;

alter table public.antraege add constraint antraege_status_check
  check (status in ('entwurf', 'gestellt', 'in_beratung', 'vertagt', 'abgestimmt', 'zurueckgezogen'));

-- ─────────────────────────────────────────────────────────────
-- Ebene je Antrag: dient zwei Zwecken - (a) Kandidatenfilter beim Teilen
-- (gleiches Muster wie todos.ebene, siehe 0021), (b) Nachschlage-Schlüssel
-- für die Einreichungsfrist (antrag_deadline_settings unten). Wird beim
-- Verknüpfen einer Sitzung im Frontend automatisch aus deren `ebene`
-- vorbelegt, bleibt aber frei überschreibbar (z. B. bevor eine konkrete
-- Sitzung feststeht).
-- ─────────────────────────────────────────────────────────────
alter table public.antraege add column ebene text check (ebene in ('kommune', 'kreis', 'land', 'bund'));

-- ─────────────────────────────────────────────────────────────
-- Einreichungsfristen: je Nutzer und Ebene eine Anzahl Tage vor der
-- Sitzung (z. B. Kommune = 14). Rein privat, jede*r pflegt die eigenen
-- Fristen in den Settings - andere Mitglieder können andere interne
-- Vorlaufzeiten haben.
-- ─────────────────────────────────────────────────────────────
create table public.antrag_deadline_settings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  ebene text not null check (ebene in ('kommune', 'kreis', 'land', 'bund')),
  tage_vor_sitzung int not null check (tage_vor_sitzung >= 0),
  primary key (user_id, ebene)
);

alter table public.antrag_deadline_settings enable row level security;

create policy "antrag_deadline_settings_manage_own"
  on public.antrag_deadline_settings for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- Teilen mit Kolleg*innen (volle Gleichberechtigung, exakt gleiches Muster
-- wie todo_placements/todo_comments in 0021/0022 - nur ohne Board-Position,
-- da Anträge keine Kanban-Spalten haben, reine Sichtbarkeits-/Bearbeitungs-
-- Freigabe). SECURITY DEFINER-Helper von Anfang an, um die in 0021->0022
-- durchlaufene "infinite recursion detected in policy"-Falle zu vermeiden.
-- ─────────────────────────────────────────────────────────────
-- Tabelle muss vor antrag_ist_geteilt_mit existieren: SQL-Funktionen (anders
-- als plpgsql) werden bereits beim CREATE FUNCTION gegen das aktuelle Schema
-- geparst, nicht erst beim ersten Aufruf.
create table public.antrag_shares (
  id uuid primary key default gen_random_uuid(),
  antrag_id uuid not null references public.antraege(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  unique (antrag_id, user_id)
);

alter table public.antrag_shares enable row level security;

create or replace function public.antrag_gehoert_nutzer(p_antrag_id uuid, p_user_id uuid)
returns boolean as $$
  select exists (select 1 from public.antraege where id = p_antrag_id and user_id = p_user_id);
$$ language sql security definer stable;

create or replace function public.antrag_ist_geteilt_mit(p_antrag_id uuid, p_user_id uuid)
returns boolean as $$
  select exists (select 1 from public.antrag_shares where antrag_id = p_antrag_id and user_id = p_user_id);
$$ language sql security definer stable;

drop policy "antraege_manage_own" on public.antraege;

create policy "antraege_select_own_or_shared"
  on public.antraege for select
  using (user_id = auth.uid() or public.antrag_ist_geteilt_mit(id, auth.uid()));

create policy "antraege_update_own_or_shared"
  on public.antraege for update
  using (user_id = auth.uid() or public.antrag_ist_geteilt_mit(id, auth.uid()));

create policy "antraege_insert_own"
  on public.antraege for insert
  with check (user_id = auth.uid());

create policy "antraege_delete_own"
  on public.antraege for delete
  using (user_id = auth.uid());

create policy "antrag_shares_select"
  on public.antrag_shares for select
  using (
    user_id = auth.uid()
    or public.antrag_gehoert_nutzer(antrag_id, auth.uid())
    or public.antrag_ist_geteilt_mit(antrag_id, auth.uid())
  );

-- Anders als beim ToDo-Teilen (share-todo Edge Function) reicht hier eine
-- direkte RLS-Insert-Policy: es muss keine private Ressource der Ziel-Person
-- gelesen werden (todo_columns bei ToDos), nur Partei/Ebenen-Übereinstimmung
-- geprüft werden - und profiles_select_same_partei_ebene (0020) erlaubt dem
-- Ersteller bereits, das Zielprofil zu lesen.
create policy "antrag_shares_insert_by_owner"
  on public.antrag_shares for insert
  with check (
    public.antrag_gehoert_nutzer(antrag_id, auth.uid())
    and exists (
      select 1 from public.antraege a
      join public.profiles target on target.id = antrag_shares.user_id
      where a.id = antrag_shares.antrag_id
        and a.ebene is not null
        and target.partei = public.current_user_partei()
        and target.ebenen && array[a.ebene]
    )
  );

create policy "antrag_shares_delete"
  on public.antrag_shares for delete
  using (user_id = auth.uid() or public.antrag_gehoert_nutzer(antrag_id, auth.uid()));

-- antrag_comments: Sichtbarkeit/Schreibrecht folgt jetzt Eigentümerschaft
-- ODER Freigabe statt reiner Eigentümerschaft.
drop policy "antrag_comments_manage_via_antrag_owner" on public.antrag_comments;

create policy "antrag_comments_select"
  on public.antrag_comments for select
  using (
    public.antrag_gehoert_nutzer(antrag_id, auth.uid())
    or public.antrag_ist_geteilt_mit(antrag_id, auth.uid())
  );

create policy "antrag_comments_insert"
  on public.antrag_comments for insert
  with check (
    user_id = auth.uid()
    and (public.antrag_gehoert_nutzer(antrag_id, auth.uid()) or public.antrag_ist_geteilt_mit(antrag_id, auth.uid()))
  );

create policy "antrag_comments_delete"
  on public.antrag_comments for delete
  using (
    public.antrag_gehoert_nutzer(antrag_id, auth.uid())
    or public.antrag_ist_geteilt_mit(antrag_id, auth.uid())
  );

-- summaries: zusätzliche (additive) Policies, damit geteilte Personen auch
-- fremde Antrags-Dokumente sehen/löschen können (gleiches Muster wie
-- summaries_select_via_todo_placement in 0021). Die bestehende
-- summaries_manage_own (0001) deckt weiterhin die eigene Upload-Verwaltung.
create policy "summaries_select_via_antrag_share"
  on public.summaries for select
  using (
    antrag_id is not null
    and (public.antrag_gehoert_nutzer(antrag_id, auth.uid()) or public.antrag_ist_geteilt_mit(antrag_id, auth.uid()))
  );

create policy "summaries_delete_via_antrag_share"
  on public.summaries for delete
  using (
    antrag_id is not null
    and (public.antrag_gehoert_nutzer(antrag_id, auth.uid()) or public.antrag_ist_geteilt_mit(antrag_id, auth.uid()))
  );
