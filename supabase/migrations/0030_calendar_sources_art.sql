-- Kalenderquellen unterscheiden sich in zwei Nutzungsarten (Nutzerwunsch):
-- "sitzung" (Sitzungs-/Gremienkalender, z. B. Stadtrat Iserlohn) - Sitzungen
-- werden gremienweise gefiltert (user_gremien), genau wie bisher; "termin"
-- (reiner Terminkalender ohne Gremien-Konzept) - ALLE Einträge sollen
-- unconditional übernommen werden, ohne Gremien-Auswahl-Schritt.
-- Default 'sitzung' für alle bestehenden Quellen (Stadtrat Iserlohn,
-- Kreistag, Kreistag MK, LWL sind allesamt Gremienkalender).

alter table public.calendar_sources
  add column art text not null default 'sitzung' check (art in ('sitzung', 'termin'));
