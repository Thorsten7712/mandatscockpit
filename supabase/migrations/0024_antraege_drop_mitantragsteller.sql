-- Freitext-Mitantragsteller entfällt: das Konzept wurde durch die
-- Teilen-Funktion (antrag_shares, siehe 0023) ersetzt - die geteilten
-- Kolleg*innen SIND jetzt die Mitantragsteller, kein separates Freitextfeld
-- mehr nötig (Nutzerentscheidung nach dem ersten Rollout von 0023).
alter table public.antraege drop column mitantragsteller;
