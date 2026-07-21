-- Erzwungener Passwortwechsel: Admins vergeben beim Anlegen ein
-- Start-Passwort bzw. können ein Passwort zurücksetzen (siehe
-- admin-users-Edge-Function). Ein Nutzer soll ein admin-vergebenes
-- Passwort nie dauerhaft behalten dürfen - der Nutzer muss beim ersten
-- Login (bzw. nach einem Admin-Reset) zwingend ein eigenes Passwort setzen.
alter table public.profiles
  add column muss_passwort_aendern boolean not null default true;

-- Bestehende, bereits aktive Nutzer nicht rückwirkend zwingen - nur neu
-- angelegte oder per Admin zurückgesetzte Passwörter lösen den Zwang aus.
update public.profiles set muss_passwort_aendern = false;
