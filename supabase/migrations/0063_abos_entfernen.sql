-- Kalender-Abos entfernen (Entscheidung 18.10.2026).
--
-- user_source_subscriptions hielt fest, welche Kalenderquelle jemand
-- "abonniert" hat. Gelesen hat das außer dem Haken in den Einstellungen
-- niemand: Der Kalender, das Archiv und list_sessions zeigen alles aus den
-- sichtbaren Quellen (gemeinsame und eigene, RLS) und filtern über "Meine
-- Gremien". Der Haken änderte also nichts - und die alte offene Frage nach
-- "verwaisten Abos" beim Löschen einer Quelle erledigt sich mit ihm. Löschen
-- und Ändern gemeinsamer Quellen bleibt Admins vorbehalten
-- (calendar_sources_delete/update_own_or_shared_admin), eigene Quellen sieht
-- ohnehin nur ihr Besitzer.
--
-- gremium_filter (seit 0001 ungenutzt) geht mit.
--
-- Enthält DROP und läuft deshalb über den Workflow migrationen.yml.

drop table public.user_source_subscriptions;
