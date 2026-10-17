// Einmalig nach 0058_dokumente_suche_vorschau.sql: die Vorschau für alle
// vorhandenen Dokumente berechnen. Neue Dokumente bekommen sie beim Schreiben
// (Web-Oberfläche und MCP-Server, beide über vorschau() aus
// supabase/functions/_shared/vorlageMarkdown.ts - dieselbe Datei wie hier).
//
// Läuft über .github/workflows/wartung-dateien.yml (skript=vorschau). Ändert
// nur die Spalte vorschau, schreibt keine Inhalte ins Protokoll (das Repo ist
// öffentlich). MODUS=probe zählt nur. Mehrfaches Ausführen ist unschädlich.

import { createClient } from '@supabase/supabase-js'
import { vorschau } from '../supabase/functions/_shared/vorlageMarkdown.ts'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
const aendern = process.env.MODUS === 'ausfuehren'
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY fehlen.')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { headers: { 'x-mc-quelle': 'wartung-vorschau' } },
})
console.log(`Modus: ${aendern ? 'ausfuehren' : 'probe (es wird nichts geändert)'}`)

const zeilen = []
for (let von = 0; ; von += 500) {
  const { data, error } = await supabase
    .from('dokumente')
    .select('id, inhalt, vorschau')
    .is('parent_id', null)
    .order('id')
    .range(von, von + 499)
  if (error) throw new Error(error.message)
  zeilen.push(...data)
  if (data.length < 500) break
}

const zuAendern = zeilen.filter((z) => (vorschau(z.inhalt) ?? null) !== (z.vorschau ?? null))
console.log(`${zeilen.length} Dokumente, ${zuAendern.length} brauchen eine neue Vorschau.`)

let fertig = 0
if (aendern) {
  for (const z of zuAendern) {
    const { error } = await supabase.from('dokumente').update({ vorschau: vorschau(z.inhalt) }).eq('id', z.id)
    if (error) throw new Error(`Dokument ${z.id}: ${error.message}`)
    fertig++
  }
  console.log(`Aktualisiert: ${fertig}`)
}
