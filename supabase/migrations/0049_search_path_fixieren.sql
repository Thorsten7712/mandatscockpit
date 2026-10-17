-- Suchpfad der SECURITY-DEFINER-Funktionen festnageln.
--
-- Befund des Supabase-Linters (`function_search_path_mutable`, 10 Treffer):
-- Diese Funktionen laufen mit den Rechten ihres Eigentümers, lösen ihre
-- Tabellen aber über den Suchpfad des Aufrufers auf. Wer einen Suchpfad
-- setzen kann, könnte sie damit im Prinzip auf untergeschobene Objekte
-- lenken - und es sind genau die Funktionen, an denen die RLS des ganzen
-- Projekts hängt (`current_user_partei`, `dokument_ist_geteilt_mit`, ...).
--
-- `public, pg_temp` statt nur `public`: pg_temp wird sonst implizit ZUERST
-- durchsucht, sodass eine temporäre Tabelle gleichen Namens die echte
-- verdecken könnte. Explizit ans Ende gestellt, ist das ausgeschlossen (so
-- auch die Postgres-Dokumentation zu SECURITY DEFINER).
--
-- Die Funktionskörper bleiben unangetastet: Sie greifen ausschließlich auf
-- public-Tabellen zu, und das auth-Schema sprechen sie bereits qualifiziert
-- an (`auth.uid()`), was vom Suchpfad unabhängig ist. Geprüft über
-- pg_proc.prosrc vor dieser Migration.
--
-- current_user_fraktion() ist mitgenommen, obwohl der Linter sie nicht
-- meldet: Sie trug bereits `search_path=public`, aber ohne pg_temp.
alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.current_user_partei() set search_path = public, pg_temp;
alter function public.current_user_ebenen() set search_path = public, pg_temp;
alter function public.current_user_fraktion() set search_path = public, pg_temp;
alter function public.current_user_gliederung_matches(text, text) set search_path = public, pg_temp;
alter function public.todo_gehoert_nutzer(uuid, uuid) set search_path = public, pg_temp;
alter function public.todo_hat_platzierung(uuid, uuid) set search_path = public, pg_temp;
alter function public.antrag_gehoert_nutzer(uuid, uuid) set search_path = public, pg_temp;
alter function public.antrag_ist_geteilt_mit(uuid, uuid) set search_path = public, pg_temp;
alter function public.dokument_gehoert_nutzer(uuid, uuid) set search_path = public, pg_temp;
alter function public.dokument_ist_geteilt_mit(uuid, uuid) set search_path = public, pg_temp;

-- Sicherheitsnetz: Bleibt eine SECURITY-DEFINER-Funktion in public ohne
-- Suchpfad übrig, bricht die Migration ab - dann ist seit dem Schreiben
-- dieser Datei eine neue dazugekommen, die hier fehlt.
do $$
declare
  offen text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into offen
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.proconfig is null;

  if offen is not null then
    raise exception 'SECURITY-DEFINER-Funktion ohne search_path: %', offen;
  end if;

  raise notice 'Alle SECURITY-DEFINER-Funktionen in public haben jetzt einen festen Suchpfad.';
end $$;
