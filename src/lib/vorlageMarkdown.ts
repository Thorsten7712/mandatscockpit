// Die Aufbereitung der ALLRIS-Vorlagen liegt bei den Edge Functions, weil der
// MCP-Server dieselbe vorschau() beim Schreiben braucht (0058, Spalte
// dokumente.vorschau). Vite liest die Datei von dort mit; sie hat keine
// Importe und läuft in Browser und Deno gleich.
export * from '../../supabase/functions/_shared/vorlageMarkdown'
