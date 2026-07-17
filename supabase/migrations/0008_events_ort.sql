-- Eigene Termine (events) hatten bisher kein Ort-Feld, im Gegensatz zu
-- importierten Sitzungen (sessions.ort). Für die aggregierte Ansicht
-- "Nächste Termine" (Titel, Start, Ort über beide Quellen hinweg) brauchen
-- beide Tabellen ein vergleichbares Ort-Feld.

alter table public.events add column ort text;
