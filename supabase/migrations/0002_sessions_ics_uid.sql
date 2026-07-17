-- Stabiler Schlüssel für den ICS-Import: jedes VEVENT hat eine UID, die pro
-- Quelle eindeutig ist. Damit kann der Import-Job per Upsert erneut laufen,
-- ohne Duplikate zu erzeugen, und bestehende Zeilen (inkl. manuell gesetztem
-- status = 'aktiv') aktualisieren statt zu duplizieren.

alter table public.sessions add column ics_uid text;

-- Partial unique index statt table constraint, da manuell angelegte
-- Sessions (falls es die je gibt) kein ics_uid haben.
create unique index sessions_source_ics_uid_key
  on public.sessions (source_id, ics_uid)
  where ics_uid is not null;
