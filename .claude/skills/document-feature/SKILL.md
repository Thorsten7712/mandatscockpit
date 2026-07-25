---
name: document-feature
description: Pattern for adding notes/file-upload capability to a new entity in MandatsCockpit (mirrors sessions, events, todos, antraege). Use whenever a task needs to attach notes or documents to something new.
---

# Notizen/Datei-Upload an einer neuen Entität (MandatsCockpit)

Kontext: `summaries` ist die zentrale Tabelle für Notizen + Datei-Uploads, aktuell über `session_id`,
`event_id`, `todo_id`, `antrag_id` an vier Entitäten hängbar. Für eine fünfte Entität dasselbe Muster
wiederverwenden statt etwas Neues zu bauen.

## Ablauf

1. **Migration**: neue nullable `<entity>_id`-Spalte auf `summaries` (Foreign Key, `on delete
   cascade` nur falls „hart löschen soll Notizen mitreißen" gewünscht ist – bei Terminen ist genau
   deshalb „Abgesagt" statt Löschen der Normalfall, siehe `docs/CHANGELOG.md`). RLS-Policy
   `summaries_manage_own` deckt neue Spalten i. d. R. ohne Änderung ab, wenn sie weiterhin an
   `user_id = auth.uid()` hängt.
2. **Pflichtfeld-Logik**: mindestens eins von `inhalt` (Freitext) oder `datei_url` (Storage-Pfad) muss
   gesetzt sein – gleiche Kombinierbarkeit wie beim bestehenden „Notizen & Dokumente"-Formular
   (`TerminDetailPanel.tsx`). Rein clientseitig durchsetzen, kein DB-Constraint (Projektkonvention:
   Business-Regeln clientseitig, kein adversarielles Nutzerumfeld).
3. **Storage**: privater Bucket `zusammenfassungen`, Pfad `<user_id>/<dateiname>` (bei möglichen
   Namenskollisionen `<user_id>/<Date.now()>-<dateiname>`). RLS auf `storage.objects` scoped über
   `(storage.foldername(name))[1] = auth.uid()::text` – bereits vorhanden, keine neue Policy nötig,
   solange der Upload-Pfad dem Muster folgt.
4. **Anzeige/Vorschau**: `src/components/DocumentPreviewModal.tsx` wiederverwenden (Bilder inline,
   PDFs per iframe, sonst „Datei öffnen"-Link) statt einer neuen Download-Lösung. `fileNameFromPath`
   von dort importieren statt neu zu implementieren.
5. **Signed URLs**: 60s TTL für einmalige Downloads, 3600s TTL für dauerhaft sichtbare Inhalte
   (offene Vorschau, Profilfoto-artige Dauerdarstellung).
6. **Falls auch über `mcp-server` erreichbar sein soll**: die gemeinsame `createNote()`-Hilfsfunktion
   (`NoteTargetConfig` mit `idArgName`/`table`/`idColumn`/`ownerScoped`/`label`) in
   `supabase/functions/mcp-server/index.ts` erweitern statt ein viertes, fast identisches Tool zu
   schreiben. `ownerScoped: true` setzen, außer die Zieltabelle ist wie `sessions` für alle
   eingeloggten Nutzer lesbar (sonst könnte über eine erratene UUID an fremde Datensätze angehängt
   werden).
7. **Verifizieren**: `tsc -b`/`vite build`, plus falls `mcp-server` betroffen ist `deno check`.
