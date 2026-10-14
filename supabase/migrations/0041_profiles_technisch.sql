-- Technische Konten als solche kennzeichnen.
--
-- Anlass: Der ALLRIS-Import von dailyallris läuft seit Oktober 2026 über ein
-- eigenes Konto statt über das persönliche Token eines Mitglieds (begrenzt den
-- Schaden, falls das Token aus der .env abhandenkommt). Dieses Konto erfüllt
-- aber dieselben Bedingungen wie ein echtes Mitglied - gleiche Partei, gleiche
-- Ebene, gleiche Gliederung - und taucht deshalb in jeder Teilen-Kandidatenliste
-- auf, als könne man ihm eine ToDo-Karte zuweisen.
--
-- Bewusst eine eigene Spalte statt einer zusätzlichen `rolle`: rolle steuert
-- Rechte (admin/fraktionsbuero/mitglied) und wird an mehreren Stellen geprüft.
-- "Ist das ein Mensch?" ist eine davon unabhängige Eigenschaft - ein
-- technisches Konto bleibt rechtlich ein normales Mitglied.
--
-- Keine RLS-Änderung nötig: die bestehenden profiles-Policies sind
-- spaltenunabhängig. Das Ausblenden passiert dort, wo auch der exakte
-- Partei-/Ebenen-/Gliederungs-Abgleich stattfindet - clientseitig in
-- loadCandidates() und im MCP-Tool-Code (resolveTeilenMitNamen). Das ist eine
-- Aufräum-Maßnahme für die Oberfläche, keine Zugriffsgrenze: wer die
-- user_id kennt, könnte eine Freigabe weiterhin direkt anlegen.
alter table public.profiles add column technisch boolean not null default false;

-- Das bereits angelegte Import-Konto gleich mitnehmen, damit die Umstellung
-- nicht erst mit einem Handgriff in der Benutzerverwaltung wirkt.
update public.profiles set technisch = true where name = 'ALLRIS-Import';
