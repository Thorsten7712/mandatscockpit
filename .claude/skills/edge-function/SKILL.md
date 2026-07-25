---
name: edge-function
description: Checklist for creating or editing a Supabase Edge Function (Deno) in MandatsCockpit, including auth, CORS, and deploy gotchas. Use whenever a task touches supabase/functions/.
---

# Supabase Edge Function in MandatsCockpit anlegen/ändern

Kontext: Drei Edge Functions existieren bereits (`import-ics-source`, `admin-users`, `mcp-server`) –
bei ähnlichem Bedarf zuerst dort nach wiederverwendbaren Mustern schauen (z. B. `createNote()` in
`mcp-server/index.ts` für Notiz-/Datei-Upload-Tools).

## Ablauf

1. **Ort**: `supabase/functions/<name>/index.ts`. Eigenes `deno.json` im Funktionsordner anlegen
   (kopieren von einer bestehenden Function) – ohne das bringt die Node-`package.json` im Repo-Root
   Denos Modulauflösung durcheinander (`nodeModulesDir: "none"` im `deno.json` ist der Fix).
2. **Secrets**: `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` werden automatisch injiziert, kein
   manuelles Secret nötig für den Standard-Service-Role-Client.
3. **Auth-Modus entscheiden**:
   - Normalfall: Function wird mit dem echten Nutzer-JWT aus dem Frontend aufgerufen → Default
     `verify_jwt = true` beibehalten (Supabase-Gateway prüft den JWT, bevor die Function läuft).
   - Eigenes Auth-Schema (z. B. persönliches Bearer-Token wie bei `mcp-server`) → in
     `supabase/config.toml` einen Block `[functions.<name>] verify_jwt = false` NUR für diese eine
     Function ergänzen, sonst weist das Gateway jedes eigene Token vorher ab
     (`UNAUTHORIZED_INVALID_JWT_FORMAT`).
4. **CORS, falls aus dem Browser aufgerufen** (nicht nur server-zu-server/curl): Preflight-Antwort
   (OPTIONS) braucht `Access-Control-Allow-Methods` (+ ggf. `Access-Control-Allow-Headers`,
   `Access-Control-Max-Age`). Fehlt das, blockiert der Browser den eigentlichen Request lautlos –
   **`curl` prüft das nicht**, ein erfolgreicher curl-Test beweist also nichts für den Browser-Fall.
   Bei Unsicherheit mit expliziten Preflight-Headern testen (`Origin`,
   `Access-Control-Request-Method`, `Access-Control-Request-Headers`) oder direkt im Browser
   verifizieren.
5. **HTTP-Statuscodes bei speziellen Clients**: Wenn der aufrufende Client auf bestimmte
   HTTP-Statuscodes speziell reagiert (Beispiel: ein MCP-Client startet bei jedem 401 einen
   OAuth-Registrierungsversuch, unabhängig vom späteren Erfolg), grundsätzlich HTTP 200 zurückgeben
   und den eigentlichen Fehler im JSON-Body kodieren (z. B. JSON-RPC-`error`-Objekt). Non-200 nur für
   echte Transport-Fehler reservieren (falsche HTTP-Methode, kaputtes JSON).
6. **Lokal typprüfen**: `deno check --config supabase/functions/<name>/deno.json
   supabase/functions/<name>/index.ts` (Deno muss separat installiert sein, ist nicht Teil von
   `npm install`).
7. **Deployen**: passiert automatisch über `.github/workflows/deploy-edge-functions.yml` bei jeder
   Änderung unter `supabase/functions/**` – deployt **alle** Functions
   (`supabase functions deploy` ohne Namen), keine zweite Workflow-Datei für eine neue Function
   anlegen. Braucht `SUPABASE_ACCESS_TOKEN` (Personal Access Token) + `SUPABASE_PROJECT_REF` als
   Repo-Secrets (bereits konfiguriert). Erst nach `git push` aktiv, `supabase db push` betrifft nur die
   DB.
8. **Verifizieren**: `deno check` lokal, danach ein echter curl-Test gegen die deployte Function
   (inkl. Preflight-Test bei Browser-Nutzung, siehe Punkt 4).
