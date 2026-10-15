-- 36 Ausschusssitzungen aus Nov 2025 bis Mai 2026 nachtragen.
--
-- Anlass: Der ALLRIS-ICS-Feed hat ein gleitendes Fenster (aktuell
-- 09/2026-10/2027) und reicht nicht in die Vergangenheit. Sitzungen, die zum
-- Zeitpunkt der ersten Importe schon außerhalb des Fensters lagen, sind
-- deshalb nie angekommen - im Bestand finden sich für diesen Zeitraum nur
-- Rat, Sportausschuss, Verkehrsausschuss und die Fraktionstermine, die
-- Fachausschüsse fehlen. Nachgereicht vom Nutzer aus dem ALLRIS-
-- Sitzungskalender. Kein ICS-Import kann das nachholen (geprüft: auch der
-- öffentliche Feed enthält aus diesem Zeitraum keinen einzigen Termin).
--
-- Warum eine Migration und kein Skript: Der Vorgang ist einmalig,
-- nachvollziehbar und soll denselben Weg gehen wie jede andere Änderung an
-- der Live-DB (supabase db push).
--
-- Bewusste Festlegungen:
--   * source_id wird NICHT hart verdrahtet, sondern aus dem Bestand
--     abgeleitet: die Quelle, die die meisten Sitzungen des Rates der Stadt
--     Iserlohn trägt. Das überlebt ein Umbenennen der Quelle.
--   * erstellt_von bleibt null - wie bei importierten Sitzungen. Es sind
--     offizielle Gremiensitzungen, keine privaten Nachträge; sie sollen sich
--     genauso verhalten (read-only in der Web-UI).
--   * ics_uid bleibt null, weil die ALLRIS-Kennung (SILFDNR) dieser Sitzungen
--     hier nicht vorliegt. Das stört den ICS-Import nicht: er vergleicht nur
--     Zeilen MIT ics_uid, markiert diese hier also nie als abgesagt, und ein
--     Dublettenrisiko besteht nicht, da alle Termine vor dem Feed-Fenster
--     liegen. set_session_agenda trägt die Kennung nach, sobald dailyallris
--     die erste Tagesordnung dazu liefert.
--   * ort bleibt null statt geraten. "Sitzungssaal Reiterweg" wäre für die
--     meisten richtig - aber eben nicht für alle, und ein falscher Ort ist
--     schlechter als keiner.
--   * Uhrzeiten in Europe/Berlin, damit die Sommerzeit-Umstellung am
--     29.03.2026 nicht von Hand gerechnet werden muss.
--
-- Idempotent: Ein erneuter Lauf fügt nichts doppelt ein, maßgeblich ist
-- (Quelle, Gremium, Zeitpunkt).
do $$
declare
  quelle uuid;
  quell_ebene text;
  eingefuegt integer;
begin
  select source_id into quelle
  from public.sessions
  where gremium = 'Rat der Stadt Iserlohn' and source_id is not null
  group by source_id
  order by count(*) desc
  limit 1;

  if quelle is null then
    raise exception 'Keine Kalenderquelle für den Rat der Stadt Iserlohn gefunden - Nachtrag abgebrochen.';
  end if;

  select ebene into quell_ebene from public.calendar_sources where id = quelle;

  with nachtrag(zeitpunkt, gremium) as (
    values
    ('2025-11-25 17:00', 'Haupt- und Personalausschuss'),
    ('2025-11-26 17:00', 'Ausschuss für Planung und Stadtentwicklung'),
    ('2025-12-02 17:00', 'Finanzausschuss'),
    ('2025-12-03 17:00', 'Jugendhilfeausschuss'),
    ('2025-12-04 17:00', 'Beirat für Inklusion'),
    ('2025-12-04 17:00', 'Schulausschuss'),
    ('2025-12-11 17:00', 'Ausschuss für Chancengerechtigkeit und Integration'),
    ('2026-01-13 17:00', 'Ausschuss für Chancengerechtigkeit und Integration'),
    ('2026-01-13 17:00', 'Kulturausschuss'),
    ('2026-01-14 17:00', 'Betriebsausschuss Kommunales Immobilien Management'),
    ('2026-01-15 17:00', 'Feuerwehrausschuss'),
    ('2026-01-20 17:00', 'Sozialausschuss'),
    ('2026-01-27 17:00', 'Jugendhilfeausschuss'),
    ('2026-01-29 17:00', 'Schulausschuss'),
    ('2026-02-03 17:00', 'Haupt- und Personalausschuss'),
    ('2026-02-04 17:00', 'Ausschuss für Planung und Stadtentwicklung'),
    ('2026-02-05 17:45', 'Sozialausschuss'),
    ('2026-02-10 17:00', 'Ausschuss für Umwelt- und Klimaschutz'),
    ('2026-02-11 17:00', 'Finanzausschuss'),
    ('2026-02-24 17:00', 'Beirat für Inklusion'),
    ('2026-02-26 17:00', 'Kulturausschuss'),
    ('2026-03-03 17:00', 'Betriebsausschuss Seniorenzentrum Waldstadt Iserlohn'),
    ('2026-03-10 17:00', 'Jugendhilfeausschuss'),
    ('2026-03-10 17:00', 'Schulausschuss'),
    ('2026-03-12 17:00', 'Sozialausschuss'),
    ('2026-03-17 17:00', 'Rechnungsprüfungsausschuss'),
    ('2026-03-26 17:00', 'Ausschuss für Chancengerechtigkeit und Integration'),
    ('2026-04-15 17:00', 'Betriebsausschuss Kommunales Immobilien Management'),
    ('2026-04-21 17:00', 'Haupt- und Personalausschuss'),
    ('2026-04-22 17:00', 'Ausschuss für Planung und Stadtentwicklung'),
    ('2026-04-23 17:03', 'Schulausschuss'),
    ('2026-04-28 17:00', 'Seniorenbeirat'),
    ('2026-04-29 17:00', 'Finanzausschuss'),
    ('2026-05-06 17:00', 'Ausschuss für Bürgerbeteiligung'),
    ('2026-05-12 17:00', 'Betriebsausschuss Seniorenzentrum Waldstadt Iserlohn'),
    ('2026-05-13 17:00', 'Feuerwehrausschuss')
  )
  insert into public.sessions (source_id, titel, gremium, ebene, datum)
  select quelle, n.gremium, n.gremium, quell_ebene, (n.zeitpunkt::timestamp at time zone 'Europe/Berlin')
  from nachtrag n
  where not exists (
    select 1 from public.sessions s
    where s.source_id = quelle
      and s.gremium = n.gremium
      and s.datum = (n.zeitpunkt::timestamp at time zone 'Europe/Berlin')
  );

  get diagnostics eingefuegt = row_count;
  raise notice 'Nachgetragene Sitzungen: %', eingefuegt;
end $$;
