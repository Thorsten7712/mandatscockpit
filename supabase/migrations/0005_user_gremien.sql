-- Mandats-Gremien: welche Gremien (Ausschüsse etc.) ein Mitglied ankreuzt,
-- weil es dort ein Mandat hat. Der Dashboard-Kalender zeigt anschließend nur
-- Sitzungen dieser Gremien an (sessions.gremium).
--
-- Bewusst eine eigene Tabelle statt Wiederverwendung von
-- user_source_subscriptions.gremium_filter: letztere ist auf genau einen
-- Filterwert pro (user_id, source_id) begrenzt (PRIMARY KEY), ein Mitglied
-- kann aber in mehreren Gremien gleichzeitig ein Mandat haben.

create table public.user_gremien (
  user_id uuid not null references public.profiles(id) on delete cascade,
  gremium text not null,
  primary key (user_id, gremium)
);

alter table public.user_gremien enable row level security;

create policy "user_gremien_manage_own"
  on public.user_gremien for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
