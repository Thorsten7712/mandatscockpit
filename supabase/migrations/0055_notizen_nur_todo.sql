-- Ein Notiz-System (Entscheidung 17.10.2026, docs/ARCHITEKTUR-PLAN.md):
-- Notizen gibt es nur noch an ToDo-Karten (summaries.todo_id) und an
-- Dokumenten im Hub (dokumente.parent_id). Kommentare entfallen, ebenso
-- Notizen direkt an Sitzungen, Terminen und Anträgen. Was zu einer Sitzung
-- gehört, steht an den verknüpften Karten und Dokumenten und wird in der
-- Sitzungsansicht von dort angezeigt (TerminDetailPanel.tsx).
--
-- Diese Migration sperrt nur die alten Wege. Die Altdaten räumt
-- scripts/wartung-notizen.mjs ab (ToDo-Kommentare werden zu Notizen,
-- Sitzungs- und Termin-Notizen werden gesichert und gelöscht) - Löschungen
-- über den Supabase-Connector hängen (siehe CLAUDE.md), und über die
-- Service-Role landen sie mit Herkunft im Löschprotokoll (0053).
--
-- Die Tabellen todo_comments und antrag_comments bleiben vorerst stehen,
-- leer und ohne Schreibweg; ein DROP folgt mit dem nächsten
-- `supabase db push` vom Mac.


-- Notizen: nur noch Text an einer Karte, die man selbst angelegt hat oder
-- die auf dem eigenen Board liegt. Die Unterabfrage auf todos läuft mit den
-- Rechten des Aufrufers, liefert also genau die für ihn sichtbaren Karten
-- (todos_select_own_or_placed) - keine Rekursion, weil sie nicht summaries
-- abfragt. Gilt für INSERT und UPDATE (die Policy ist FOR ALL).
alter policy summaries_manage_own on public.summaries
  with check (
    user_id = (select auth.uid())
    and todo_id is not null
    and session_id is null
    and event_id is null
    and antrag_id is null
    and datei_url is null
    and exists (select 1 from public.todos t where t.id = todo_id)
  );

-- "geteilt" stammt aus 0001 und gab eine Notiz für ALLE angemeldeten Nutzer
-- frei, unabhängig von Partei oder Karte. Es gibt keine solche Zeile, und
-- Notizen an Karten teilen sich seither über die Platzierung - die Policy
-- würde nur noch eine künftige Fehlbelegung öffentlich machen.
alter policy summaries_select_shared on public.summaries
  using (false);

-- Kommentare: kein neuer Eintrag mehr.
alter policy todo_comments_insert_via_placement on public.todo_comments
  with check (false);
alter policy antrag_comments_insert on public.antrag_comments
  with check (false);


-- Sicherheitsnetz: die vier Policies tragen die neuen Bedingungen.
do $$
declare
  falsch text;
begin
  select string_agg(policyname, ', ') into falsch
  from pg_policies
  where schemaname = 'public'
    and (
      (policyname = 'summaries_manage_own' and with_check not like '%todo_id IS NOT NULL%')
      or (policyname = 'summaries_select_shared' and qual <> 'false')
      or (policyname = 'todo_comments_insert_via_placement' and with_check <> 'false')
      or (policyname = 'antrag_comments_insert' and with_check <> 'false')
    );
  if falsch is not null then
    raise exception 'Policies nicht wie erwartet: %', falsch;
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and policyname in (
        'summaries_manage_own', 'summaries_select_shared', 'todo_comments_insert_via_placement', 'antrag_comments_insert')) <> 4 then
    raise exception 'Nicht alle vier Policies gefunden';
  end if;
end $$;
