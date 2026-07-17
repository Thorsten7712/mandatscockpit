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

// node-ical liefert ICS-Properties mit Parametern (z. B. "SUMMARY;LANGUAGE=de:...",
// wie im echten ALLRIS-Feed von Iserlohn) als { params, val } statt als String.
// Diese Funktion normalisiert beide Formen zu einem String.
function toText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'val' in value) return String(value.val)
  return String(value)
}

// An einem echten Auszug des ALLRIS-Feeds (Stadtrat Iserlohn) verifiziert
// (siehe docs/KONZEPT.md Abschnitt 11): SUMMARY enthält dort bereits direkt
// den Gremiumsnamen ohne Zusatz (z. B. "Finanzausschuss", "Rat der Stadt
// Iserlohn"). Für andere Feed-Formate mit "Gremium – Sitzung"-Schema bleibt
// der Bindestrich-Fallback erhalten.
function extractGremium(summary) {
  const dashMatch = summary.match(/^(.+?)\s*[-–—]\s*.*sitzung/i)
  if (dashMatch) return dashMatch[1].trim()
  return summary.trim() || null
}

async function importSource(source) {
  console.log(`Importiere "${source.name}" (${source.ics_url})`)

  try {
    // Bestehende Sessions dieser Quelle VOR dem Import laden, um nachher zu
    // erkennen, welche UIDs aus dem Feed verschwunden sind (= vermutlich
    // abgesagt - der ALLRIS-Feed markiert Absagen nicht über STATUS:CANCELLED,
    // sondern entfernt den Termin einfach aus dem Feed).
    const { data: existing } = await supabase
      .from('sessions')
      .select('ics_uid, status')
      .eq('source_id', source.id)
      .not('ics_uid', 'is', null)
    const existingByUid = new Map((existing ?? []).map((row) => [row.ics_uid, row.status]))

    const parsed = await ical.async.fromURL(source.ics_url)
    const entries = Object.values(parsed).filter((entry) => entry.type === 'VEVENT' && entry.uid && entry.start)

    const rows = entries.map((entry) => {
      const summary = toText(entry.summary)
      return {
        source_id: source.id,
        ics_uid: entry.uid,
        titel: summary || 'Ohne Titel',
        gremium: summary ? extractGremium(summary) : null,
        ebene: source.ebene,
        datum: new Date(entry.start).toISOString(),
        ort: toText(entry.location) || null,
        quelle_url: toText(entry.url) || source.ics_url,
      }
    })

    if (rows.length === 0) {
      console.log('  Keine VEVENTs im Feed gefunden.')
      return { source: source.name, imported: 0 }
    }

    // status wird bewusst NICHT mitgeschickt: beim Insert greift der
    // Tabellen-Default ('geplant'), beim Update bleibt ein manuell vom
    // Ratsbüro gesetzter Status (z. B. 'aktiv') unangetastet. Cancel-/
    // Uncancel-Logik läuft danach separat (siehe unten).
    const { error } = await supabase.from('sessions').upsert(rows, { onConflict: 'source_id,ics_uid' })

    if (error) {
      console.error(`  Fehler beim Schreiben: ${error.message}`)
      return { source: source.name, imported: 0, error: error.message }
    }

    // Absagen erkennen: STATUS:CANCELLED im Feed (falls der Feed das nutzt)
    // ODER eine zuvor bekannte UID, die jetzt komplett aus dem Feed
    // verschwunden ist (der Fall beim ALLRIS-Feed).
    const seenUids = new Set(rows.map((r) => r.ics_uid))
    const cancelledInFeed = new Set(
      entries.filter((e) => e.status === 'CANCELLED').map((e) => e.uid),
    )
    const missingFromFeed = new Set([...existingByUid.keys()].filter((uid) => !seenUids.has(uid)))
    const toCancel = [...new Set([...cancelledInFeed, ...missingFromFeed])]

    // Uncancel: eine zuvor abgesagte UID taucht wieder normal (nicht
    // CANCELLED) im Feed auf.
    const toUncancel = [...existingByUid.entries()]
      .filter(([uid, status]) => status === 'abgesagt' && seenUids.has(uid) && !cancelledInFeed.has(uid))
      .map(([uid]) => uid)

    if (toCancel.length > 0) {
      await supabase.from('sessions').update({ status: 'abgesagt' }).eq('source_id', source.id).in('ics_uid', toCancel)
    }
    if (toUncancel.length > 0) {
      await supabase.from('sessions').update({ status: 'geplant' }).eq('source_id', source.id).in('ics_uid', toUncancel)
    }

    console.log(
      `  ${rows.length} Termine importiert/aktualisiert.` +
        (toCancel.length > 0 ? ` ${toCancel.length} als abgesagt markiert.` : '') +
        (toUncancel.length > 0 ? ` ${toUncancel.length} wieder aktiviert.` : ''),
    )
    return { source: source.name, imported: rows.length }
  } catch (err) {
    console.error(`  Fehler beim Verarbeiten der Quelle: ${err.message}`)
    return { source: source.name, imported: 0, error: err.message }
  }
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
