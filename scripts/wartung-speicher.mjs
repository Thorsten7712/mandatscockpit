// Einmalig zu 0060: den Speicherbereich "zusammenfassungen" entfernen.
// Zusammenfassungen gibt es nicht mehr (Entscheidung 17.10.2026), Notizen sind
// reiner Text. Übrig war nur noch eine Datei ohne Verweis (Benjamin Korte,
// laut Nutzer zu löschen).
//
// Über die Storage-API, weil Supabase direkte Löschungen in storage.* per
// Trigger verbietet. Läuft über .github/workflows/wartung.yml
// (skript=speicher). Schreibt nur Zahlen ins Protokoll (öffentliches Repo).

import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
const aendern = process.env.MODUS === 'ausfuehren'
const BUCKET = 'zusammenfassungen'
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY fehlen.')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { headers: { 'x-mc-quelle': 'wartung-speicher' } },
})
console.log(`Modus: ${aendern ? 'ausfuehren' : 'probe (es wird nichts geändert)'}`)

const { data: buckets, error: bucketFehler } = await supabase.storage.listBuckets()
if (bucketFehler) throw new Error(bucketFehler.message)
if (!buckets.some((b) => b.id === BUCKET)) {
  console.log(`Bucket "${BUCKET}" gibt es nicht mehr - nichts zu tun.`)
  process.exit(0)
}

// Ordner sind die Konto-Ids; Dateien liegen eine Ebene darunter.
const pfade = []
const { data: ordner, error: listFehler } = await supabase.storage.from(BUCKET).list('', { limit: 1000 })
if (listFehler) throw new Error(listFehler.message)
for (const o of ordner) {
  if (o.id) {
    pfade.push(o.name)
    continue
  }
  const { data: dateien, error } = await supabase.storage.from(BUCKET).list(o.name, { limit: 1000 })
  if (error) throw new Error(error.message)
  for (const d of dateien) if (d.id) pfade.push(`${o.name}/${d.name}`)
}
console.log(`Dateien in "${BUCKET}": ${pfade.length}`)
if (pfade.length > 1) {
  // Erwartet ist genau eine. Mehr hieße: seit der Prüfung ist etwas dazugekommen.
  throw new Error('Mehr Dateien als erwartet - abgebrochen, bitte erst prüfen.')
}

if (aendern) {
  if (pfade.length > 0) {
    const { error } = await supabase.storage.from(BUCKET).remove(pfade)
    if (error) throw new Error(error.message)
  }
  const { error } = await supabase.storage.deleteBucket(BUCKET)
  if (error) throw new Error(error.message)
  console.log(`Gelöscht: ${pfade.length} Datei(en) und der Bucket.`)
}
