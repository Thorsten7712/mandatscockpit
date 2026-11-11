-- 0064: Profilspalten absichern + Nutzungserklärung
--
-- (1) Sicherheitslücke: Die Policy profiles_update_own prüft nur, dass jemand
--     seine EIGENE Zeile ändert – nicht, welche Spalten. authenticated (und anon)
--     hatten UPDATE auf allen Spalten. Damit konnte sich jedes angemeldete Konto
--     per REST selbst rolle='admin', technisch=true oder eine andere partei/
--     fraktion geben (partei und fraktion steuern die gesamte Sichtbarkeit).
--     Fix über Spaltenrechte statt Trigger: die Oberfläche ändert nur die unten
--     freigegebenen Spalten (Settings.tsx, ForcedPasswordChange.tsx, Nutzungs-
--     erklärung); rolle, technisch, partei, fraktion, id, created_at setzt nur noch
--     admin-users mit der Service-Role, die von Spaltenrechten nicht betroffen ist.
--     Neue Spalten sind nach dem Revoke NICHT automatisch beschreibbar – wer eine
--     vom Nutzer änderbare Spalte ergänzt, muss sie hier unten nachtragen.
--
-- (2) Nutzungserklärung: Beim ersten Login (und nach jeder neuen Fassung) muss
--     jedes Konto bestätigen, keine nichtöffentlichen Unterlagen einzustellen.
--     Version + Zeitpunkt in profiles, damit es geräteübergreifend gilt. Die
--     Fassung steht im Frontend (NUTZUNGSERKLAERUNG_VERSION in
--     src/components/Nutzungserklaerung.tsx); eine höhere Nummer fragt alle neu.

alter table public.profiles
  add column if not exists nutzungserklaerung_version integer,
  add column if not exists nutzungserklaerung_am timestamptz;

comment on column public.profiles.nutzungserklaerung_version is
  'Fassung der Nutzungserklärung, die das Konto zuletzt bestätigt hat (null = nie).';
comment on column public.profiles.nutzungserklaerung_am is
  'Zeitpunkt der letzten Bestätigung der Nutzungserklärung.';

revoke update on public.profiles from anon, authenticated;

grant update (
  name,
  foto_url,
  ebenen,
  gliederung_kommune,
  gliederung_kreis,
  gliederung_land,
  presseschau_aktiv,
  muss_passwort_aendern,
  nutzungserklaerung_version,
  nutzungserklaerung_am
) on public.profiles to authenticated;
