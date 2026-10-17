-- Indizes für die 34 Fremdschlüssel ohne passenden Index
-- (Supabase-Linter, unindexed_foreign_keys, 17.10.2026).
--
-- Spürbar wird das beim Löschen in der Elterntabelle: Jede gelöschte Zeile
-- durchsucht die Kindtabellen nach Verweisen (ON DELETE CASCADE / SET NULL /
-- Prüfung), ohne Index jeweils komplett. Bei der heutigen Datenmenge sind das
-- Millisekunden - die 20 Löschungen in 0047 liefen unauffällig -, aber die
-- user_id-Spalten tragen zugleich die häufigste RLS-Bedingung
-- (`user_id = (select auth.uid())`), und davon profitieren die Indizes auch.
--
-- Erzeugt aus pg_constraint, nicht von Hand: alle Fremdschlüssel in public,
-- deren Spalten nicht am Anfang eines bestehenden Index stehen. Alle 34 sind
-- einspaltig. Ohne CONCURRENTLY, weil Migrationen in einer Transaktion
-- laufen; die Tabellen sind klein genug, dass die kurze Schreibsperre nicht
-- auffällt.

create index if not exists antraege_session_id_idx on public.antraege (session_id);
create index if not exists antraege_user_id_idx on public.antraege (user_id);
create index if not exists antrag_comments_antrag_id_idx on public.antrag_comments (antrag_id);
create index if not exists antrag_comments_user_id_idx on public.antrag_comments (user_id);
create index if not exists antrag_shares_user_id_idx on public.antrag_shares (user_id);
create index if not exists calendar_sources_verwaltet_von_idx on public.calendar_sources (verwaltet_von);
create index if not exists documents_session_id_idx on public.documents (session_id);
create index if not exists dokument_gelesen_user_id_idx on public.dokument_gelesen (user_id);
create index if not exists dokument_shares_user_id_idx on public.dokument_shares (user_id);
create index if not exists dokumente_parent_id_idx on public.dokumente (parent_id);
create index if not exists dokumente_user_id_idx on public.dokumente (user_id);
create index if not exists events_erstellt_von_idx on public.events (erstellt_von);
create index if not exists events_user_id_idx on public.events (user_id);
create index if not exists fakten_user_id_idx on public.fakten (user_id);
create index if not exists mcp_uploads_user_id_idx on public.mcp_uploads (user_id);
create index if not exists sessions_erstellt_von_idx on public.sessions (erstellt_von);
create index if not exists sitzung_dokumente_dokument_id_idx on public.sitzung_dokumente (dokument_id);
create index if not exists summaries_antrag_id_idx on public.summaries (antrag_id);
create index if not exists summaries_document_id_idx on public.summaries (document_id);
create index if not exists summaries_event_id_idx on public.summaries (event_id);
create index if not exists summaries_session_id_idx on public.summaries (session_id);
create index if not exists summaries_todo_id_idx on public.summaries (todo_id);
create index if not exists summaries_user_id_idx on public.summaries (user_id);
create index if not exists todo_columns_user_id_idx on public.todo_columns (user_id);
create index if not exists todo_comments_todo_id_idx on public.todo_comments (todo_id);
create index if not exists todo_comments_user_id_idx on public.todo_comments (user_id);
create index if not exists todo_dokumente_dokument_id_idx on public.todo_dokumente (dokument_id);
create index if not exists todo_placements_column_id_idx on public.todo_placements (column_id);
create index if not exists todo_placements_user_id_idx on public.todo_placements (user_id);
create index if not exists todos_dokument_id_idx on public.todos (dokument_id);
create index if not exists todos_event_id_idx on public.todos (event_id);
create index if not exists todos_session_id_idx on public.todos (session_id);
create index if not exists todos_user_id_idx on public.todos (user_id);
create index if not exists user_source_subscriptions_source_id_idx on public.user_source_subscriptions (source_id);

-- Sicherheitsnetz: `if not exists` prüft nur den Namen. Läge unter einem
-- dieser Namen schon ein Index auf einer anderen Spalte, wäre die Zeile oben
-- stillschweigend übersprungen worden - deshalb hier nachzählen, ob noch ein
-- Fremdschlüssel in public ohne passenden Index übrig ist. Fällt auch auf,
-- wenn später ein neuer Fremdschlüssel ohne Index dazukommt und diese Datei
-- erneut läuft.
do $$
declare
  offen text;
begin
  select string_agg(c.conrelid::regclass || '.' || c.conname, ', ') into offen
  from pg_constraint c
  join pg_namespace n on n.oid = c.connamespace
  where c.contype = 'f' and n.nspname = 'public'
    and not exists (
      select 1 from pg_index i
      where i.indrelid = c.conrelid
        and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
        and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey);
  if offen is not null then
    raise exception 'Fremdschlüssel ohne Index: %', offen;
  end if;

  raise notice 'Alle Fremdschlüssel in public haben einen passenden Index.';
end $$;
