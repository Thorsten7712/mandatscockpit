-- sessions.source_id hatte keine ON DELETE-Regel (Postgres-Default: RESTRICT),
-- wodurch das Löschen einer eigenen calendar_sources-Zeile mit einer
-- Foreign-Key-Verletzung fehlschlug, sobald der ICS-Import-Job Sessions dafür
-- angelegt hatte. Beim Löschen einer Quelle sollen auch die daraus
-- importierten Sessions verschwinden, nicht als Datenleiche mit source_id = null
-- stehen bleiben.

alter table public.sessions drop constraint if exists sessions_source_id_fkey;

alter table public.sessions
  add constraint sessions_source_id_fkey
  foreign key (source_id) references public.calendar_sources(id) on delete cascade;
