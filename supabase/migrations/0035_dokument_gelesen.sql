-- Individuelle Gelesen/Ungelesen-Markierung im Dokumenten-Hub (Dashboard-
-- Badge, fett/nicht-fett auf der Dokumente-Seite und in den Notizen einer
-- Detailansicht). Nur EIN Zeitstempel pro (Top-Level-Dokument, Nutzer) statt
-- je einer Zeile pro Notiz: eine Notiz (dokumente.parent_id gesetzt) wird
-- immer im Kontext ihres Top-Level-Dokuments betrachtet (DokumentDetailModal
-- zeigt Dokument + alle Notizen zusammen), daher reicht "wann habe ich dieses
-- Top-Level-Dokument zuletzt geöffnet" als Referenzpunkt. Eine Notiz gilt als
-- ungelesen, wenn ihr erstellt_am NACH diesem Zeitstempel liegt - kommt eine
-- neue Notiz nach dem letzten Öffnen hinzu, gilt automatisch auch das
-- Top-Level-Dokument wieder als ungelesen. Reine Zeitstempel-Vergleiche beim
-- Anzeigen (siehe src/lib/dokumenteGelesen.ts), kein Trigger nötig.
create table public.dokument_gelesen (
  dokument_id uuid not null references public.dokumente(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  gelesen_am timestamptz not null default now(),
  primary key (dokument_id, user_id)
);

alter table public.dokument_gelesen enable row level security;

-- Rein privat: die eigene Gelesen-Markierung ist für niemand anderen relevant.
create policy "dokument_gelesen_manage_own"
  on public.dokument_gelesen for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
