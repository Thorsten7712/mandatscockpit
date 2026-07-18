-- Farbe pro Kalenderquelle: gespeichert wird eine Token-Id aus der
-- kuratierten Palette in src/lib/sourceColors.ts (z. B. 'blau', 'gruen'),
-- KEIN Hex-Wert - die Palette ist bewusst auf gedeckte Töne beschränkt, die
-- mit jedem Partei-Theme harmonieren. null = Theme-Primärfarbe (Default).
-- Kein CHECK-Constraint, damit die Palette ohne Migration erweiterbar bleibt;
-- unbekannte Werte fallen im UI auf den Default zurück.
--
-- Bearbeiten dürfen dieselben Nutzer wie beim Rest der Quelle (bestehende
-- Update-Policies aus 0001/0006 greifen, farbe ist nur eine weitere Spalte).

alter table public.calendar_sources add column farbe text;
