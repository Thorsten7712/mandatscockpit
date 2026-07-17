-- MandatsCockpit – initiales Datenmodell (Phase 1 + Grundgerüst für Phase 2/3)
-- Entspricht dem Datenmodell aus docs/KONZEPT.md, Abschnitt 7.
-- Einspielen: Supabase Dashboard -> SQL Editor -> Inhalt einfügen -> Run
-- (oder via Supabase CLI: supabase db push)

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- Profile (1:1 zu auth.users)
-- ─────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  rolle text not null default 'mitglied' check (rolle in ('mitglied', 'fraktionsbuero', 'admin')),
  fraktion text,
  created_at timestamptz not null default now()
);

-- Bei neuem auth-User automatisch ein Profil anlegen
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, rolle)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email), 'mitglied');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- Kalenderquellen (frei konfigurierbar: Stadtrat, Kreistag, Landtag, Bundestag, ...)
-- ─────────────────────────────────────────────────────────────
create table public.calendar_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ebene text not null check (ebene in ('kommune', 'kreis', 'land', 'bund')),
  ics_url text not null,
  verwaltet_von uuid references public.profiles(id), -- null = gemeinsam vom Ratsbüro verwaltet
  created_at timestamptz not null default now()
);

create table public.user_source_subscriptions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_id uuid not null references public.calendar_sources(id) on delete cascade,
  gremium_filter text,
  primary key (user_id, source_id)
);

-- ─────────────────────────────────────────────────────────────
-- Sitzungen (automatisch aus ICS-Quellen importiert – Import-Job noch zu bauen)
-- ─────────────────────────────────────────────────────────────
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.calendar_sources(id),
  titel text not null,
  gremium text,
  ebene text check (ebene in ('kommune', 'kreis', 'land', 'bund')),
  datum timestamptz not null,
  ort text,
  quelle_url text,
  status text not null default 'geplant' check (status in ('geplant', 'aktiv', 'abgeschlossen'))
);

-- ─────────────────────────────────────────────────────────────
-- Dokumente/Anträge (Phase 2)
-- ─────────────────────────────────────────────────────────────
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  titel text not null,
  quelle_url text,
  ausschuss text,
  session_id uuid references public.sessions(id),
  tags text[],
  created_at timestamptz not null default now()
);

-- Hochgeladene Zusammenfassungen (Phase 2)
create table public.summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid references public.documents(id),
  session_id uuid references public.sessions(id),
  inhalt text,
  datei_url text,
  sichtbarkeit text not null default 'privat' check (sichtbarkeit in ('privat', 'geteilt')),
  erstellt_am timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Termine: eigene UND vom Fraktionsbüro eingetragene
-- ─────────────────────────────────────────────────────────────
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade, -- Kalenderinhaber
  titel text not null,
  start timestamptz not null,
  ende timestamptz,
  herkunft text not null default 'privat' check (herkunft in ('privat', 'uebernommene_sitzung', 'fraktionsbuero')),
  erstellt_von uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- ToDo-Board: frei definierbare Spalten je Mitglied (Kanban)
-- ─────────────────────────────────────────────────────────────
create table public.todo_columns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  titel text not null,
  reihenfolge int not null default 0
);

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  column_id uuid not null references public.todo_columns(id) on delete cascade,
  position int not null default 0,
  titel text not null,
  faellig_am date,
  dokument_id uuid references public.documents(id),
  session_id uuid references public.sessions(id),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.calendar_sources enable row level security;
alter table public.user_source_subscriptions enable row level security;
alter table public.sessions enable row level security;
alter table public.documents enable row level security;
alter table public.summaries enable row level security;
alter table public.events enable row level security;
alter table public.todo_columns enable row level security;
alter table public.todos enable row level security;

-- profiles: eigenes Profil + Kolleg*innen der eigenen Fraktion lesen
-- (damit ein Fraktionsbüro-Account weiß, wem es Termine eintragen darf)
create policy "profiles_select_own_or_same_fraktion"
  on public.profiles for select
  using (
    id = auth.uid()
    or fraktion = (select fraktion from public.profiles where id = auth.uid())
  );

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid());

-- calendar_sources: für alle eingeloggten Nutzer lesbar
create policy "calendar_sources_select_all"
  on public.calendar_sources for select
  to authenticated
  using (true);

create policy "calendar_sources_insert_own"
  on public.calendar_sources for insert
  to authenticated
  with check (verwaltet_von = auth.uid());

create policy "calendar_sources_update_own"
  on public.calendar_sources for update
  using (verwaltet_von = auth.uid());

create policy "calendar_sources_delete_own"
  on public.calendar_sources for delete
  using (verwaltet_von = auth.uid());

-- user_source_subscriptions: nur eigene
create policy "subscriptions_manage_own"
  on public.user_source_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- sessions: für alle eingeloggten Nutzer lesbar (Schreiben später nur via Service Role / Import-Job)
create policy "sessions_select_all"
  on public.sessions for select
  to authenticated
  using (true);

-- documents: für alle eingeloggten Nutzer lesbar
create policy "documents_select_all"
  on public.documents for select
  to authenticated
  using (true);

-- summaries: eigene immer verwaltbar, geteilte für alle lesbar
create policy "summaries_manage_own"
  on public.summaries for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "summaries_select_shared"
  on public.summaries for select
  using (sichtbarkeit = 'geteilt');

-- events: eigene lesen/bearbeiten/löschen
create policy "events_select_own"
  on public.events for select
  using (user_id = auth.uid());

create policy "events_update_own"
  on public.events for update
  using (user_id = auth.uid());

create policy "events_delete_own"
  on public.events for delete
  using (user_id = auth.uid());

-- events: Insert für sich selbst ODER als Fraktionsbüro für Mitglieder der eigenen Fraktion
-- (offene Frage aus dem Konzept: darf Fraktionsbüro später auch bearbeiten/löschen? -> aktuell nein)
create policy "events_insert_own_or_fraktionsbuero"
  on public.events for insert
  with check (
    user_id = auth.uid()
    or (
      exists (
        select 1 from public.profiles me
        where me.id = auth.uid() and me.rolle = 'fraktionsbuero'
      )
      and exists (
        select 1 from public.profiles target
        where target.id = user_id
          and target.fraktion = (select fraktion from public.profiles where id = auth.uid())
      )
    )
  );

-- todo_columns / todos: rein privat
create policy "todo_columns_manage_own"
  on public.todo_columns for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "todos_manage_own"
  on public.todos for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- Beispiel-Kalenderquelle für den Start
-- ─────────────────────────────────────────────────────────────
insert into public.calendar_sources (name, ebene, ics_url)
values ('Stadtrat Iserlohn', 'kommune', 'https://www.iserlohn.sitzung-online.de/public/ics/SiKalAbo.ics');
