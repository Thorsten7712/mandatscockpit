-- Dokumenten-Hub ohne 10 MB pro Aufruf (Entscheidung 17.10.2026, "Volltextsuche
-- in Postgres statt im Browser", docs/ARCHITEKTUR-PLAN.md).
--
-- Bisher lud /dokumente bei jedem Aufruf den vollen Text aller 1.141
-- Drucksachen (rund 5,6 MB, dazu JSON-Hülle), nur um zwei Zeilen Vorschau zu
-- zeigen und im Browser zu suchen. Künftig:
--
--   vorschau  - die zwei Zeilen für die Liste, beim Schreiben berechnet
--               (vorschau() in supabase/functions/_shared/vorlageMarkdown.ts,
--               dieselbe Funktion für Web-Oberfläche und MCP-Server). Die
--               Logik - Beschlussvorschlag bevorzugt, Formularreste
--               übersprungen - in SQL nachzubauen, gäbe zwei Wahrheiten.
--   suchtext  - Titel, Tags und Text, klein geschrieben und mit allen
--               Weißraum-Folgen auf ein Leerzeichen gezogen (wie suchtext()
--               bisher in Dokumente.tsx), mit Trigramm-Index. Gesucht wird per
--               ILIKE '%...%' - also genau dieselbe Teilwort-Suche wie vorher
--               im Browser, nicht die Wortstamm-Logik der Volltextsuche, die
--               "Schule" in "Grundschule" nicht fände.
--
-- Bestehende Zeilen bekommen ihre Vorschau über scripts/wartung-vorschau.mjs;
-- bis dahin zeigt die Liste dort einfach keine.


create extension if not exists pg_trgm with schema extensions;

alter table public.dokumente add column vorschau text;

-- Generierte Spalten verlangen IMMUTABLE-Funktionen; array_to_string ist nur
-- STABLE deklariert, für text[] aber tatsächlich unveränderlich. Daher dieser
-- Helfer statt des Ausdrucks direkt in der Spalte.
create or replace function private.dokument_suchtext(titel text, tags text[], inhalt text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select lower(regexp_replace(
    coalesce(titel, '') || ' ' || coalesce(array_to_string(tags, ' '), '') || ' ' || coalesce(inhalt, ''),
    '\s+', ' ', 'g'
  ))
$$;

alter table public.dokumente
  add column suchtext text generated always as (private.dokument_suchtext(titel, tags, inhalt)) stored;

create index dokumente_suchtext_trgm_idx on public.dokumente
  using gin (suchtext extensions.gin_trgm_ops);


-- Sicherheitsnetz
do $$
begin
  if (select count(*) from public.dokumente where suchtext is null) > 0 then
    raise exception 'suchtext nicht für alle Zeilen berechnet';
  end if;
end $$;
