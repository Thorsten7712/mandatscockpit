-- Gliederung: profiles.ebenen (0020) markiert bisher nur grob die Ebene
-- (kommune/kreis/land/bund), ohne WELCHE Kommune/WELCHEN Kreis/WELCHES
-- Land - zwei Mitglieder derselben Partei aus unterschiedlichen Städten
-- würden dadurch fälschlich als Teilen-Kandidaten füreinander erscheinen
-- (siehe TodoDetailModal.tsx/AntragDetailModal.tsx loadCandidates()). Bund
-- braucht keine weitere Angabe, da es nur einen Bundestag gibt.
alter table public.profiles
  add column gliederung_kommune text,
  add column gliederung_kreis text,
  add column gliederung_land text;
