-- "Zahlen und Fakten" sind immer Ebenen-Material, nie privat.
--
-- 0039_fakten.sql hatte das Sichtbarkeitsmodell von dokumente übernommen
-- ('persoenlich' oder 'geteilt'). Nutzerentscheidung danach: Fakten sollen
-- "grundsätzlich immer allen auf der entsprechenden Ebene zur Verfügung
-- stehen" - eine private Argumentationshilfe widerspricht dem Zweck der
-- Seite (gemeinsames Material für Debatte und Bürgergespräch). Wer etwas
-- nur für sich notieren will, hat dafür den Dokumenten-Hub mit
-- sichtbarkeit='persoenlich'.
--
-- Die Spalte sichtbarkeit bleibt bewusst erhalten (statt sie zu droppen):
-- sie wird von der bestehenden Policy fakten_select_shared gelesen, und ein
-- Drop wäre eine destruktive Änderung ohne Gewinn. Sie ist jetzt auf genau
-- einen erlaubten Wert eingeschränkt und dokumentiert damit die Entscheidung
-- an der Stelle, an der sie gilt.
--
-- Gefahrlos, weil die Tabelle zum Zeitpunkt dieser Migration noch leer ist
-- (0039 wurde am selben Tag eingespielt, es gibt keine 'persoenlich'-Zeilen
-- und keine Zeilen ohne ebene, die die neuen Constraints verletzen würden).
alter table public.fakten drop constraint fakten_sichtbarkeit_check;
alter table public.fakten add constraint fakten_sichtbarkeit_check check (sichtbarkeit = 'geteilt');
alter table public.fakten alter column sichtbarkeit set default 'geteilt';

-- ebene ist damit Pflicht: ohne sie kann fakten_select_shared nicht
-- entscheiden, für wen der Fakt gilt.
alter table public.fakten alter column ebene set not null;
