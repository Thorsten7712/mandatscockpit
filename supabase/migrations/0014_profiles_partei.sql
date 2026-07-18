-- Partei-Zugehörigkeit fürs UI-Theming (CDU/SPD/FDP/... -Theme je nach
-- Partei des Mandatsträgers). Bewusst eine eigene Spalte statt profiles.fraktion
-- zu recyceln: fraktion steuert RLS-Sichtbarkeiten (gleiche Fraktion sieht
-- geteilte Inhalte) und kann von der Partei abweichen (z. B. gemeinsame
-- Fraktionen). partei ist ein reines Anzeige-/Theme-Attribut.
-- Kein CHECK-Constraint: die Theme-Registry im Frontend (src/lib/themes.ts)
-- ist die Quelle der gültigen Werte und soll ohne Migration erweiterbar sein;
-- unbekannte Werte fallen im UI einfach aufs neutrale Theme zurück.

alter table public.profiles add column partei text;
