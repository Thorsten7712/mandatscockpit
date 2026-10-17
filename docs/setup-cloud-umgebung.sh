#!/bin/bash
# Setup-Skript der Claude-Code-Cloud-Umgebung "Mandatscockpit".
# Liegt hier nur als Vorlage im Repository - wirksam ist die Fassung, die in
# den Einstellungen der Cloud-Umgebung eingetragen ist (Umgebungsmenü in der
# Titelleiste einer Sitzung -> Edit -> Setup script). Änderungen dort
# nachziehen.
#
# Bewusst ohne "set -e": ein fehlgeschlagener Schritt darf die Sitzung nicht
# blockieren - lieber mit Hinweis weiterarbeiten als gar nicht starten.

echo "--- Umgebung ---"
echo "Start-Verzeichnis: $(pwd)"
echo "Node: $(node -v 2>&1)  npm: $(npm -v 2>&1)"

# Das Setup-Skript startet nicht im geklonten Repository.
if [ ! -f package.json ]; then
  treffer="$(find / -maxdepth 4 -name package-lock.json -not -path '*/node_modules/*' 2>/dev/null | head -1)"
  if [ -n "$treffer" ]; then
    cd "$(dirname "$treffer")" || exit 0
    echo "Repository gefunden, arbeite in: $(pwd)"
  else
    echo "WARNUNG: Repository nicht gefunden, überspringe die Installation."
    exit 0
  fi
fi

npm ci || { echo "npm ci fehlgeschlagen, versuche npm install"; npm install; }

# Deno für `deno check` der Edge Functions (supabase/functions/*). Über npm
# statt über das Installationsskript von deno.land: Die npm-Registry ist in
# der Cloud-Umgebung immer erreichbar, deno.land hängt an der Netzwerk-
# Freigabe. Global installiert, damit `deno` ohne npx im PATH liegt.
if ! command -v deno >/dev/null 2>&1; then
  npm install -g deno || echo "WARNUNG: Deno-Installation fehlgeschlagen - deno check steht nicht zur Verfügung."
fi
echo "Deno: $(deno --version 2>&1 | head -1)"

echo "--- fertig in $(pwd) ---"
exit 0
