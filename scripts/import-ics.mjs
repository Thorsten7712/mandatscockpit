// ICS-Import-Job: liest alle konfigurierten Kalenderquellen (calendar_sources),
// lädt deren ICS-Feed und schreibt die Sitzungstermine per Upsert in die
// sessions-Tabelle. Läuft periodisch über .github/workflows/import-ics.yml.
//
// Braucht den Supabase Service-Role-Key (nicht den anon key!), weil es keine
// insert/update-Policy für authenticated Nutzer auf sessions gibt (siehe
// supabase/migrations/0001_init.sql, Kommentar "Schreiben später nur via
// Service Role / Import-Job").

import ical from 'node-ical'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen als Umgebungsvariablen gesetzt sein.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

// Heuristik, um das Gremium aus dem SUMMARY-Feld herauszulesen, z. B.
// "Bauausschuss - Sitzung" -> "Bauausschuss". Das Feed-Format ist laut
// docs/KONZEPT.md Abschnitt 11 noch nicht an einem echten Auszug verifiziert –
// liefert die Heuristik nichts Plausibles, bleibt gremium einfach null.
function extractGremium(summary) {
  const match = summary.match(/^(.+?)\s*[-–—]\s*.*sitzung/i)
  return match ? match[1].trim() : null
}

async function importSource(source) {
  console.log(`Importiere "${source.name}" (${source.ics_url})`)

  let parsed
  try {
    parsed = await ical.async.fromURL(source.ics_url)
  } catch (err) {
    console.error(`  Fehler beim Laden des Feeds: ${err.message}`)
    return { source: source.name, imported: 0, error: err.message }
  }

  const rows = Object.values(parsed)
    .filter((entry) => entry.type === 'VEVENT' && entry.uid && entry.start)
    .map((entry) => ({
      source_id: source.id,
      ics_uid: entry.uid,
      titel: entry.summary ?? 'Ohne Titel',
      gremium: entry.summary ? extractGremium(entry.summary) : null,
      ebene: source.ebene,
      datum: new Date(entry.start).toISOString(),
      ort: entry.location ?? null,
      quelle_url: entry.url ?? source.ics_url,
    }))

  if (rows.length === 0) {
    console.log('  Keine VEVENTs im Feed gefunden.')
    return { source: source.name, imported: 0 }
  }

  // status wird bewusst NICHT mitgeschickt: beim Insert greift der
  // Tabellen-Default ('geplant'), beim Update bleibt ein manuell vom
  // Ratsbüro gesetzter Status (z. B. 'aktiv') unangetastet.
  const { error } = await supabase.from('sessions').upsert(rows, { onConflict: 'source_id,ics_uid' })

  if (error) {
    console.error(`  Fehler beim Schreiben: ${error.message}`)
    return { source: source.name, imported: 0, error: error.message }
  }

  console.log(`  ${rows.length} Termine importiert/aktualisiert.`)
  return { source: source.name, imported: rows.length }
}

async function main() {
  const { data: sources, error } = await supabase.from('calendar_sources').select('*')
  if (error) {
    console.error('Konnte calendar_sources nicht laden:', error.message)
    process.exit(1)
  }
  if (!sources || sources.length === 0) {
    console.log('Keine Kalenderquellen konfiguriert – nichts zu importieren.')
    return
  }

  const results = await Promise.all(sources.map(importSource))
  const failed = results.filter((r) => r.error)
  const totalImported = results.reduce((sum, r) => sum + r.imported, 0)

  console.log(`\nGesamt: ${totalImported} Termine über ${results.length} Quelle(n).`)

  if (failed.length > 0) {
    console.error(`${failed.length} von ${results.length} Quelle(n) fehlgeschlagen.`)
    process.exit(1)
  }
}

main()
