-- MCP-Zugang: Pro Nutzer ein persönliches Bearer-Token für die
-- MCP-Server-Edge-Function (supabase/functions/mcp-server), damit jedes
-- Mitglied MandatsCockpit direkt aus Claude heraus per Chat steuern kann
-- (ToDos/Termine anlegen, Sitzungstermine abfragen).
--
-- Es wird bewusst nur der SHA-256-Hash des Tokens gespeichert: Settings.tsx
-- erzeugt das Token client-seitig per crypto.getRandomValues, hasht es vor
-- dem Speichern und zeigt den Klartext nur einmalig zum Kopieren an. Ein
-- DB-Dump/Backup-Leak allein würde damit kein nutzbares Token preisgeben.
-- Die Edge Function hasht das eingehende Bearer-Token identisch (Deno
-- crypto.subtle.digest, gleicher Algorithmus) und vergleicht per Lookup.
create table public.mcp_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);

alter table public.mcp_tokens enable row level security;

-- Bewusst NICHT wie profiles_select_own_or_same_fraktion um eine
-- Fraktions-Ausnahme erweitert: Ein Fraktionsbüro-Account darf zwar Termine
-- für Fraktionskolleg*innen anlegen, aber keinesfalls deren MCP-Token
-- einsehen - das Token erlaubt vollen Schreibzugriff auf ToDos/Termine im
-- Namen der jeweiligen Person.
create policy "mcp_tokens_manage_own"
  on public.mcp_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
