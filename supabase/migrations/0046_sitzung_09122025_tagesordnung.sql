-- Die Ratssitzung vom 09.12.2025 samt ihrer Tagesordnung.
--
-- Anlass: Die Tagesordnung dieser Sitzung liegt als Markdown-Dokument im Hub,
-- die Sitzung selbst fehlte im Bestand (gleiche Ursache wie 0045: der
-- ALLRIS-ICS-Feed reicht nicht in die Vergangenheit). Ohne Sitzung hat die
-- Tagesordnung nichts, woran sie hängen könnte.
--
-- Dies ist der erste echte Tagesordnungs-Datensatz im Projekt - bisher gab es
-- nur das Modell (0043/0044) und das Werkzeug (set_session_agenda). Künftige
-- Tagesordnungen kommen über dailyallris und nicht mehr über Migrationen;
-- diese eine wird hier eingetragen, weil sie bereits vorliegt und als
-- Prüfstein für das Modell dient.
--
-- Quelle: das Dokument "Tagesordnung – Rat der Stadt Iserlohn 09.12.2025",
-- erzeugt aus https://www.iserlohn.sitzung-online.de/public/to010?SILFDNR=2001745
-- 84 Punkte, davon 63 mit Drucksache. Die Spalte "Zuständigkeit" der
-- Tagesordnung wird zu ergebnis.
--
-- ics_uid lässt sich hier - anders als bei den 36 Sitzungen aus 0045 - sauber
-- setzen: Die SILFDNR aus dem Kopf der Tagesordnung ist dieselbe Nummer, die
-- ALLRIS im ICS-Feed als "ALLRIS-Sitzung-<Nr>" ausgibt (an 21 Terminen mit
-- SILFDNR-URL im Feed geprüft: 21-mal identisch).
--
-- Idempotent: Die Sitzung wird über ics_uid bzw. Gremium+Tag wiedererkannt,
-- die importierte Tagesordnung vorher gelöscht und neu geschrieben. Von Hand
-- gesetzte Verknüpfungen ohne TOP-Nummer bleiben unberührt.
do $$
declare
  quelle uuid;
  quell_ebene text;
  sitzung uuid;
  anzahl integer;
  verknuepft integer;
  fehlend text;
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

  -- 1. Sitzung: über die ALLRIS-Kennung, sonst über Gremium + Tag (dann die
  --    Kennung nachtragen), sonst neu anlegen.
  select id into sitzung from public.sessions where ics_uid = 'ALLRIS-Sitzung-2001745';

  if sitzung is null then
    select id into sitzung
    from public.sessions
    where gremium = 'Rat der Stadt Iserlohn'
      and datum >= ('2025-12-09 00:00'::timestamp at time zone 'Europe/Berlin')
      and datum <  ('2025-12-10 00:00'::timestamp at time zone 'Europe/Berlin')
    order by datum
    limit 1;
    if sitzung is not null then
      update public.sessions set ics_uid = 'ALLRIS-Sitzung-2001745' where id = sitzung and ics_uid is null;
      raise notice 'Sitzung war bereits vorhanden, ALLRIS-Kennung nachgetragen.';
    end if;
  end if;

  if sitzung is null then
    insert into public.sessions (source_id, titel, gremium, ebene, datum, ort, quelle_url, ics_uid)
    values (
      quelle,
      'Rat der Stadt Iserlohn',
      'Rat der Stadt Iserlohn',
      quell_ebene,
      ('2025-12-09 17:00'::timestamp at time zone 'Europe/Berlin'),
      'Saalbau Letmathe, Von-der-Kuhlen-Straße 35, 58642 Iserlohn',
      'https://www.iserlohn.sitzung-online.de/public/to010?SILFDNR=2001745',
      'ALLRIS-Sitzung-2001745'
    )
    returning id into sitzung;
    raise notice 'Sitzung "Rat der Stadt Iserlohn" am 09.12.2025 angelegt.';
  end if;

  -- 2. Tagesordnung. Erst in eine temporäre Tabelle, damit danach berichtet
  --    werden kann, welche Drucksachen im Hub fehlen - nach dem Einfügen ist
  --    die Nummer nicht mehr greifbar, gespeichert wird nur die Dokument-Id.
  create temp table tagesordnung_import on commit drop as
  with tops(reihenfolge, top_nummer, top_titel, drucksache, ergebnis) as (
    values
      (0, 'Ö 1'::text, 'Eröffnung der Sitzung'::text, null::text, null::text),
      (1, 'Ö 2', 'Einwohnerfragen', null, null),
      (2, 'Ö 2.1', 'Keine Bereitstellung von Flächen im Stadtwald für Windkraftanlagen / Prüfung restriktiverer Wasserschutzzonen (DS10/4161)', null, null),
      (3, 'Ö 3', 'Umbesetzungen in Ausschüssen und sonstigen Gremien', null, null),
      (4, 'Ö 3.1', 'Umbesetzungen in Ausschüssen und sonstigen Gremien; hier: Schulausschuss (Vertreter der Ev. Kirche)', 'DS11/0108', 'ungeändert beschlossen'),
      (5, 'Ö 3.2', 'Entsendung von Vertretern des Beirates für Inklusion in Ausschüsse als beratende Mitglieder', 'DS11/0172', 'ungeändert beschlossen'),
      (6, 'Ö 3.3', 'Ratssitzung am 9.12.25: Umbesetzungen in Ausschüssen und sonstigen Gremien hier: Antrag der Fraktion Bündnis 90/Die Grünen', 'DS11/0166', 'zur Kenntnis genommen'),
      (7, 'Ö 3.4', '(AfD) Umbesetzungen in Ausschüssen und Gremien', 'DS11/0167', 'ungeändert beschlossen'),
      (8, 'Ö 3.5', 'Ratssitzung am 09. Dezember 2025 Umbesetzungen in Ausschüssen und Gremien hier: Antrag der CDU-Fraktion', 'DS11/0186', 'ungeändert beschlossen'),
      (9, 'Ö 3.6', 'Umbesetzungen in Ausschüssen und sonstigen Gremien; hier: Antrag der Fraktion DieISERLOHNER', null, 'zur Kenntnis genommen'),
      (10, 'Ö 4', 'Wahl des Rates der Stadt Iserlohn am 14.09.2025 A) Vorprüfung von Einsprüchen gegen die Gültigkeit der Wahl des Rates der Stadt Iserlohn B) Beschluss über die Gültigkeit der Wahl des Rates der Stadt Iserlohn Wahl des Integrationsausschusses der Stadt Iserlohn am 14.09.2025 A) Vorprüfung von Einsprüchen gegen die Gültigkeit der Wahl des Integrationsausschusses der Stadt Iserlohn B) Beschluss über die Gültigkeit der Wahl des Integrationsausschusses der Stadt Iserlohn', 'DS11/0053', 'ungeändert beschlossen'),
      (11, 'Ö 5', 'Wahlen zum Bürgermeisteramt am 14.09.2025 und 28.09.2025 A) Vorprüfung von Einsprüchen gegen die Gültigkeit der Wahl des Bürgermeisters der Stadt Iserlohn B) Beschluss über die Gültigkeit der Wahl zum Bürgermeister der Stadt Iserlohn', 'DS11/0054', 'ungeändert beschlossen'),
      (12, 'Ö 6', 'Übertragung von Ratssitzungen per Livestream', 'DS10/4162', 'geändert beschlossen'),
      (13, 'Ö 6.1', 'Übertragung von Ratssitzungen per Livestream; hier: Darstellung rechtlicher Grundlagen', 'DS10/4162-1', 'zur Kenntnis genommen'),
      (14, 'Ö 7', '(Die Linke) Zusammenarbeit zwischen Politik und Verwaltung', 'DS11/0147', 'behandelt'),
      (15, 'Ö 7.1', '(Die Linke) Zusammenarbeit Politik und Verwaltung', 'DS11/0156', 'behandelt'),
      (16, 'Ö 7.2', 'Beantwortung der Anfrage der Faktion Die Linke - Zusammenarbeit Politik und Verwaltung', 'DS11/0156-1', 'zur Kenntnis genommen'),
      (17, 'Ö 8', '(Die Linke) Stellenbesetzungsverfahren Ressortleitung für die Bereiche Sicherheit und Ordnung, Feuerwehr, Bürgerdienstleistungen, Standesamt und Kultur', 'DS11/0146', 'abgelehnt'),
      (18, 'Ö 9', 'Rückforderung Sozialversicherungsprüfung Honorarverträge', 'DS11/0112', 'ungeändert beschlossen'),
      (19, 'Ö 10', 'Neubau eines Teilstücks des Ruhrtalradwegs Abschnitt Letteweg/Hof Theymann Hier: Fassung des Baubeschlusses', 'DS10/4107', 'ungeändert beschlossen'),
      (20, 'Ö 10.1', 'Neubau eines Teilstücks des Ruhrtalradwegs Abschnitt Letteweg/Hof Theymann Hier: Aktualisierung der Kosten und der Finanzierung', 'DS10/4107-1', 'ungeändert beschlossen'),
      (21, 'Ö 11', 'Fahrbahnsanierung eines Abschnitts des Honselwegs - hier: Baubeschluss', 'DS11/0137', 'ungeändert beschlossen'),
      (22, 'Ö 12', 'Bewegung und Zusammenhalt – Iserlohn nutzt das Bundesprogramm zur Sanierung seiner Sportstätten', 'DS11/0069', 'behandelt'),
      (23, 'Ö 12.1', 'Lehrschwimmbecken und Eissporthalle; hier: Bewerbung für Bundes- und Landesförderprogramm "Sanierung kommunaler Sportstätten"', 'DS11/0110', 'ungeändert beschlossen'),
      (24, 'Ö 13', 'Abwasserbeseitigungskonzept 2026', 'DS10/4170', 'ungeändert beschlossen'),
      (25, 'Ö 14', 'Satzung zur Änderung der Gebührensatzung für die Abwasseranlagen der Stadt Iserlohn (17. Änderung)', 'DS11/0105', 'ungeändert beschlossen'),
      (26, 'Ö 14.1', 'Satzung zur Änderung der Gebührensatzung für die Abwasseranlagen der Stadt Iserlohn (17. Änderung) - Ergänzung der Änderungssatzung', 'DS11/0105-1', 'ungeändert beschlossen'),
      (27, 'Ö 15', 'Satzung zur Änderung der Gebührensatzung für die öffentliche Abfallbeseitigung in der Stadt iserlohn (31. Änderung)', 'DS11/0101', 'ungeändert beschlossen'),
      (28, 'Ö 16', 'Satzung zur Änderung der Gebührensatzung für die Entsorgung der abflusslosen Gruben in der Stadt iserlohn (26. Änderung)', 'DS11/0056', 'ungeändert beschlossen'),
      (29, 'Ö 17', 'Satzung zur Änderung der Gebührensatzung für die Entsorgung der Kleinkläranlagen in der Stadt Iserlohn (26. Änderung)', 'DS11/0057', 'ungeändert beschlossen'),
      (30, 'Ö 18', 'Satzung zur Änderung der Gebührensatzung für den Rettungsdienst der Stadt Iserlohn (12. Änderung)', 'DS11/0103', 'ungeändert beschlossen'),
      (31, 'Ö 18.1', 'Satzung zur Änderung der Gebührensatzung für den Rettungsdienst der Stadt Iserlohn (12. Änderung) - Stand der abgerechneten Einsätze des Notfalleinsatzfahrzeuges', 'DS11/0103-1', 'zur Kenntnis genommen'),
      (32, 'Ö 19', 'Satzung zur Änderung der Gebührensatzung für den Rettungsdienst der Stadt Iserlohn (13. Änderung)', 'DS11/0104', 'ungeändert beschlossen'),
      (33, 'Ö 20', 'Satzung zur Änderung der Gebührensatzung für die Friedhöfe der Stadt Iserlohn (9. Änderung)', 'DS11/0106', 'ungeändert beschlossen'),
      (34, 'Ö 21', 'Bekanntgabe von unerheblichen über- und außerplanmäßigen Aufwendungen und Auszahlungen in 2024', 'DS11/0088', 'zur Kenntnis genommen'),
      (35, 'Ö 21.1', 'Erfolgsneutrale Verrechnung der Bilanzierungshilfe mit der allgemeinen Rücklage', 'DS11/0158', 'ungeändert beschlossen'),
      (36, 'Ö 21.2', 'Änderungen im Wirtschaftsplan 2025 hier: Verschiebung im Investitionsplan', 'DS11/0031', 'zur Kenntnis genommen'),
      (37, 'Ö 21.3', 'Änderungen im Wirtschaftsplan 2025 hier: Verschiebung im Investitionsplan', 'DS11/0148', 'ungeändert beschlossen'),
      (38, 'Ö 21.4', 'Erfolgsneutrale Verrechnung der Bilanzierungshilfe des Kommunalen Immobilien Managements mit der allgemeinen Rücklage', 'DS11/0173', 'ungeändert beschlossen'),
      (39, 'Ö 21.5', 'Freiwillige Zuschüsse / Zuschuss zu den Trägeranteilen der Kindertageseinrichtungen in Iserlohn Bezug: DS10/ 0517; DS9/0031; DS8/2664', null, null),
      (40, 'Ö 22', 'Einbringung Stellenplan 2026', 'DS11/0100', 'ungeändert beschlossen'),
      (41, 'Ö 23', 'Entwurf der Haushaltssatzung 2026', 'DS11/0134', 'ungeändert beschlossen'),
      (42, 'Ö 23.1', 'Entwurf der Haushaltssatzung 2026; hier: Fortschreibung des Haushaltssicherungskonzeptes 2025 - 2035 zum Entwurf der Haushaltssatzung 2026', 'DS11/0134-1', 'zur Kenntnis genommen'),
      (43, 'Ö 24', 'Bildung der Kleinen Kommission Finanzen', 'DS11/0093', 'ungeändert beschlossen'),
      (44, 'Ö 24.1', 'Einrichtung der Kleinen Kommission Schulwesen (KKS)', 'DS11/0176', 'ungeändert beschlossen'),
      (45, 'Ö 25', 'Einführung einer Vergabesatzung', 'DS11/0109', 'ungeändert beschlossen'),
      (46, 'Ö 26', 'Allgemeines kommunales Handlungs- und Vergabekonzept für die Nutzung städtischer Räumlichkeiten durch politische Akteure und sonstige Interessenten', 'DS10/3921-1', 'ungeändert beschlossen'),
      (47, 'Ö 27', 'Einführung eines Zweitwunsches beim Anmeldeverfahren für die weiterführenden Schulen in Iserlohner Trägerschaft hier: konkreter Ablauf', 'DS10/3983-1', 'ungeändert beschlossen'),
      (48, 'Ö 28', 'Bildung von Eingangsklassen in Grundschulen für das Schuljahr 2026/27', 'DS11/0084', 'geändert beschlossen'),
      (49, 'Ö 28.1', 'Bildung von Eingangsklassen in Grundschulen für das Schuljahr 2026/27 Hier: Anpassung des Beschlusses zur Zügigkeit an der GS Saat', 'DS11/0084-1', 'zur Kenntnis genommen'),
      (50, 'Ö 29', 'Keine Bereitstellung von Flächen im Stadtwald für Windkraftanlagen / Prüfung restriktiverer Wasserschutzzonen', 'DS10/4161', 'ungeändert beschlossen'),
      (51, 'Ö 30', 'IGW - Iserlohner Gemeinnützige Wohnungsgesellschaft mbH und IGW - Spezialimmobilien GmbH; hier: Wirtschaftsplanungen 2026; STADTprojekt GmbH und STADTprojekt Iserlohn GmbH; hier: Wirtschaftsplanungen 2026 - 2030', 'DS11/0072', 'ungeändert beschlossen'),
      (52, 'Ö 30.1', 'STADTprojekt Iserlohn GmbH; hier: Korrigierte Wirtschaftsplanung der Jahre 2026 bis 2030', 'DS11/0072-1', 'zur Kenntnis genommen'),
      (53, 'Ö 31', 'Schillerplatz GmbH; hier: Wirtschaftsplanung 2026', 'DS11/0073', 'ungeändert beschlossen'),
      (54, 'Ö 32', 'Konzernwirtschaftsplan 2026 der Gesellschaft für Kommunalwirtschaft mbH, Wirtschaftsplan 2026 der Stadtwerke Iserlohn GmbH und Wirtschaftsplan 2026 der Bädergesellschaft Iserlohn mbH', 'DS11/0075', 'ungeändert beschlossen'),
      (55, 'Ö 33', 'Märkischer Stadtbetrieb Iserlohn/Hemer (AöR); hier: Wirtschaftsplanung 2026', 'DS11/0076', 'ungeändert beschlossen'),
      (56, 'Ö 34', 'Märkischer Stadtbetrieb Iserlohn/Hemer (AöR); hier: Jahresabschluss 2024', 'DS11/0078', 'ungeändert beschlossen'),
      (57, 'Ö 35', 'Gesamtabschluss der Stadt Iserlohn 2023', 'DS11/0114', 'ungeändert beschlossen'),
      (58, 'Ö 36', 'Jahresabschluss der Stadt Iserlohn 2024', 'DS11/0113', 'ungeändert beschlossen'),
      (59, 'Ö 37', '13. Änderung des Flächennutzungsplanes -Photovoltaikfreiflächenanlage südlich des Wasserwerkes Krug von Nidda gem. § 2 BauGB, hier: a) Beratung über eingegangene Stellungnahmen, b) Feststellungsbeschluss Bezug: DS11/0051', 'DS11/0050', 'ungeändert beschlossen'),
      (60, 'Ö 38', 'Bebauungsplan Nr. 450 - Photovoltaikfreiflächenanlage südlich des Wasserwerkes Krug von Nidda, hier: a) Beratung über eingegangene Stellungnahmen, b) Satzungsbeschluss, Bezug: DS11/0050', 'DS11/0051', 'ungeändert beschlossen'),
      (61, 'Ö 39', '10. Änderung des Flächennutzungsplanes Photovoltaikfreiflächenanlage Hennen / Im Scherling gem. §2 BauGB hier: a) Beratung über die eingegangenen Stellungnahmen b) Feststellungsbeschluss Bezug DS: 11/0049', 'DS11/0045', 'ungeändert beschlossen'),
      (62, 'Ö 40', 'Bebauungsplan Nr.448 Photovoltaikfreiflächenanlage Hennen / Im Scherling gem. §2 BauGB hier: a) Beratung über die eingegangen Stellungnahmen b) Satzungsbeschluss Bezug DS11/0045', 'DS11/0049', 'ungeändert beschlossen'),
      (63, 'Ö 41', 'Vorhabenbezogener Bebauungsplan Nr. 443 "Alte Poststraße / Baudenkmal Rothes Haus" gem. § § 12 BauGB i. V. m. § 2 BauGB hier: a) Beratung über eingegangene Stellungnahmen b) Satzungsbeschluss', 'DS11/0039', 'ungeändert beschlossen'),
      (64, 'Ö 42', 'Antrags- und Anfragecontrolling Rat der Stadt', 'DS11/0140', 'zur Kenntnis genommen'),
      (65, 'Ö 43', 'Beschlusscontrolling Rat der Stadt', 'DS11/0141', 'zur Kenntnis genommen'),
      (66, 'Ö 44', 'Mitteilungen des Ausschussvorsitzenden und der Verwaltung', null, null),
      (67, 'Ö 45', 'Beantwortung von Anfragen', null, null),
      (68, 'Ö 45.1', 'Nutzung des Gebäudes Reiterweg 28 für die Mehrklassenbildung an der GES Seilersee hier: Rückfrage der damaligen Fraktion DIE LINKE / BSW', 'DS10/3983-1-1', 'behandelt'),
      (69, 'Ö 45.2', '(SPD) Schulmöbellager und zukünftiger Umgang mit Schulmöbeln – Beantwortung der Anfrage im Rat', 'DS11/0171-1', 'behandelt'),
      (70, 'Ö 45.2.1', 'Schulmöbellager und zukünftiger Umgang mit Schulmöbeln hier: Beantwortung der Anfrage der SPD-Fraktion im Rat', 'DS11/0171-1-1', 'behandelt'),
      (71, 'Ö 46', 'Anfragen', null, null),
      (72, 'N 47', '(nichtöffentlich)', null, null),
      (73, 'N 48', '(nichtöffentlich)', null, null),
      (74, 'N 48.1', '(nichtöffentlich)', null, null),
      (75, 'N 49', '(nichtöffentlich)', null, null),
      (76, 'N 50', '(nichtöffentlich)', null, null),
      (77, 'N 51', 'Freiwillige Zuschüsse / Zuschuss zu den Trägeranteilen der Kindertageseinrichtungen in Iserlohn Bezug: DS10/ 0517; DS9/0031; DS8/2664', null, null),
      (78, 'N 52', '(nichtöffentlich)', null, null),
      (79, 'N 52.1', '(nichtöffentlich)', null, null),
      (80, 'N 53', '(nichtöffentlich)', null, null),
      (81, 'N 54', '(nichtöffentlich)', null, null),
      (82, 'N 55', '(nichtöffentlich)', null, null),
      (83, 'N 56', '(nichtöffentlich)', null, null)
  )
  select
    t.reihenfolge,
    t.top_nummer,
    t.top_titel,
    t.drucksache,
    t.ergebnis,
    (
      -- Präfix allein genügt nicht: "DS11/0470" träfe sonst auch auf
      -- "DS11/0470-1 - ..." zu, die eigenständige Ergänzungsvorlage. Nach der
      -- Nummer muss ein Trenner folgen (alles außer Ziffer, / und -).
      select d.id
      from public.dokumente d
      where t.drucksache is not null
        and d.parent_id is null
        and d.titel ilike t.drucksache || '%'
        and (
          length(d.titel) = length(t.drucksache)
          or substr(d.titel, length(t.drucksache) + 1, 1) !~ '[0-9/-]'
        )
      order by d.erstellt_am
      limit 1
    ) as dokument_id
  from tops t;

  -- Ein Dokument darf je Sitzung nur einmal vorkommen (unique aus 0042).
  -- Sollten zwei Nummern auf dasselbe Dokument zeigen, behält der erste Punkt
  -- die Verknüpfung - ein Abbruch der ganzen Migration wäre die schlechtere
  -- Antwort darauf.
  update tagesordnung_import set dokument_id = null
  where ctid in (
    select ctid from (
      select ctid, row_number() over (partition by dokument_id order by reihenfolge) as rang
      from tagesordnung_import
      where dokument_id is not null
    ) d where rang > 1
  );

  -- Weg muss die bisherige importierte Tagesordnung - UND die bereits
  -- vorhandenen Verknüpfungen zu genau den Dokumenten, die jetzt auf der
  -- Tagesordnung stehen: Die Sitzung trägt aus früheren dailyallris-Läufen
  -- Verknüpfungen ohne TOP-Nummer, und unique (session_id, dokument_id) aus
  -- 0042 lässt dasselbe Dokument kein zweites Mal zu. Die Zeile mit
  -- Tagesordnungspunkt ist die reichere, sie ersetzt die blanke. Blanke
  -- Verknüpfungen zu Dokumenten, die NICHT auf der Tagesordnung stehen,
  -- bleiben unangetastet.
  delete from public.sitzung_dokumente
  where session_id = sitzung
    and (
      top_nummer is not null
      or dokument_id in (select i.dokument_id from tagesordnung_import i where i.dokument_id is not null)
    );

  insert into public.sitzung_dokumente (session_id, dokument_id, top_nummer, top_titel, reihenfolge, ergebnis)
  select sitzung, i.dokument_id, i.top_nummer, i.top_titel, i.reihenfolge, i.ergebnis
  from tagesordnung_import i;

  select count(*) into anzahl from tagesordnung_import;
  select count(*) into verknuepft from tagesordnung_import where dokument_id is not null;
  select string_agg(drucksache, ', ' order by reihenfolge) into fehlend
  from tagesordnung_import where drucksache is not null and dokument_id is null;

  raise notice 'Tagesordnung 09.12.2025: % Punkte, % mit Drucksache verknüpft.', anzahl, verknuepft;
  raise notice 'Drucksachen nicht im Hub: %', coalesce(fehlend, 'keine');
end $$;
