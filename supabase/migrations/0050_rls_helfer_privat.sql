-- RLS-Helfer aus der REST-API nehmen, auth.uid() einmal pro Abfrage
-- auswerten, Policies auf angemeldete Nutzer beschränken.
--
-- Drei Befunde des Supabase-Linters vom 17.10.2026 in einem Zug, weil alle
-- drei dieselben Policies anfassen:
--
-- 1. Die elf SECURITY-DEFINER-Helfer lagen in `public` und waren damit als
--    /rest/v1/rpc/... erreichbar - auch ohne Anmeldung, nur mit dem
--    öffentlichen anon-Key aus dem Frontend (vor dieser Migration geprüft:
--    HTTP 200). Sie wandern in ein eigenes Schema `private`, das PostgREST
--    nicht ausliefert. `revoke execute` allein wäre der falsche Fix gewesen:
--    Policy-Ausdrücke laufen mit den Rechten der aufrufenden Rolle, ohne
--    EXECUTE schlüge jede Abfrage fehl. `authenticated` behält deshalb
--    EXECUTE, nur die REST-Erreichbarkeit fällt weg.
--
--    `alter function ... set schema` reicht dafür: Policies und der Trigger
--    speichern die Funktion intern über ihre OID, nicht über den Namen. Die
--    Funktionskörper sprechen ihre Tabellen bereits voll qualifiziert an
--    (`public.profiles`) und rufen sich nicht gegenseitig auf - geprüft über
--    pg_proc.prosrc. Der Suchpfad `public, pg_temp` aus 0049 bleibt gültig.
--
-- 2. `auth.uid()` wurde in 79 Policies pro Zeile ausgewertet
--    (auth_rls_initplan). `(select auth.uid())` ist semantisch identisch,
--    Postgres rechnet es aber einmal pro Abfrage aus. Dasselbe für die drei
--    Helfer ohne Argumente (current_user_partei/_ebenen/_fraktion). Die
--    Helfer mit Zeilenargumenten (z. B. gliederung_matches(ebene, ...))
--    lassen sich so nicht herausziehen und bleiben pro Zeile. Ebenso
--    `ebene = ANY (current_user_ebenen())`: mit `(select ...)` darin liest
--    Postgres ANY als Vergleich gegen eine Ergebnismenge statt gegen ein
--    Array (text = text[], Fehler) - dort bleibt es beim direkten Aufruf.
--
-- 3. 71 Policies galten für alle Rollen statt nur für `authenticated`. Für
--    die meisten war das nur unnötige Arbeit (auth.uid() ist für anon null),
--    `summaries_select_shared` hätte aber jede als „geteilt" markierte
--    Zusammenfassung für nicht angemeldete Aufrufer lesbar gemacht - die
--    Policy prüft nur `sichtbarkeit = 'geteilt'`. Zum Zeitpunkt dieser
--    Migration gab es 0 solche Einträge, es ist also nichts abgeflossen.
--    Die einzige Policy, die bewusst für anon gilt
--    (kontakt_anfragen_insert_all, Kontaktformular), bleibt unverändert.
--
-- Die Policy-Texte unten sind aus pg_policies erzeugt, nicht von Hand
-- geschrieben - nur die drei Ersetzungen oben, sonst Zeichen für Zeichen der
-- Bestand. Verifiziert wurde vorher und nachher mit einer
-- Sichtbarkeits-Momentaufnahme: für jedes Konto und für anon die Zahl der
-- über RLS sichtbaren Zeilen in jeder Tabelle (inkl. storage.objects).
-- Fingerabdruck vorher = nachher, siehe docs/CHANGELOG.md.
--
-- Neue Helfer gehören ab jetzt nach `private` (mit `set search_path =
-- public, pg_temp`), neue Policies rufen sie als `private.<name>(...)` auf
-- und bekommen `to authenticated`.


-- 1. Schema und Funktionen -------------------------------------------------

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role, supabase_auth_admin;

alter function public.antrag_gehoert_nutzer(uuid, uuid) set schema private;
alter function public.antrag_ist_geteilt_mit(uuid, uuid) set schema private;
alter function public.current_user_ebenen() set schema private;
alter function public.current_user_fraktion() set schema private;
alter function public.current_user_gliederung_matches(text, text) set schema private;
alter function public.current_user_partei() set schema private;
alter function public.dokument_gehoert_nutzer(uuid, uuid) set schema private;
alter function public.dokument_ist_geteilt_mit(uuid, uuid) set schema private;
alter function public.todo_gehoert_nutzer(uuid, uuid) set schema private;
alter function public.todo_hat_platzierung(uuid, uuid) set schema private;
-- Trigger-Funktion für neue Konten (on_auth_user_created auf auth.users).
alter function public.handle_new_user() set schema private;


-- 2./3. Policies -------------------------------------------------------------

alter policy dokumente_storage_delete_own on storage.objects
  using (((bucket_id = 'dokumente'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

alter policy dokumente_storage_insert_own on storage.objects
  with check (((bucket_id = 'dokumente'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

alter policy dokumente_storage_select_own_or_shared on storage.objects
  using (((bucket_id = 'dokumente'::text) AND (((storage.foldername(name))[1] = ((select auth.uid()))::text) OR (EXISTS ( SELECT 1
   FROM (dokumente d
     JOIN profiles uploader ON ((uploader.id = d.user_id)))
  WHERE ((d.datei_url = objects.name) AND (d.sichtbarkeit = 'geteilt'::text) AND (uploader.partei IS NOT NULL) AND (uploader.partei = (select private.current_user_partei())) AND (d.ebene = ANY (private.current_user_ebenen())) AND private.current_user_gliederung_matches(d.ebene, d.gliederung)))) OR (EXISTS ( SELECT 1
   FROM dokumente d
  WHERE ((d.datei_url = objects.name) AND (d.sichtbarkeit = 'einzelpersonen'::text) AND private.dokument_ist_geteilt_mit(d.id, (select auth.uid()))))))));

alter policy profilbilder_delete_own on storage.objects
  using (((bucket_id = 'profilbilder'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

alter policy profilbilder_insert_own on storage.objects
  with check (((bucket_id = 'profilbilder'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

alter policy profilbilder_select_own on storage.objects
  using (((bucket_id = 'profilbilder'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

alter policy zusammenfassungen_delete_own on storage.objects
  using (((bucket_id = 'zusammenfassungen'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

alter policy zusammenfassungen_insert_own on storage.objects
  with check (((bucket_id = 'zusammenfassungen'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

alter policy zusammenfassungen_select_own on storage.objects
  using (((bucket_id = 'zusammenfassungen'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

alter policy antraege_delete_own on public.antraege
  to authenticated
  using ((user_id = (select auth.uid())));

alter policy antraege_insert_own on public.antraege
  to authenticated
  with check ((user_id = (select auth.uid())));

alter policy antraege_select_own_or_shared on public.antraege
  to authenticated
  using (((user_id = (select auth.uid())) OR private.antrag_ist_geteilt_mit(id, (select auth.uid()))));

alter policy antraege_update_own_or_shared on public.antraege
  to authenticated
  using (((user_id = (select auth.uid())) OR private.antrag_ist_geteilt_mit(id, (select auth.uid()))));

alter policy antrag_comments_delete on public.antrag_comments
  to authenticated
  using ((private.antrag_gehoert_nutzer(antrag_id, (select auth.uid())) OR private.antrag_ist_geteilt_mit(antrag_id, (select auth.uid()))));

alter policy antrag_comments_insert on public.antrag_comments
  to authenticated
  with check (((user_id = (select auth.uid())) AND (private.antrag_gehoert_nutzer(antrag_id, (select auth.uid())) OR private.antrag_ist_geteilt_mit(antrag_id, (select auth.uid())))));

alter policy antrag_comments_select on public.antrag_comments
  to authenticated
  using ((private.antrag_gehoert_nutzer(antrag_id, (select auth.uid())) OR private.antrag_ist_geteilt_mit(antrag_id, (select auth.uid()))));

alter policy antrag_deadline_settings_manage_own on public.antrag_deadline_settings
  to authenticated
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy antrag_shares_delete on public.antrag_shares
  to authenticated
  using (((user_id = (select auth.uid())) OR private.antrag_gehoert_nutzer(antrag_id, (select auth.uid()))));

alter policy antrag_shares_insert_by_owner on public.antrag_shares
  to authenticated
  with check ((private.antrag_gehoert_nutzer(antrag_id, (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM (antraege a
     JOIN profiles target ON ((target.id = antrag_shares.user_id)))
  WHERE ((a.id = antrag_shares.antrag_id) AND (a.ebene IS NOT NULL) AND (target.partei = (select private.current_user_partei())) AND (target.ebenen && ARRAY[a.ebene]))))));

alter policy antrag_shares_select on public.antrag_shares
  to authenticated
  using (((user_id = (select auth.uid())) OR private.antrag_gehoert_nutzer(antrag_id, (select auth.uid())) OR private.antrag_ist_geteilt_mit(antrag_id, (select auth.uid()))));

alter policy calendar_sources_delete_own_or_shared_admin on public.calendar_sources
  to authenticated
  using (((verwaltet_von = (select auth.uid())) OR ((verwaltet_von IS NULL) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.rolle = 'admin'::text)))))));

alter policy calendar_sources_insert_own on public.calendar_sources
  with check ((verwaltet_von = (select auth.uid())));

alter policy calendar_sources_select_shared_or_own on public.calendar_sources
  using (((verwaltet_von IS NULL) OR (verwaltet_von = (select auth.uid()))));

alter policy calendar_sources_update_own_or_shared_admin on public.calendar_sources
  to authenticated
  using (((verwaltet_von = (select auth.uid())) OR ((verwaltet_von IS NULL) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.rolle = 'admin'::text)))))));

alter policy dokument_gelesen_manage_own on public.dokument_gelesen
  to authenticated
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy dokument_shares_delete on public.dokument_shares
  to authenticated
  using (((user_id = (select auth.uid())) OR private.dokument_gehoert_nutzer(dokument_id, (select auth.uid()))));

alter policy dokument_shares_insert_by_owner on public.dokument_shares
  to authenticated
  with check ((private.dokument_gehoert_nutzer(dokument_id, (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM profiles target
  WHERE ((target.id = dokument_shares.user_id) AND (target.partei = (select private.current_user_partei())))))));

alter policy dokument_shares_select on public.dokument_shares
  to authenticated
  using (((user_id = (select auth.uid())) OR private.dokument_gehoert_nutzer(dokument_id, (select auth.uid())) OR private.dokument_ist_geteilt_mit(dokument_id, (select auth.uid()))));

alter policy dokumente_delete_own on public.dokumente
  to authenticated
  using ((user_id = (select auth.uid())));

alter policy dokumente_insert_own on public.dokumente
  to authenticated
  with check ((user_id = (select auth.uid())));

alter policy dokumente_select_own on public.dokumente
  to authenticated
  using ((user_id = (select auth.uid())));

alter policy dokumente_select_shared on public.dokumente
  to authenticated
  using (((sichtbarkeit = 'geteilt'::text) AND (EXISTS ( SELECT 1
   FROM profiles uploader
  WHERE ((uploader.id = dokumente.user_id) AND (uploader.partei IS NOT NULL) AND (uploader.partei = (select private.current_user_partei()))))) AND (ebene = ANY (private.current_user_ebenen())) AND private.current_user_gliederung_matches(ebene, gliederung)));

alter policy dokumente_select_via_share on public.dokumente
  to authenticated
  using (private.dokument_ist_geteilt_mit(id, (select auth.uid())));

alter policy dokumente_update_own on public.dokumente
  to authenticated
  using ((user_id = (select auth.uid())));

alter policy events_delete_own on public.events
  to authenticated
  using ((user_id = (select auth.uid())));

alter policy events_insert_own_or_fraktionsbuero on public.events
  to authenticated
  with check (((user_id = (select auth.uid())) OR ((EXISTS ( SELECT 1
   FROM profiles me
  WHERE ((me.id = (select auth.uid())) AND (me.rolle = 'fraktionsbuero'::text)))) AND (EXISTS ( SELECT 1
   FROM profiles target
  WHERE ((target.id = events.user_id) AND (target.fraktion = ( SELECT profiles.fraktion
           FROM profiles
          WHERE (profiles.id = (select auth.uid()))))))))));

alter policy events_select_own on public.events
  to authenticated
  using ((user_id = (select auth.uid())));

alter policy events_update_own on public.events
  to authenticated
  using ((user_id = (select auth.uid())));

alter policy fakten_delete_own on public.fakten
  to authenticated
  using ((user_id = (select auth.uid())));

alter policy fakten_insert_own on public.fakten
  to authenticated
  with check ((user_id = (select auth.uid())));

alter policy fakten_select_own on public.fakten
  to authenticated
  using ((user_id = (select auth.uid())));

alter policy fakten_select_shared on public.fakten
  to authenticated
  using (((sichtbarkeit = 'geteilt'::text) AND (EXISTS ( SELECT 1
   FROM profiles ersteller
  WHERE ((ersteller.id = fakten.user_id) AND (ersteller.partei IS NOT NULL) AND (ersteller.partei = (select private.current_user_partei()))))) AND (ebene = ANY (private.current_user_ebenen())) AND private.current_user_gliederung_matches(ebene, gliederung)));

alter policy fakten_update_own on public.fakten
  to authenticated
  using ((user_id = (select auth.uid())));

alter policy kontakt_anfragen_delete_admin on public.kontakt_anfragen
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.rolle = 'admin'::text)))));

alter policy kontakt_anfragen_select_admin on public.kontakt_anfragen
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.rolle = 'admin'::text)))));

alter policy kontakt_anfragen_update_admin on public.kontakt_anfragen
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.rolle = 'admin'::text)))));

alter policy mcp_tokens_manage_own on public.mcp_tokens
  to authenticated
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy mcp_upload_chunks_manage_via_upload on public.mcp_upload_chunks
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM mcp_uploads u
  WHERE ((u.id = mcp_upload_chunks.upload_id) AND (u.user_id = (select auth.uid()))))))
  with check ((EXISTS ( SELECT 1
   FROM mcp_uploads u
  WHERE ((u.id = mcp_upload_chunks.upload_id) AND (u.user_id = (select auth.uid()))))));

alter policy mcp_uploads_manage_own on public.mcp_uploads
  to authenticated
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy presseschauen_manage_own on public.presseschauen
  to authenticated
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy profiles_select_own_or_same_fraktion on public.profiles
  to authenticated
  using (((id = (select auth.uid())) OR (fraktion = (select private.current_user_fraktion()))));

alter policy profiles_select_same_partei_ebene on public.profiles
  to authenticated
  using (((partei IS NOT NULL) AND (partei = (select private.current_user_partei())) AND (ebenen && (select private.current_user_ebenen()))));

alter policy profiles_update_own on public.profiles
  to authenticated
  using ((id = (select auth.uid())));

alter policy sessions_delete_own_manuell on public.sessions
  to authenticated
  using ((erstellt_von = (select auth.uid())));

alter policy sessions_insert_manuell on public.sessions
  with check (((erstellt_von = (select auth.uid())) AND ((source_id IS NULL) OR (EXISTS ( SELECT 1
   FROM calendar_sources cs
  WHERE ((cs.id = sessions.source_id) AND ((cs.verwaltet_von IS NULL) OR (cs.verwaltet_von = (select auth.uid())))))))));

alter policy sessions_select_visible_source on public.sessions
  using (((source_id IS NULL) OR (EXISTS ( SELECT 1
   FROM calendar_sources cs
  WHERE ((cs.id = sessions.source_id) AND ((cs.verwaltet_von IS NULL) OR (cs.verwaltet_von = (select auth.uid()))))))));

alter policy sessions_update_own_manuell on public.sessions
  to authenticated
  using ((erstellt_von = (select auth.uid())))
  with check (((erstellt_von = (select auth.uid())) AND ((source_id IS NULL) OR (EXISTS ( SELECT 1
   FROM calendar_sources cs
  WHERE ((cs.id = sessions.source_id) AND ((cs.verwaltet_von IS NULL) OR (cs.verwaltet_von = (select auth.uid())))))))));

alter policy sitzung_dokumente_delete on public.sitzung_dokumente
  to authenticated
  using ((((dokument_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM dokumente d
  WHERE ((d.id = sitzung_dokumente.dokument_id) AND (d.user_id = (select auth.uid())))))) OR ((dokument_id IS NULL) AND (EXISTS ( SELECT 1
   FROM sessions s
  WHERE ((s.id = sitzung_dokumente.session_id) AND (s.erstellt_von = (select auth.uid()))))))));

alter policy sitzung_dokumente_insert on public.sitzung_dokumente
  to authenticated
  with check ((((dokument_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM dokumente d
  WHERE ((d.id = sitzung_dokumente.dokument_id) AND (d.user_id = (select auth.uid())))))) OR ((dokument_id IS NULL) AND (EXISTS ( SELECT 1
   FROM sessions s
  WHERE ((s.id = sitzung_dokumente.session_id) AND (s.erstellt_von = (select auth.uid()))))))));

alter policy sitzung_dokumente_select on public.sitzung_dokumente
  to authenticated
  using ((((dokument_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM dokumente d
  WHERE (d.id = sitzung_dokumente.dokument_id)))) OR ((dokument_id IS NULL) AND (EXISTS ( SELECT 1
   FROM sessions s
  WHERE (s.id = sitzung_dokumente.session_id))))));

alter policy summaries_delete_via_antrag_share on public.summaries
  to authenticated
  using (((antrag_id IS NOT NULL) AND (private.antrag_gehoert_nutzer(antrag_id, (select auth.uid())) OR private.antrag_ist_geteilt_mit(antrag_id, (select auth.uid())))));

alter policy summaries_delete_via_todo_placement on public.summaries
  to authenticated
  using (((todo_id IS NOT NULL) AND private.todo_hat_platzierung(todo_id, (select auth.uid()))));

alter policy summaries_manage_own on public.summaries
  to authenticated
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy summaries_select_shared on public.summaries
  to authenticated
  using ((sichtbarkeit = 'geteilt'::text));

alter policy summaries_select_via_antrag_share on public.summaries
  to authenticated
  using (((antrag_id IS NOT NULL) AND (private.antrag_gehoert_nutzer(antrag_id, (select auth.uid())) OR private.antrag_ist_geteilt_mit(antrag_id, (select auth.uid())))));

alter policy summaries_select_via_todo_placement on public.summaries
  to authenticated
  using (((todo_id IS NOT NULL) AND private.todo_hat_platzierung(todo_id, (select auth.uid()))));

alter policy todo_board_settings_manage_own on public.todo_board_settings
  to authenticated
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy todo_columns_manage_own on public.todo_columns
  to authenticated
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy todo_comments_delete_via_placement on public.todo_comments
  to authenticated
  using (private.todo_hat_platzierung(todo_id, (select auth.uid())));

alter policy todo_comments_insert_via_placement on public.todo_comments
  to authenticated
  with check (((user_id = (select auth.uid())) AND private.todo_hat_platzierung(todo_id, (select auth.uid()))));

alter policy todo_comments_select_via_placement on public.todo_comments
  to authenticated
  using (private.todo_hat_platzierung(todo_id, (select auth.uid())));

alter policy todo_dokumente_delete on public.todo_dokumente
  to authenticated
  using (((EXISTS ( SELECT 1
   FROM todos t
  WHERE ((t.id = todo_dokumente.todo_id) AND ((t.user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM todo_placements tp
          WHERE ((tp.todo_id = t.id) AND (tp.user_id = (select auth.uid()))))))))) OR (EXISTS ( SELECT 1
   FROM dokumente d
  WHERE ((d.id = todo_dokumente.dokument_id) AND (d.user_id = (select auth.uid())))))));

alter policy todo_dokumente_insert on public.todo_dokumente
  to authenticated
  with check (((EXISTS ( SELECT 1
   FROM todos t
  WHERE ((t.id = todo_dokumente.todo_id) AND ((t.user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM todo_placements tp
          WHERE ((tp.todo_id = t.id) AND (tp.user_id = (select auth.uid()))))))))) OR (EXISTS ( SELECT 1
   FROM dokumente d
  WHERE ((d.id = todo_dokumente.dokument_id) AND (d.user_id = (select auth.uid())))))));

alter policy todo_dokumente_select on public.todo_dokumente
  to authenticated
  using (((EXISTS ( SELECT 1
   FROM dokumente d
  WHERE (d.id = todo_dokumente.dokument_id))) OR (EXISTS ( SELECT 1
   FROM todos t
  WHERE ((t.id = todo_dokumente.todo_id) AND ((t.user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM todo_placements tp
          WHERE ((tp.todo_id = t.id) AND (tp.user_id = (select auth.uid())))))))))));

alter policy todo_placements_delete on public.todo_placements
  to authenticated
  using (((user_id = (select auth.uid())) OR private.todo_gehoert_nutzer(todo_id, (select auth.uid()))));

alter policy todo_placements_insert_own on public.todo_placements
  to authenticated
  with check ((user_id = (select auth.uid())));

alter policy todo_placements_select on public.todo_placements
  to authenticated
  using (((user_id = (select auth.uid())) OR private.todo_gehoert_nutzer(todo_id, (select auth.uid())) OR private.todo_hat_platzierung(todo_id, (select auth.uid()))));

alter policy todo_placements_update_own on public.todo_placements
  to authenticated
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy todos_delete_own on public.todos
  to authenticated
  using ((user_id = (select auth.uid())));

alter policy todos_insert_own on public.todos
  to authenticated
  with check ((user_id = (select auth.uid())));

alter policy todos_select_own_or_placed on public.todos
  to authenticated
  using (((user_id = (select auth.uid())) OR private.todo_hat_platzierung(id, (select auth.uid()))));

alter policy todos_update_own_or_placed on public.todos
  to authenticated
  using (((user_id = (select auth.uid())) OR private.todo_hat_platzierung(id, (select auth.uid()))));

alter policy user_gremien_manage_own on public.user_gremien
  to authenticated
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy subscriptions_manage_own on public.user_source_subscriptions
  to authenticated
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));


-- 4. Ausführungsrechte -------------------------------------------------------
-- anon wertet nach Schritt 3 keine Policy mit diesen Helfern mehr aus und
-- braucht sie nicht. authenticated behält EXECUTE (Policy-Ausdrücke laufen
-- mit den Rechten der aufrufenden Rolle). Die Trigger-Funktion ruft nur der
-- Auth-Dienst über den Trigger auf.

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
revoke execute on function private.handle_new_user() from authenticated;
grant execute on function private.handle_new_user() to supabase_auth_admin;

-- Künftige Funktionen in private: kein EXECUTE für alle per Voreinstellung.
alter default privileges in schema private revoke execute on functions from public;


-- 5. Sicherheitsnetz ---------------------------------------------------------
-- Bricht ab, wenn (a) eine SECURITY-DEFINER-Funktion in public oder private
-- ohne festen Suchpfad existiert (Regel aus 0049, jetzt auch für private),
-- (b) noch eine SECURITY-DEFINER-Funktion in public liegt - dort wäre sie
-- wieder per REST erreichbar - oder (c) eine Policy noch auth.uid() ohne
-- umschließendes select enthält.
do $$
declare
  offen text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into offen
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosecdef and p.proconfig is null;
  if offen is not null then
    raise exception 'SECURITY-DEFINER-Funktion ohne search_path: %', offen;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ') into offen
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef;
  if offen is not null then
    raise exception 'SECURITY-DEFINER-Funktion in public (per REST erreichbar): %', offen;
  end if;

  select string_agg(schemaname || '.' || tablename || '.' || policyname, ', ') into offen
  from pg_policies
  where regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                       '\(\s*SELECT auth\.uid\(\) AS uid\)', '', 'gi') ~ 'auth\.uid\(\)';
  if offen is not null then
    raise exception 'Policy wertet auth.uid() pro Zeile aus: %', offen;
  end if;

  raise notice 'RLS-Helfer liegen in private, alle Policies werten auth.uid() einmal pro Abfrage aus.';
end $$;
