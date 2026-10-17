// Einmalige Notiz-Wartung zu 0055_notizen_nur_todo.sql (Entscheidungen vom
// 17.10.2026 in docs/ARCHITEKTUR-PLAN.md). Läuft über
// .github/workflows/wartung-dateien.yml (skript=notizen) mit dem
// Service-Role-Schlüssel - Löschungen über den Supabase-Connector hängen, und
// so stehen sie mit "service_role: wartung-notizen" im Löschprotokoll (0053).
//
//   1. ToDo-Kommentare werden zu Notizen an derselben Karte (Autor und
//      Zeitpunkt bleiben), danach wird der Kommentar gelöscht.
//   2. Notizen an Sitzungen und Terminen werden als Markdown nach EXPORT_DIR
//      gesichert (der Workflow hebt das als Artefakt auf) und gelöscht -
//      nur die von Thorsten Kois. Notizen anderer Personen nur, wenn ihr Name
//      in AUCH_VON steht (kommagetrennt), nachdem sie vorgelegt wurden.
//
// Das Repository ist öffentlich, das Protokoll des Laufs also auch: hier
// stehen nur Autor, Bezug und Länge, nie der Text.
//
// MODUS=probe (Standard) zeigt nur, was passieren würde. MODUS=ausfuehren
// ändert. Mehrfaches Ausführen ist unschädlich.

import { createClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
const MODUS = process.env.MODUS === 'ausfuehren' ? 'ausfuehren' : 'probe'
const EXPORT_DIR = process.env.EXPORT_DIR || 'export'
const LOESCHEN_VON = new Set(['Thorsten Kois', ...(process.env.AUCH_VON ?? '').split(',').map((n) => n.trim()).filter(Boolean)])

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY fehlen.')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { headers: { 'x-mc-quelle': 'wartung-notizen' } },
})
const aendern = MODUS === 'ausfuehren'
console.log(`Modus: ${MODUS}${aendern ? '' : ' (es wird nichts geändert)'}`)
console.log(`Sitzungs-/Termin-Notizen werden gelöscht von: ${[...LOESCHEN_VON].join(', ')}\n`)

async function pruefe(ergebnis, was) {
  const { data, error } = await ergebnis
  if (error) throw new Error(`${was}: ${error.message}`)
  return data
}

const profile = await pruefe(supabase.from('profiles').select('id, name'), 'Profile lesen')
const nameVon = new Map(profile.map((p) => [p.id, p.name]))

// --- 1. ToDo-Kommentare -> Notizen ---------------------------------------------
const kommentare = await pruefe(
  supabase.from('todo_comments').select('id, todo_id, user_id, inhalt, erstellt_am').order('erstellt_am'),
  'Kommentare lesen',
)
console.log(`1. ToDo-Kommentare in Notizen umwandeln: ${kommentare.length}`)
for (const k of kommentare) {
  console.log(`   - ${nameVon.get(k.user_id) ?? k.user_id}, ${k.erstellt_am.slice(0, 10)}, ${k.inhalt.length} Zeichen`)
  if (!aendern) continue
  await pruefe(
    supabase.from('summaries').insert({ todo_id: k.todo_id, user_id: k.user_id, inhalt: k.inhalt, erstellt_am: k.erstellt_am }),
    `Notiz aus Kommentar ${k.id}`,
  )
  await pruefe(supabase.from('todo_comments').delete().eq('id', k.id), `Kommentar ${k.id} löschen`)
}
const antragKommentare = await pruefe(supabase.from('antrag_comments').select('id'), 'Antrags-Kommentare lesen')
console.log(`   Antrags-Kommentare: ${antragKommentare.length} (nichts zu tun, wenn 0)`)

// --- 2. Notizen an Sitzungen und Terminen --------------------------------------
const notizen = await pruefe(
  supabase
    .from('summaries')
    .select('id, user_id, session_id, event_id, inhalt, datei_url, erstellt_am')
    .or('session_id.not.is.null,event_id.not.is.null')
    .order('erstellt_am'),
  'Sitzungs-/Termin-Notizen lesen',
)
const sitzungen = new Map(
  (await pruefe(supabase.from('sessions').select('id, gremium, datum').in('id', notizen.map((n) => n.session_id).filter(Boolean)), 'Sitzungen')).map(
    (s) => [s.id, `${s.gremium} ${s.datum.slice(0, 10)}`],
  ),
)
const termine = new Map(
  (await pruefe(supabase.from('events').select('id, titel, start').in('id', notizen.map((n) => n.event_id).filter(Boolean)), 'Termine')).map(
    (e) => [e.id, `${e.titel} ${e.start.slice(0, 10)}`],
  ),
)

console.log(`\n2. Notizen an Sitzungen/Terminen: ${notizen.length}`)
const loeschen = []
for (const n of notizen) {
  const autor = nameVon.get(n.user_id) ?? n.user_id
  const bezug = n.session_id ? `Sitzung ${sitzungen.get(n.session_id) ?? n.session_id}` : `Termin ${termine.get(n.event_id) ?? n.event_id}`
  const weg = LOESCHEN_VON.has(autor)
  console.log(`   - ${weg ? 'löschen' : 'BLEIBT (vorlegen)'} · ${autor} · ${bezug} · ${(n.inhalt ?? '').length} Zeichen${n.datei_url ? ' + Datei!' : ''}`)
  if (weg) loeschen.push({ ...n, autor, bezug })
}

if (aendern && loeschen.length > 0) {
  await mkdir(EXPORT_DIR, { recursive: true })
  for (const n of loeschen) {
    const name = `${n.erstellt_am.slice(0, 10)}_${n.bezug.replace(/[^\p{L}\p{N}.-]+/gu, '-')}_${n.id.slice(0, 8)}.md`
    const kopf = `# ${n.bezug}\n\nNotiz von ${n.autor}, erstellt ${n.erstellt_am}\n\n---\n\n`
    await writeFile(path.join(EXPORT_DIR, name), kopf + (n.inhalt ?? ''))
  }
  for (const n of loeschen) {
    await pruefe(supabase.from('summaries').delete().eq('id', n.id), `Notiz ${n.id} löschen`)
  }
  console.log(`   gesichert und gelöscht: ${loeschen.length}`)
}

console.log(`\nFertig (${MODUS}).`)
