-- Eigene Anträge: Ablage für selbst verfasste/eingebrachte Anträge mit
-- Workflow-Status, vorgesehenem Ausschuss und optionaler Sitzungs-
-- Verknüpfung. Bewusst rein privat (wie ToDo-Board), gleiches Muster wie
-- Kommentare/Dokumenten-Upload bei todos (0011).

create table public.antraege (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  titel text not null,
  inhalt text,
  status text not null default 'entwurf'
    check (status in ('entwurf', 'eingereicht', 'in_beratung', 'vertagt', 'beschlossen', 'abgelehnt', 'zurueckgezogen')),
  ausschuss text,
  session_id uuid references public.sessions(id),
  mitantragsteller text,
  eingereicht_am date,
  created_at timestamptz not null default now()
);

alter table public.antraege enable row level security;

create policy "antraege_manage_own"
  on public.antraege for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Kommentar-Verlauf pro Antrag, gleiches Muster wie todo_comments (0011).
create table public.antrag_comments (
  id uuid primary key default gen_random_uuid(),
  antrag_id uuid not null references public.antraege(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  inhalt text not null,
  erstellt_am timestamptz not null default now()
);

alter table public.antrag_comments enable row level security;

create policy "antrag_comments_manage_via_antrag_owner"
  on public.antrag_comments for all
  using (exists (select 1 from public.antraege a where a.id = antrag_id and a.user_id = auth.uid()))
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.antraege a where a.id = antrag_id and a.user_id = auth.uid())
  );

-- Dokumenten-Upload für Anträge: summaries um antrag_id erweitern (gleiches
-- Muster wie todo_id in 0011). Bestehende summaries-Policies (user_id =
-- auth.uid()) decken die neue Spalte automatisch mit ab.
alter table public.summaries add column antrag_id uuid references public.antraege(id) on delete cascade;
