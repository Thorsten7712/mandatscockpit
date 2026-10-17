-- Speicherbelegung für Admins (Entscheidung 17.10.2026, docs/ARCHITEKTUR-PLAN.md):
-- statt einer Quota pro Nutzer sehen Admins in den Einstellungen, wie viel
-- Platz je Bucket und Person belegt ist und wie groß die Datenbank ist -
-- gegen die Grenzen des Free-Tiers (1 GB Dateien, 500 MB Datenbank).
--
-- Aufgerufen wird die Funktion ausschließlich von der Edge Function
-- admin-users (Aktion 'speicher'), die vorher die Admin-Rolle prüft. Sie
-- liegt deshalb in public (nur so erreicht der Service-Role-Client sie per
-- rpc), ist aber für anon und authenticated gesperrt: Die Belegung je Person
-- verrät, wer wie viel hochgeladen hat. Kein SECURITY DEFINER nötig - die
-- Service-Role liest storage.objects ohnehin.


create or replace function public.speicherbelegung()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'datenbank_bytes', pg_database_size(current_database()),
    'dateien', coalesce((
      select jsonb_agg(zeile order by zeile ->> 'bucket', (zeile ->> 'bytes')::bigint desc)
      from (
        select jsonb_build_object(
          'bucket', o.bucket_id,
          'konto', p.id,
          'name', coalesce(p.name, '(ohne Konto: ' || (storage.foldername(o.name))[1] || ')'),
          'anzahl', count(*),
          'bytes', coalesce(sum((o.metadata ->> 'size')::bigint), 0)
        ) as zeile
        from storage.objects o
        left join public.profiles p on p.id::text = (storage.foldername(o.name))[1]
        group by o.bucket_id, p.id, p.name, (storage.foldername(o.name))[1]
      ) je_person
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.speicherbelegung() from public, anon, authenticated;
grant execute on function public.speicherbelegung() to service_role;


do $$
begin
  if has_function_privilege('anon', 'public.speicherbelegung()', 'execute')
     or has_function_privilege('authenticated', 'public.speicherbelegung()', 'execute') then
    raise exception 'speicherbelegung() ist für Nutzer aufrufbar';
  end if;
end $$;
