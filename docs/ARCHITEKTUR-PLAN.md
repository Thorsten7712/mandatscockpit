# Architektur-Aufräumen – Entscheidungen und Plan

Stand: 17.10.2026. Grundlage war ein Scan von Code und Live-Datenbank; die Entscheidungen hat der
Nutzer am selben Tag getroffen. Diese Datei ist die Arbeitsliste für die folgenden Sitzungen –
Erledigtes wird hier abgehakt, die Begründungen stehen ausführlich im CHANGELOG.

## Entscheidungen

### Dateien und Speicher
- **Nutzer laden keine Dateien mehr hoch.** Notizen sind reiner Text. Hochladen darf nur noch das
  technische Konto (ALLRIS-Import) in den Bucket `dokumente` – dort gilt **keine** 25-MB-Grenze.
- **Ausnahme Profilbilder:** bleiben, höchstens 2 MB, nur Bildformate.
- Eine Quota pro Nutzer ist damit überflüssig. Stattdessen sehen Admins die Belegung je Bucket und
  Person gegen die Free-Tier-Grenze (1 GB) in den Einstellungen.
- Bestehende Dateien: die des Nutzers Thorsten Kois werden gelöscht, die anderer Mitglieder vorher
  vorgelegt. Die 237 Drucksachen-Dateien in seinem Ordner gehören dem technischen Konto und werden
  dorthin umgezogen. Dateien ohne Verweis werden gelöscht.

### Benachrichtigungen
- **Keine Mails** vorerst. Stattdessen zeigt das Cockpit selbst, was seit dem letzten Besuch passiert
  ist: neue Tagesordnungen für kommende Sitzungen, anstehende Sitzungen der eigenen Gremien,
  ablaufende Fristen, neue Zuweisungen.

### Betrieb
- **Prüfung vor dem Merge** (Lint, Build, `deno check`) als Workflow auf jeden PR.
- **Backup:** nächtlicher Datenbank-Dump per GitHub Action dieses Repos, verschlüsselt als
  Workflow-Artefakt. **Kein eigenes Backup-Repo** – ein Dump enthält personenbezogene Daten, und was
  einmal in einer Git-Historie liegt, bekommt man dort nicht mehr heraus; Artefakte laufen nach der
  Aufbewahrungsfrist von selbst ab.
- **Löschprotokoll:** Trigger schreiben jede Löschung von Inhalten in eine Tabelle im nicht
  ausgelieferten Schema `private` – wer, wann, was, mit der gelöschten Zeile. Keine Oberfläche:
  einsehbar für den Projekt-Owner im Supabase-Dashboard (bzw. per SQL über den Connector). Auch
  Löschungen über den MCP-Server werden der richtigen Person zugeordnet.
- Kein eigenes Konto fürs Politikbüro.

### Datenmodell
- **Ein Notiz-System**: Notizen gibt es nur noch an **ToDos** und **Dokumenten**.
- **Kommentare entfallen**; bestehende ToDo-Kommentare werden zu Notizen.
- **Sitzungen und Termine haben keine eigenen Notizen mehr.** Was zu einer Sitzung gehört, steht in
  den verknüpften ToDos und Dokumenten und ist in der Sitzung darüber sichtbar. Bestehende
  Sitzungs-/Termin-Notizen werden exportiert und gelöscht (fremde vorher vorgelegt).
- **ToDo-Zuweisung an Personen** statt Freitext: die zugewiesene Person sieht die Karte auf ihrem
  Board und darf sie bearbeiten. Zuweisbar sind Kolleg*innen gleicher Partei und Ebene.
- Ungenutzte Tabellen: `documents` und das Antragswesen (`antraege`, `antrag_shares`,
  `antrag_deadline_settings`) sind seit 0061 entfernt; `fakten` bleibt.
- **Nachtrag 18.10.:** Konten löschen nimmt ihre Dokumente mit; technische Konten (ALLRIS-Import) sind nicht löschbar (0061).
- **Nachtrag:** feste ToDo-Spalten (Neu, Geplant, Ergebnis erstellt, Fertig), aktive Sitzung manuell, keine Zusammenfassungen (0060).
- **Zurückgestellt:** Kalenderquellen auf Fraktions-/Ebenen-Ebene, Rolle Fraktionsbüro.

### Code und Leistung
- Volltextsuche in Postgres statt im Browser (heute ~10 MB Volltext pro Aufruf des Dokumente-Reiters).
- Datenzugriff aus den Komponenten in Lade-Funktionen je Bereich bündeln.
- Typen aus der Datenbank erzeugen statt `types.ts` von Hand.
- Tests für die reinen Hilfsfunktionen.

## Arbeitsliste

- [x] Plan ablegen, PR-Prüfung
- [x] Uploads sperren, Bucket-Grenzen (0052) – Dateien umziehen/aufräumen per Wartungs-Workflow
- [x] Speicheranzeige für Admins (0054)
- [x] Löschprotokoll (0053)
- [x] Backup (Secrets `SUPABASE_DB_PASSWORD`, `BACKUP_PASSWORT` nötig)
- [x] Notizen konsolidieren, Kommentare und Sitzungs-Notizen entfernen (0055; Altdaten per `wartung-notizen`, DROP der Kommentar-Tabellen offen)
- [x] ToDo-Zuweisung (0056)
- [x] Neuigkeiten im Cockpit (0057)
- [x] Code und Leistung: Suche in der Datenbank (0058), Tests, Typen-Abgleich – Datenzugriff nur für neue Bereiche gebündelt (siehe CHANGELOG)
