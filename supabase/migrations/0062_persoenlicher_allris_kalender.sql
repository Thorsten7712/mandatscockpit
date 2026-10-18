-- Öffentlicher und persönlicher ALLRIS-Kalender (Entscheidung 18.10.2026).
--
-- Bisher hing die gemeinsame Quelle "Stadtrat Iserlohn" am persönlichen
-- ALLRIS-Abo eines Mitglieds (/personal/ics/...?bid=...&sid=...). Gemeinsame
-- Quellen sieht jeder angemeldete Nutzer - samt URL und allen Terminen, also
-- auch Fraktionssitzungen, Aufsichtsräte und Kleine Kommissionen dieses einen
-- Mitglieds. Künftig:
--
--   - Die gemeinsame Quelle liest den öffentlichen Feed (/public/ics/...).
--     Daraus wählt jedes Mitglied der Ebene wie bisher seine Gremien aus.
--   - Jedes Mitglied kann zusätzlich sein persönliches ALLRIS-Abo als eigene,
--     nur für sich sichtbare Quelle hinterlegen. Mit nur_ergaenzend = true
--     übernimmt der Import daraus nur Termine, deren Kennung (UID) in keiner
--     gemeinsamen Quelle derselben Ebene vorkommt - die nichtöffentlichen
--     Gremien. Die Gremien daraus sind wie alle anderen unter "Meine Gremien"
--     auswählbar (auch Vertretungen und die Fraktion).
--
-- Der Vergleich läuft über die UID statt über Gremiennamen: ALLRIS vergibt in
-- beiden Feeds dieselbe ("ALLRIS-Sitzung-<Nummer>"), gemessen am 18.10.2026 -
-- alle 47 öffentlichen Termine stecken mit gleicher UID im persönlichen Feed,
-- dazu 22 nichtöffentliche.

alter table public.calendar_sources
  add column nur_ergaenzend boolean not null default false;

comment on column public.calendar_sources.nur_ergaenzend is
  'Nur Termine importieren, deren UID in keiner gemeinsamen Quelle (verwaltet_von is null) derselben Ebene vorkommt - für das persönliche ALLRIS-Abo neben dem öffentlichen Feed.';


-- Umstellung der bestehenden Quelle --------------------------------------------
--
-- Nur, solange die gemeinsame Quelle noch am persönlichen Abo hängt. Das Abo
-- zieht in eine eigene Quelle seines Inhabers um (Thorsten Kois), mit den
-- Sitzungen der nichtöffentlichen Gremien - verschoben statt neu importiert,
-- damit Ids und Verknüpfungen bleiben. Welche Gremien das sind, steht fest:
-- es sind genau die, die am 18.10.2026 nur im persönlichen Feed vorkamen;
-- vergangene Sitzungen derselben Gremien (aus dem Feed längst
-- herausgerollt) gehen mit. Keine von ihnen hat Tagesordnungspunkte oder
-- ToDos.

do $$
declare
  gemeinsam_id uuid;
  inhaber uuid := 'd84224d3-49d1-4098-a629-9268d86d3ef5';
  privat_id uuid;
  verschoben int;
begin
  select id into gemeinsam_id
  from public.calendar_sources
  where name = 'Stadtrat Iserlohn' and verwaltet_von is null and ics_url like '%/personal/%';

  if gemeinsam_id is null then
    raise notice 'Gemeinsame Quelle hängt nicht mehr am persönlichen Abo - nichts umzustellen.';
    return;
  end if;

  insert into public.calendar_sources (name, ics_url, ebene, art, farbe, verwaltet_von, nur_ergaenzend)
  select 'ALLRIS persönlich', ics_url, ebene, 'sitzung', farbe, inhaber, true
  from public.calendar_sources where id = gemeinsam_id
  returning id into privat_id;

  insert into public.user_source_subscriptions (user_id, source_id)
  values (inhaber, privat_id)
  on conflict do nothing;

  update public.sessions
     set source_id = privat_id
   where source_id = gemeinsam_id
     and gremium in (
       'CDU-Fraktion',
       'Arbeitskreis Entwicklung Iserlohn',
       'Aufsichtsrat der Gesellschaft für Wirtschaftsförderung',
       'Aufsichtsrat der Schillerplatz GmbH',
       'Aufsichtsrat der Stadtwerke',
       'Verwaltungsrat Märkischer Stadtbetrieb Iserlohn/Hemer',
       'Kleine Kommission Finanzen',
       'Kleine Kommission Friedhöfe',
       'Kleine Kommission Schulwesen',
       'Kleine Kommission Sport'
     );
  get diagnostics verschoben = row_count;

  -- Sicherheitsnetz: an keiner der verschobenen Sitzungen hängt etwas, das
  -- andere Mitglieder bisher über die gemeinsame Quelle sahen.
  if exists (select 1 from public.sitzung_dokumente where session_id in (select id from public.sessions where source_id = privat_id))
     or exists (select 1 from public.todos where session_id in (select id from public.sessions where source_id = privat_id)) then
    raise exception 'Verschobene Sitzungen haben Tagesordnung oder ToDos - abgebrochen.';
  end if;

  update public.calendar_sources
     set ics_url = 'https://www.iserlohn.sitzung-online.de/public/ics/SiKalAbo.ics'
   where id = gemeinsam_id;

  raise notice '% Sitzungen in die persönliche Quelle verschoben.', verschoben;
end $$;
