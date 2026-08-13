-- Presseschau: optionaler, täglicher Presse-Rückblick pro Mitglied. Der
-- Inhalt wird extern (KI-Recherche o.ä.) erstellt und per MCP-Tool als
-- Markdown-Text hochgeladen (kein Datei-Upload nach summaries-Muster - der
-- Inhalt ist reiner Text, der als Zeitungsübersicht gerendert wird, kein
-- Blob, der signierte URLs bräuchte). Pro Nutzer und Tag genau ein Eintrag
-- (unique-Constraint), erneuter Upload für denselben Tag überschreibt
-- (Upsert im MCP-Tool) statt Duplikate anzulegen.
create table public.presseschauen (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  datum date not null,
  titel text,
  quelle text,
  inhalt text not null,
  erstellt_am timestamptz not null default now(),
  unique (user_id, datum)
);

alter table public.presseschauen enable row level security;

create policy "presseschauen_manage_own"
  on public.presseschauen for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Aktivierung/Konfiguration ist rein clientseitig ein An/Aus-Schalter in den
-- eigenen Einstellungen (siehe Settings.tsx) - ohne diese Spalte bliebe der
-- Abschnitt auf dem Dashboard für alle sichtbar, sobald irgendwer per MCP
-- einen Presseschau-Eintrag hochlädt.
alter table public.profiles add column presseschau_aktiv boolean not null default false;
