-- Der Partial-Unique-Index aus 0002 funktioniert nicht als ON-CONFLICT-Ziel
-- für den ICS-Import-Job: Postgres akzeptiert für "ON CONFLICT (col, col)"
-- nur vollständige Unique-Constraints/Indizes, keine partiellen (WHERE ...).
-- Das führte zu "there is no unique or exclusion constraint matching the
-- ON CONFLICT specification" bei jedem Upsert-Versuch.
--
-- Der Partial-Index war ohnehin unnötig: ein normaler UNIQUE-Constraint
-- behandelt NULL-Werte nie als Duplikat, erlaubt also weiterhin beliebig
-- viele manuell angelegte Sessions mit ics_uid = null.

drop index if exists public.sessions_source_ics_uid_key;

alter table public.sessions
  add constraint sessions_source_ics_uid_key unique (source_id, ics_uid);
