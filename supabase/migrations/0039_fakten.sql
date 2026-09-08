-- "Zahlen und Fakten": eigener Reiter neben Archiv und Dokumenten-Hub mit
-- Argumentationshilfen, Sprachregelungen und belegten Kennzahlen - das
-- Material, das Mandatsträger*innen in Debatte, Interview und Bürgergespräch
-- griffbereit brauchen.
--
-- Bewusst eine eigene Tabelle statt einer Tag-Sicht auf dokumente
-- (0033_dokumente.sql): Fakten sind kurze, wiederverwendbare Textbausteine mit
-- Belegpflicht (quelle + stand) und - bei kategorie='zahl' - einer
-- herausgehobenen Kennzahl. Ein Dokument dagegen ist ein einzelnes,
-- datiertes Artefakt (Sitzungsvorlage, Analyse) mit Datei-Anhang, Notizen-
-- Baum und Gelesen-Status. Beides in einer Tabelle würde entweder den
-- Dokumenten-Hub mit Kennzahl-Spalten aufblähen oder die Fakten in einer
-- nach Datum sortierten Dokumentenliste untergehen lassen.
create table public.fakten (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- 'argumentationshilfe' = Argument + Gegenargument/Erwiderung,
  -- 'sprachregelung'      = wie wir worüber sprechen (und wie nicht),
  -- 'zahl'                = belegte Kennzahl mit Quelle und Stand.
  kategorie text not null check (kategorie in ('argumentationshilfe', 'sprachregelung', 'zahl')),
  titel text not null,
  -- Fließtext: das Argument, die Sprachregelung bzw. die Einordnung der Zahl.
  inhalt text,
  -- Nur bei kategorie='zahl' gefüllt: der herausgestellte Wert ("12,5", "1.240")
  -- und seine Einheit ("%", "Mio. €", "Wohnungen"). Bewusst text und nicht
  -- numeric - Kennzahlen aus Veröffentlichungen kommen mit Tausenderpunkten,
  -- Näherungen ("rund 1.200") und Spannen ("8-12"), die eine Zahlenspalte
  -- entweder verfälschen oder ganz ablehnen würde.
  kennzahl text,
  einheit text,
  -- Belegangaben. quelle ist Freitext (Behörde, Studie, Drucksache, URL),
  -- stand das Datum, auf das sich die Angabe bezieht - beides entscheidet
  -- darüber, ob man den Fakt in einer Debatte zitieren kann.
  quelle text,
  stand date,
  tags text[] not null default '{}'::text[],
  -- Gleiches Sichtbarkeitsmodell wie dokumente (0033_dokumente.sql):
  -- 'persoenlich' = nur ich, 'geteilt' = alle Mitglieder derselben Partei UND
  -- derselben Ebene/Gliederung. Kein 'einzelpersonen' wie bei Notizen im
  -- Dokumenten-Hub - ein Fakt ist Fraktionsmaterial, keine private Analyse
  -- zu einem einzelnen Vorgang.
  sichtbarkeit text not null check (sichtbarkeit in ('persoenlich', 'geteilt')),
  -- ebene/gliederung nur bei sichtbarkeit='geteilt' gesetzt. gliederung wird
  -- wie bei dokumente IMMER aus dem Profil des Erstellers übernommen, nie als
  -- freier String entgegengenommen - sonst könnte Material an die falsche
  -- Gliederung "leaken" oder für die richtige unsichtbar bleiben.
  ebene text check (ebene in ('kommune', 'kreis', 'land', 'bund')),
  gliederung text,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now()
);

alter table public.fakten enable row level security;

-- Dieselben vier Policies wie dokumente (0033_dokumente.sql), inklusive der
-- dort angelegten SECURITY DEFINER-Helper current_user_partei()/
-- current_user_ebenen() (0020_profiles_ebenen.sql) und
-- current_user_gliederung_matches() (0033_dokumente.sql). Keine Rekursions-
-- gefahr: die Helper fragen profiles direkt ab, nicht fakten.
create policy "fakten_select_own"
  on public.fakten for select
  using (user_id = auth.uid());

create policy "fakten_select_shared"
  on public.fakten for select
  using (
    sichtbarkeit = 'geteilt'
    and exists (
      select 1 from public.profiles ersteller
      where ersteller.id = fakten.user_id
        and ersteller.partei is not null
        and ersteller.partei = public.current_user_partei()
    )
    and fakten.ebene = any(public.current_user_ebenen())
    and public.current_user_gliederung_matches(fakten.ebene, fakten.gliederung)
  );

create policy "fakten_insert_own"
  on public.fakten for insert
  with check (user_id = auth.uid());

create policy "fakten_update_own"
  on public.fakten for update
  using (user_id = auth.uid());

create policy "fakten_delete_own"
  on public.fakten for delete
  using (user_id = auth.uid());
