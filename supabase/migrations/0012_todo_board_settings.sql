-- Karten-Anzeige-Einstellungen fürs ToDo-Board (welche Detail-Badges auf
-- den Karten erscheinen), konfigurierbar in Settings unter "ToDo-Board".
-- Spalten-Verwaltung selbst braucht keine neue Tabelle (todo_columns
-- existiert schon), nur die UI wandert von TodoBoard.tsx nach Settings.tsx.

create table public.todo_board_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  zeige_termin boolean not null default true,
  zeige_zustaendig boolean not null default true
);

alter table public.todo_board_settings enable row level security;

create policy "todo_board_settings_manage_own"
  on public.todo_board_settings for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
