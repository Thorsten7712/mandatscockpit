"""Markiert Hub-Dokumente, deren Original-PDF inhaltlich wichtige Bilder hat.

Der Text der ALLRIS-Vorlagen liegt als Markdown in dokumente.inhalt, Bilder
(Lagepläne, Karten, Diagramme, als Bild eingefügte Tabellen, eingescannte
Seiten) gehen dabei verloren. Statt sie im Hub nachzubauen, bekommt das
Dokument den Tag "Enthält Bilder" - dann weiß man, dass sich ein Blick ins PDF
lohnt. Entscheidung 18.10.2026; dieselbe Prüfung macht dailyallris künftig
beim Import.

Wann ein Bild zählt (gleiche Regel wie in dailyallris):
  - mindestens 300 x 200 Pixel groß und
  - mindestens 10 % der Seitenfläche und
  - nicht in 5 oder mehr PDFs identisch vorhanden (Logo, Wappen, Briefkopf).

Läuft über .github/workflows/wartung.yml (skript=bilder). Das Repository ist
öffentlich: ins Protokoll kommen nur Zahlen, keine Titel oder Inhalte.
MODUS=probe zählt nur. Mehrfaches Ausführen ist unschädlich.

Das Skript setzt den Tag nur, es entfernt ihn nie: dailyallris prüft seit
18.10.2026 zusätzlich die Anlagen einer Vorlage aus ALLRIS (Lagepläne,
Gutachten), die nicht im Hub liegen. Ein Tag ohne Bild im Vorlagen-PDF ist
deshalb kein Fehler - ein Entfernen würde diese Befunde wieder löschen.
"""

import collections
import os
import sys
import urllib.parse

import pymupdf
import requests

TAG = "Enthält Bilder"
MIN_BREITE, MIN_HOEHE = 300, 200
MIN_FLAECHE = 0.10
WIEDERHOLT_AB = 5

url = os.environ.get("SUPABASE_URL", "").rstrip("/")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
aendern = os.environ.get("MODUS") == "ausfuehren"
if not url or not key:
    sys.exit("SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY fehlen.")

sitzung = requests.Session()
sitzung.headers.update({"apikey": key, "Authorization": f"Bearer {key}", "x-mc-quelle": "wartung-bilder"})
print(f"Modus: {'ausfuehren' if aendern else 'probe (es wird nichts geändert)'}")

# PostgREST liefert höchstens 1.000 Zeilen je Abfrage - seitenweise laden.
dokumente = []
for von in range(0, 100_000, 500):
    r = sitzung.get(
        f"{url}/rest/v1/dokumente",
        params={
            "select": "id,datei_url,tags",
            "parent_id": "is.null",
            "datei_url": "ilike.*.pdf",
            "order": "id",
            "limit": 500,
            "offset": von,
        },
    )
    r.raise_for_status()
    dokumente.extend(r.json())
    if len(r.json()) < 500:
        break
print(f"{len(dokumente)} Dokumente mit PDF")

# Erster Durchgang: je PDF die ausreichend großen Bilder mit Prüfsumme.
kandidaten = {}  # dokument_id -> [prüfsumme, ...]
vorkommen = collections.Counter()  # prüfsumme -> Anzahl PDFs
fehler = 0
for d in dokumente:
    pfad = urllib.parse.quote(d["datei_url"])
    r = sitzung.get(f"{url}/storage/v1/object/dokumente/{pfad}")
    if r.status_code != 200:
        fehler += 1
        continue
    try:
        pdf = pymupdf.open(stream=r.content, filetype="pdf")
    except Exception:
        fehler += 1
        continue
    gefunden = []
    for seite in pdf:
        seitenflaeche = abs(seite.rect) or 1
        for bild in seite.get_image_info(hashes=True):
            if bild["width"] < MIN_BREITE or bild["height"] < MIN_HOEHE:
                continue
            if abs(pymupdf.Rect(bild["bbox"]) & seite.rect) / seitenflaeche < MIN_FLAECHE:
                continue
            gefunden.append(bild["digest"].hex())
    pdf.close()
    kandidaten[d["id"]] = gefunden
    for pruefsumme in set(gefunden):
        vorkommen[pruefsumme] += 1

# Zweiter Durchgang: wiederkehrende Bilder (Logos, Briefköpfe) herausnehmen.
wiederholt = {p for p, n in vorkommen.items() if n >= WIEDERHOLT_AB}
mit_bildern = {i for i, liste in kandidaten.items() if any(p not in wiederholt for p in liste)}
print(f"Nicht lesbar: {fehler}")
print(f"Wiederkehrende Bilder (Logo/Briefkopf), ignoriert: {len(wiederholt)}")
print(f"Dokumente mit wichtigen Bildern: {len(mit_bildern)}")

setzen = [d for d in dokumente if d["id"] in mit_bildern and TAG not in (d["tags"] or [])]
print(f"Tag setzen: {len(setzen)}")

if aendern:
    for d in setzen:
        r = sitzung.patch(
            f"{url}/rest/v1/dokumente",
            params={"id": f"eq.{d['id']}"},
            json={"tags": (d["tags"] or []) + [TAG]},
            headers={"Prefer": "return=minimal"},
        )
        r.raise_for_status()
    print(f"Aktualisiert: {len(setzen)}")
