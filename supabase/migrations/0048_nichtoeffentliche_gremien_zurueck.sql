-- Rücknahme von 0047: Die nichtöffentlichen Gremien gehören doch in den
-- Kalender.
--
-- Missverständnis auf meiner Seite: "Kleine Kommissionen, Verwaltungs- und
-- Aufsichtsräte sind nichtöffentlich, die sollen auch nicht ins
-- Mandatscockpit" hieß nicht, dass die Termine verschwinden sollen, sondern
-- dass zu ihnen kein Inhalt kommt - keine Tagesordnung, keine Vorlagen. Als
-- Kalendereintrag sind sie weiterhin gewünscht. 0047 hat 20 Sitzungen
-- gelöscht, der Import-Filter ist bereits wieder entfernt.
--
-- Der größte Teil kommt von allein zurück: Alles ab dem 31.08.2026 liegt im
-- rollierenden Fenster des ALLRIS-Feeds und wird vom nächsten ICS-Import
-- wieder angelegt (ics_uid ist unverändert, es entstehen also keine
-- Dubletten). Was davor liegt, ist aus dem Feed herausgefallen und steht hier
-- - die Daten stammen aus der Bestandsabfrage unmittelbar vor dem Löschen.
--
-- An keiner der gelöschten Sitzungen hing etwas (0047 meldete "Wegen
-- angehängter Inhalte behalten: keine"), neue ids sind deshalb unschädlich.
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
    raise exception 'Keine Kalenderquelle für den Rat der Stadt Iserlohn gefunden.';
  end if;

  select ebene into quell_ebene from public.calendar_sources where id = quelle;

  with zurueck(ics_uid, titel, gremium, zeitpunkt, ort, quelle_url) as (
    values
      ('ALLRIS-Sitzung-2002654'::text, 'Aufsichtsrat der Schillerplatz GmbH'::text, 'Aufsichtsrat der Schillerplatz GmbH'::text, '2026-06-10 17:00'::text, 'Sitzungssaal Reiterweg'::text, 'https://www.iserlohn.sitzung-online.de/personal/to010?SILFDNR=2002654'::text),
      ('ALLRIS-Sitzung-2002623', 'keine relevanten TOP´s - Verwaltungsrat Märkischer Stadtbetrieb Iserlohn/Hemer', 'Verwaltungsrat Märkischer Stadtbetrieb Iserlohn/Hemer', '2026-06-24 17:00', null, 'https://www.iserlohn.sitzung-online.de/personal/si010?DD=24&MM=6&YY=2026'),
      ('ALLRIS-Sitzung-2002619', 'Aufsichtsrat der Stadtwerke', 'Aufsichtsrat der Stadtwerke', '2026-06-25 17:00', null, 'https://www.iserlohn.sitzung-online.de/personal/si010?DD=25&MM=6&YY=2026'),
      ('ALLRIS-Sitzung-2002737', 'Aufsichtsrat der Gesellschaft für Wirtschaftsförderung', 'Aufsichtsrat der Gesellschaft für Wirtschaftsförderung', '2026-06-26 10:00', null, 'https://www.iserlohn.sitzung-online.de/personal/si010?DD=26&MM=6&YY=2026'),
      ('ALLRIS-Sitzung-2002743', 'Kleine Kommission Finanzen', 'Kleine Kommission Finanzen', '2026-06-26 16:00', 'Besprechungsraum des Bürgermeisters, Raum 109', 'https://www.iserlohn.sitzung-online.de/personal/to010?SILFDNR=2002743'),
      ('ALLRIS-Sitzung-2002906', 'Kleine Kommission Schulwesen', 'Kleine Kommission Schulwesen', '2026-07-01 17:00', 'Stadthaus Bömberg, BB-U 132', 'https://www.iserlohn.sitzung-online.de/personal/to010?SILFDNR=2002906'),
      ('ALLRIS-Sitzung-2002994', 'Kleine Kommission Sport', 'Kleine Kommission Sport', '2026-07-16 17:00', 'Matthias-Grothe Halle, Medienraum', 'https://www.iserlohn.sitzung-online.de/personal/to010?SILFDNR=2002994')
  )
  insert into public.sessions (source_id, ics_uid, titel, gremium, ebene, datum, ort, quelle_url)
  select quelle, z.ics_uid, z.titel, z.gremium, quell_ebene,
         (z.zeitpunkt::timestamp at time zone 'Europe/Berlin'), z.ort, z.quelle_url
  from zurueck z
  where not exists (
    select 1 from public.sessions s where s.source_id = quelle and s.ics_uid = z.ics_uid
  );

  get diagnostics eingefuegt = row_count;
  raise notice 'Wiederhergestellt: % Sitzungen (vor dem Feed-Fenster).', eingefuegt;
  raise notice 'Alles ab 31.08.2026 holt der nächste ICS-Import von allein zurück.';
end $$;
