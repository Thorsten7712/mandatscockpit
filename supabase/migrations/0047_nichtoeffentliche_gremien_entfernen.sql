-- Kleine Kommissionen sowie Verwaltungs- und Aufsichtsräte aus dem Bestand
-- nehmen.
--
-- Nutzerentscheidung 2026-10-16: Diese Gremien tagen nichtöffentlich und
-- gehören nicht ins Cockpit. ALLRIS führt sie zwar im Sitzungskalender, es
-- gibt dazu aber weder eine Tagesordnung noch Vorlagen - im Cockpit blieben
-- es dauerhaft leere Termine. Betroffen sind unter anderem Kleine Kommission
-- Finanzen/Sport/Schulwesen/Friedhöfe, Verwaltungsrat Märkischer Stadtbetrieb
-- Iserlohn/Hemer, Aufsichtsrat der Stadtwerke, Aufsichtsrat der Gesellschaft
-- für Wirtschaftsförderung und Aufsichtsrat der Schillerplatz GmbH.
--
-- Der Import filtert sie ab sofort heraus (NICHT_OEFFENTLICHE_GREMIEN in
-- scripts/import-ics.mjs); diese Migration räumt auf, was schon da ist.
--
-- Gefiltert wird am Wortanfang des Gremiennamens, exakt wie im Importer:
-- "Aufsichtsrat der Stadtwerke" fliegt raus, ein Ausschuss, der das Wort
-- irgendwo im Titel führt, nicht.
--
-- Nichts wird weggerissen, woran etwas hängt: Sitzungen mit Notizen,
-- Aufgaben, Anträgen oder Dokumenten bleiben stehen und werden am Ende
-- namentlich gemeldet. Die Verknüpfungen in sitzung_dokumente hängen per
-- ON DELETE CASCADE an der Sitzung und zählen deshalb nicht als Hindernis -
-- sie sind bei diesen Gremien ohnehin leer.
do $$
declare
  geloescht integer;
  behalten text;
begin
  create temp table nicht_oeffentlich on commit drop as
  select s.id, s.titel, s.gremium, s.datum
  from public.sessions s
  where s.gremium ~* '^(kleine kommission|verwaltungsrat|aufsichtsrat)\s';

  -- Alles, was auf eine dieser Sitzungen zeigt und beim Löschen im Weg stünde
  -- (die Fremdschlüssel sind ohne ON DELETE angelegt, ein Löschen würde also
  -- hart scheitern statt still mitzunehmen).
  create temp table belegt on commit drop as
  select n.id
  from nicht_oeffentlich n
  where exists (select 1 from public.summaries x where x.session_id = n.id)
     or exists (select 1 from public.todos x where x.session_id = n.id)
     or exists (select 1 from public.antraege x where x.session_id = n.id)
     or exists (select 1 from public.documents x where x.session_id = n.id);

  delete from public.sessions
  where id in (select id from nicht_oeffentlich)
    and id not in (select id from belegt);
  get diagnostics geloescht = row_count;

  select string_agg(format('%s am %s', n.titel, to_char(n.datum, 'DD.MM.YYYY')), '; ' order by n.datum)
    into behalten
  from nicht_oeffentlich n
  where n.id in (select id from belegt);

  raise notice 'Nichtöffentliche Gremien: % Sitzungen gelöscht.', geloescht;
  raise notice 'Wegen angehängter Inhalte behalten: %', coalesce(behalten, 'keine');
end $$;
