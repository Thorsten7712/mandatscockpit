-- Löschprotokoll (Entscheidung 17.10.2026, docs/ARCHITEKTUR-PLAN.md).
--
-- Anlass: Am 17.10. verschwanden zwei Drucksachen aus dem Hub, und in der
-- Datenbank war nicht mehr festzustellen, wer sie gelöscht hatte (es war der
-- Nutzer selbst, aus gutem Grund - aber das ließ sich nur durch Nachfragen
-- klären). Mit mehreren Mitgliedern, dem Politikbüro und den Automatik-Konten
-- im selben Bestand ist das keine Dauerlösung.
--
-- Was protokolliert wird: jede gelöschte Zeile der Inhaltstabellen - mit
-- Zeitpunkt, Konto, Weg (Web-Oberfläche, MCP-Server, Wartung), Tabelle, Titel
-- und der vollständigen Zeile als JSON, sodass sich ein versehentlich
-- gelöschter Eintrag auch wiederherstellen ließe. Löschungen per
-- ON DELETE CASCADE erscheinen einzeln (z. B. die Notizen an einem gelöschten
-- Dokument), weil Postgres die Zeilen-Trigger auch dafür auslöst.
--
-- Wer es sieht: niemand über die App. Die Tabelle liegt im Schema `private`,
-- das PostgREST nicht ausliefert, und hat keine Policies für Nutzer. Einsehbar
-- im Supabase-Dashboard (Table Editor, Schema "private") bzw. per SQL.
--
-- Wem eine Löschung zugeordnet wird: Bei Aufrufen aus der Web-Oberfläche ist
-- das auth.uid(). Der MCP-Server und Wartungsskripte arbeiten mit dem
-- Service-Role-Schlüssel, dort ist auth.uid() leer - sie schicken deshalb den
-- Header `x-mc-user` (Konto) bzw. `x-mc-quelle` (z. B. "wartung-dateien") mit,
-- den PostgREST als request.headers bereitstellt. Ausgewertet wird der Header
-- NUR bei der Service-Role: Ein normaler Nutzer könnte ihn selbst setzen und
-- sich damit eine fremde Identität geben.


create table private.protokoll (
  id bigint generated always as identity primary key,
  zeitpunkt timestamptz not null default now(),
  konto uuid,
  konto_name text,
  weg text not null,
  aktion text not null,
  tabelle text not null,
  objekt_id text,
  titel text,
  zeile jsonb not null
);

create index protokoll_zeitpunkt_idx on private.protokoll (zeitpunkt desc);
create index protokoll_tabelle_objekt_idx on private.protokoll (tabelle, objekt_id);

alter table private.protokoll enable row level security;
-- Bewusst keine Policy: Nutzer lesen und schreiben hier nichts. Geschrieben
-- wird ausschließlich über die SECURITY-DEFINER-Triggerfunktion unten.
revoke all on private.protokoll from public, anon, authenticated;


-- Wer hat ausgelöst? Eigene Funktion, damit sich die Zuordnung ohne echte
-- Löschung prüfen lässt (Generalprobe: Rolle, Claims und Header setzen und
-- das Ergebnis ansehen).
create or replace function private.protokoll_herkunft(out konto uuid, out weg text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  kopfzeilen jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  rolle text := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role';
begin
  konto := auth.uid();
  if konto is not null then
    weg := 'web';
  elsif rolle = 'service_role' and (kopfzeilen ->> 'x-mc-user') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    -- Nur eine wohlgeformte UUID übernehmen: Ein Fehler beim Umwandeln würde
    -- sonst die Löschung selbst abbrechen - das Protokoll darf nie die
    -- eigentliche Aktion verhindern.
    konto := (kopfzeilen ->> 'x-mc-user')::uuid;
    weg := 'mcp';
  elsif rolle = 'service_role' then
    weg := coalesce('service_role: ' || (kopfzeilen ->> 'x-mc-quelle'), 'service_role');
  else
    -- Direkt in der Datenbank (Migration, SQL-Editor, Connector).
    weg := 'datenbank: ' || current_user;
  end if;
end;
$$;

create or replace function private.protokolliere_loeschung()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  zeile jsonb := to_jsonb(old);
  herkunft record;
begin
  select * into herkunft from private.protokoll_herkunft();
  insert into private.protokoll (konto, konto_name, weg, aktion, tabelle, objekt_id, titel, zeile)
  values (
    herkunft.konto,
    (select name from public.profiles where id = herkunft.konto),
    herkunft.weg,
    tg_op,
    tg_table_name,
    zeile ->> 'id',
    left(coalesce(zeile ->> 'titel', zeile ->> 'top_titel', zeile ->> 'gremium', zeile ->> 'name', zeile ->> 'inhalt'), 200),
    zeile
  );
  return old;
end;
$$;

revoke execute on function private.protokoll_herkunft() from public, anon, authenticated;
revoke execute on function private.protokolliere_loeschung() from public, anon;


-- Alle Tabellen mit Inhalten, die Mitglieder anlegen oder gemeinsam nutzen.
-- Nicht protokolliert: reine Zustände (gelesen-Markierungen, Board-Platz,
-- Abos, Gremien-Auswahl), Tokens und Upload-Zwischenstände.
do $$
declare
  t text;
begin
  foreach t in array array[
    'dokumente', 'dokument_shares', 'sitzung_dokumente', 'sessions', 'events', 'calendar_sources',
    'todos', 'todo_comments', 'todo_dokumente', 'summaries', 'antraege', 'antrag_comments',
    'antrag_shares', 'fakten', 'presseschauen', 'profiles'
  ] loop
    execute format(
      'create trigger protokoll_loeschung after delete on public.%I
         for each row execute function private.protokolliere_loeschung()',
      t
    );
  end loop;
end $$;


-- Sicherheitsnetz: Jede der Tabellen hat den Trigger, und die Protokoll-
-- Tabelle ist für Nutzer weder lesbar noch beschreibbar.
do $$
declare
  fehlend text;
begin
  select string_agg(t, ', ') into fehlend
  from unnest(array[
    'dokumente', 'dokument_shares', 'sitzung_dokumente', 'sessions', 'events', 'calendar_sources',
    'todos', 'todo_comments', 'todo_dokumente', 'summaries', 'antraege', 'antrag_comments',
    'antrag_shares', 'fakten', 'presseschauen', 'profiles'
  ]) t
  where not exists (
    select 1 from pg_trigger
    where tgname = 'protokoll_loeschung' and tgrelid = ('public.' || t)::regclass
  );
  if fehlend is not null then
    raise exception 'Löschprotokoll fehlt bei: %', fehlend;
  end if;

  if has_table_privilege('authenticated', 'private.protokoll', 'select')
     or has_table_privilege('anon', 'private.protokoll', 'select') then
    raise exception 'private.protokoll ist für Nutzer lesbar';
  end if;

  raise notice 'Löschprotokoll aktiv für 16 Tabellen.';
end $$;
