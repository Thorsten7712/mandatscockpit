-- Tagesordnungspunkte an der Sitzungs-Dokument-Verknüpfung.
--
-- Die Verknüpfungszeile IST der Tagesordnungspunkt: Ein Dokument steht auf der
-- Tagesordnung einer Sitzung unter einer bestimmten Nummer, und dasselbe
-- Dokument kann in einer anderen Sitzung unter einer anderen Nummer stehen
-- (z. B. TOP 7.2 im Finanzausschuss, TOP 3.1 im Rat). Deshalb gehören die
-- Angaben hierher und nicht an dokumente.
--
-- top_nummer ist bewusst text und nicht numerisch: Tagesordnungen nummerieren
-- mehrstufig ("3.1", "10.2.1") und stellen nicht-öffentliche Teile gern mit
-- einem Präfix voran ("N 4.2").
--
-- reihenfolge gibt es zusätzlich, weil sich top_nummer nicht sinnvoll
-- sortieren lässt: als Text käme "3.10" vor "3.2". Maßgeblich ist die
-- Reihenfolge, in der die Punkte auf der Tagesordnung stehen - die kennt nur
-- der Importeur.
--
-- Alle drei Felder sind optional: Verknüpfungen ohne Tagesordnungsbezug
-- (von Hand im Cockpit gesetzt) bleiben gültig.
alter table public.sitzung_dokumente add column top_nummer text;
alter table public.sitzung_dokumente add column top_titel text;
alter table public.sitzung_dokumente add column reihenfolge integer;

-- Keine neue RLS-Policy nötig: die bestehenden sitzung_dokumente_*-Policies
-- (0042) sind spaltenunabhängig.
