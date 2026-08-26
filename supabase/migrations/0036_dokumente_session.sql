-- Dokumente im Dokumenten-Hub können optional mit einer Sitzung verknüpft
-- werden (Nutzerwunsch: nachträgliche Verknüpfung von Dokumenten/ToDos mit
-- Sitzungen über den MCP-Server, siehe supabase/functions/mcp-server/
-- tools/dokumente.ts). todos.session_id existiert bereits seit
-- 0001_init.sql; dokumente hatte bisher keine Sitzungs-Spalte.
--
-- Keine neue RLS-Policy nötig: die bestehenden dokumente_select_*-Policies
-- sind spaltenunabhängig, session_id ändert die Sichtbarkeitslogik nicht.
alter table public.dokumente add column session_id uuid references public.sessions(id);
