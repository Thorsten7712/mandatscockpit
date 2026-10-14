-- Die Tagesordnung einer Sitzung vollständig abbilden - auch Punkte ohne
-- Drucksache - und das Beratungsergebnis festhalten.
--
-- Anlass: Die Tagesordnungen aus ALLRIS enthalten zu einem erheblichen Teil
-- Punkte ohne Vorlage ("Eröffnung der Sitzung", "Einwohnerfragestunde",
-- "Mitteilungen des Vorsitzenden"). Gemessen am Rat der Stadt Iserlohn vom
-- 09.12.2025: 84 Punkte, davon 63 mit und 21 ohne Drucksache. Mit
-- dokument_id NOT NULL (0042) ließen sich nur die 63 speichern - die linke
-- Spalte der Sitzungsansicht zeigte dann eine Tagesordnung mit Löchern, in
-- der die Nummerierung springt. Für die Sitzungsvorbereitung ist das
-- unbrauchbar: gerade die Punkte ohne Vorlage strukturieren den Ablauf.
--
-- Damit wird die Zeile endgültig zum Tagesordnungspunkt, der ein Dokument
-- tragen KANN. Der Tabellenname bleibt sitzung_dokumente: er beschreibt
-- weiterhin korrekt die Mehrheit der Zeilen, und ein Rename hätte Frontend,
-- MCP-Server und vier Policies angefasst, ohne etwas zu verbessern.
alter table public.sitzung_dokumente alter column dokument_id drop not null;

-- Das Beratungsergebnis, das die Tagesordnung in der Spalte "Zuständigkeit"
-- mitführt: "ungeändert beschlossen", "geändert beschlossen", "abgelehnt",
-- "zur Kenntnis genommen", "behandelt". Bewusst Freitext und kein Enum - die
-- Wertemenge gehört ALLRIS, nicht diesem Projekt, und ein unbekannter Wert
-- darf einen Import nicht abbrechen lassen.
--
-- Es gehört an den Tagesordnungspunkt und nicht an das Dokument: dieselbe
-- Vorlage wird im Fachausschuss empfohlen und im Rat beschlossen, mit
-- unterschiedlichem Ergebnis.
alter table public.sitzung_dokumente add column ergebnis text;

-- Idempotenz des Tagesordnungs-Imports: Bisher hing sie allein an
-- unique (session_id, dokument_id). Bei dokument_id = null greift die nicht
-- (NULL ist in Postgres zu jedem anderen NULL ungleich), ein zweiter Lauf
-- hätte also alle Punkte ohne Drucksache dupliziert. Die Tagesordnung hat
-- einen natürlichen Schlüssel: die TOP-Nummer ist innerhalb einer Sitzung
-- eindeutig.
--
-- Partiell, damit die von Hand im Cockpit gesetzten Verknüpfungen ohne
-- Tagesordnungsbezug (top_nummer is null) davon unberührt bleiben.
create unique index sitzung_dokumente_top_nummer_uniq
  on public.sitzung_dokumente (session_id, top_nummer)
  where top_nummer is not null;

-- SELECT: Die bisherige Policy prüfte ausschließlich das Dokument - bei
-- dokument_id = null ist ihr exists() false und der Punkt wäre für
-- niemanden sichtbar. Ein Punkt ohne Dokument trägt nur den Wortlaut der
-- Tagesordnung und ist daher so sichtbar wie die Sitzung selbst (die
-- Subquery läuft nicht als SECURITY DEFINER und wird deshalb von
-- sessions_select_visible_source mitgefiltert).
drop policy if exists "sitzung_dokumente_select" on public.sitzung_dokumente;
create policy "sitzung_dokumente_select"
  on public.sitzung_dokumente for select
  using (
    (dokument_id is not null and exists (select 1 from public.dokumente d where d.id = dokument_id))
    or (dokument_id is null and exists (select 1 from public.sessions s where s.id = session_id))
  );

-- INSERT/DELETE: Für Zeilen mit Dokument bleibt es beim Eigentümer des
-- Dokuments. Für Punkte ohne Dokument gibt es kein Dokument, an dem die
-- Berechtigung hängen könnte - dort entscheidet die Sitzung, und zwar nur
-- bei selbst nachgetragenen (sessions.erstellt_von, vgl.
-- sessions_update_own_manuell in 0028/0029). Importierte Sitzungen gehören
-- niemandem; ihre Tagesordnung kommt über den MCP-Server, der mit dem
-- Service-Role-Client an RLS vorbei arbeitet.
drop policy if exists "sitzung_dokumente_insert" on public.sitzung_dokumente;
create policy "sitzung_dokumente_insert"
  on public.sitzung_dokumente for insert
  with check (
    (dokument_id is not null and exists (
      select 1 from public.dokumente d where d.id = dokument_id and d.user_id = auth.uid()
    ))
    or (dokument_id is null and exists (
      select 1 from public.sessions s where s.id = session_id and s.erstellt_von = auth.uid()
    ))
  );

drop policy if exists "sitzung_dokumente_delete" on public.sitzung_dokumente;
create policy "sitzung_dokumente_delete"
  on public.sitzung_dokumente for delete
  using (
    (dokument_id is not null and exists (
      select 1 from public.dokumente d where d.id = dokument_id and d.user_id = auth.uid()
    ))
    or (dokument_id is null and exists (
      select 1 from public.sessions s where s.id = session_id and s.erstellt_von = auth.uid()
    ))
  );

-- Kein UPDATE: Die Tagesordnung wird importiert, nicht in der Web-UI
-- redigiert. Der MCP-Server umgeht RLS ohnehin; sollte die Oberfläche das
-- später brauchen, kommt die Policy dann dazu.
