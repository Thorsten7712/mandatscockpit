// Einmalige Datei-Wartung nach der Upload-Sperre (0052_uploads_sperren.sql,
// Entscheidungen vom 17.10.2026 in docs/ARCHITEKTUR-PLAN.md). Läuft über
// .github/workflows/wartung-dateien.yml mit dem Service-Role-Schlüssel, weil
// Dateien sich nur über die Storage-API verschieben lassen.
//
//   1. Drucksachen-Dateien, die im Ordner eines anderen Kontos liegen als dem
//      Besitzer des Dokuments (237 Stück im Ordner von Thorsten Kois, Altlast
//      aus der Zeit vor dem Umzug des Hub-Bestands auf das ALLRIS-Konto),
//      in den Ordner des Besitzers verschieben und datei_url nachziehen.
//   2. Markdown-Anhänge an ToDo-Notizen von Thorsten Kois: Text in die Notiz
//      übernehmen, statt ihn mit der Datei zu verlieren.
//   3. Seine Datei-Notizen an Sitzungen und Terminen löschen, an ToDo-Notizen
//      nur die Datei lösen (der Notiztext bleibt).
//   4. Alle Dateien in seinem Ordner im Bucket "zusammenfassungen" löschen -
//      vorher in EXPORT_DIR kopieren (der Workflow hebt das als Artefakt auf).
//
// Dateien anderer Personen werden nicht angefasst (Benjamin Korte: vorlegen).
//
// MODUS=probe (Standard) zeigt nur, was passieren würde. MODUS=ausfuehren
// ändert. Mehrfaches Ausführen ist unschädlich: jeder Schritt sucht nur noch,
// was noch zu tun ist.

import { createClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
const MODUS = process.env.MODUS === 'ausfuehren' ? 'ausfuehren' : 'probe'
const EXPORT_DIR = process.env.EXPORT_DIR || 'export'
const NUTZER = 'Thorsten Kois'

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY fehlen.')
  process.exit(1)
}
// x-mc-quelle: so steht im Löschprotokoll (0053) "service_role: wartung-dateien"
// statt einer anonymen Service-Role-Löschung.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { headers: { 'x-mc-quelle': 'wartung-dateien' } },
})
const aendern = MODUS === 'ausfuehren'
console.log(`Modus: ${MODUS}${aendern ? '' : ' (es wird nichts geändert)'}\n`)

function ordner(pfad) {
  return pfad.split('/')[0]
}
function dateiname(pfad) {
  return pfad.split('/').slice(1).join('/')
}
async function pruefe(ergebnis, was) {
  const { data, error } = await ergebnis
  if (error) throw new Error(`${was}: ${error.message}`)
  return data
}

// Seitenweise lesen: PostgREST schneidet bei 1.000 Zeilen ab (siehe CLAUDE.md).
async function alle(abfrage) {
  const zeilen = []
  for (let von = 0; ; von += 1000) {
    const seite = await pruefe(abfrage().range(von, von + 999), 'Lesen')
    zeilen.push(...seite)
    if (seite.length < 1000) return zeilen
  }
}

const profile = await pruefe(supabase.from('profiles').select('id, name, technisch'), 'Profile lesen')
const kois = profile.find((p) => p.name === NUTZER)
if (!kois) throw new Error(`Profil "${NUTZER}" nicht gefunden.`)
const istTechnisch = new Map(profile.map((p) => [p.id, p.technisch]))

// --- 1. Drucksachen-Dateien in den Ordner ihres Besitzers --------------------
const dokumente = await alle(() =>
  supabase.from('dokumente').select('id, user_id, titel, datei_url').not('datei_url', 'is', null).order('id'),
)
const falscherOrdner = dokumente.filter((d) => ordner(d.datei_url) !== d.user_id)
const umziehen = falscherOrdner.filter((d) => istTechnisch.get(d.user_id))
const nichtTechnisch = falscherOrdner.filter((d) => !istTechnisch.get(d.user_id))
console.log(`1. Umzug: ${umziehen.length} Drucksachen-Dateien in den Ordner ihres (technischen) Besitzers.`)
if (nichtTechnisch.length > 0) {
  console.log(`   Nicht angefasst, Besitzer kein technisches Konto: ${nichtTechnisch.map((d) => d.titel).join(' | ')}`)
}
let umgezogen = 0
for (const d of umziehen) {
  const ziel = `${d.user_id}/${dateiname(d.datei_url)}`
  if (!aendern) continue
  await pruefe(supabase.storage.from('dokumente').move(d.datei_url, ziel), `Verschieben ${d.datei_url}`)
  await pruefe(supabase.from('dokumente').update({ datei_url: ziel }).eq('id', d.id), `datei_url ${d.id}`)
  umgezogen++
}
if (aendern) console.log(`   erledigt: ${umgezogen}`)

// --- 2./3. Datei-Notizen von Thorsten Kois -------------------------------------
const notizen = await pruefe(
  supabase
    .from('summaries')
    .select('id, inhalt, datei_url, session_id, event_id, todo_id, antrag_id')
    .eq('user_id', kois.id)
    .not('datei_url', 'is', null),
  'Notizen lesen',
)
const anSitzungOderTermin = notizen.filter((n) => n.session_id || n.event_id)
const anToDo = notizen.filter((n) => n.todo_id)
const markdown = anToDo.filter((n) => n.datei_url.toLowerCase().endsWith('.md'))

console.log(`\n2. Markdown in den Notiztext übernehmen: ${markdown.length}`)
for (const n of markdown) {
  console.log(`   - ${dateiname(n.datei_url)}`)
  if (!aendern) continue
  const blob = await pruefe(supabase.storage.from('zusammenfassungen').download(n.datei_url), `Laden ${n.datei_url}`)
  const text = (await blob.text()).trim()
  const inhalt = [n.inhalt?.trim(), `---\n\n${text}`].filter(Boolean).join('\n\n')
  await pruefe(supabase.from('summaries').update({ inhalt, datei_url: null }).eq('id', n.id), `Notiz ${n.id}`)
}

console.log(`\n3. Datei-Notizen an Sitzungen/Terminen löschen: ${anSitzungOderTermin.length}`)
for (const n of anSitzungOderTermin) {
  console.log(`   - ${dateiname(n.datei_url)}${n.inhalt ? ' (mit Text!)' : ''}`)
}
const andereToDo = anToDo.filter((n) => !markdown.includes(n))
console.log(`   Datei von ToDo-Notizen lösen, Text bleibt: ${andereToDo.length}`)
for (const n of andereToDo) console.log(`   - ${dateiname(n.datei_url)}`)
if (aendern) {
  for (const n of anSitzungOderTermin) {
    await pruefe(supabase.from('summaries').delete().eq('id', n.id), `Löschen Notiz ${n.id}`)
  }
  for (const n of andereToDo) {
    await pruefe(supabase.from('summaries').update({ datei_url: null }).eq('id', n.id), `Notiz ${n.id}`)
  }
}

// --- 4. Seine Dateien im Bucket "zusammenfassungen" sichern und löschen ------
const objekte = await pruefe(
  supabase.storage.from('zusammenfassungen').list(kois.id, { limit: 1000 }),
  'Ordner auflisten',
)
const pfade = objekte.filter((o) => o.id).map((o) => `${kois.id}/${o.name}`)
// Noch referenzierte Dateien nicht löschen - das wäre nach Schritt 2/3 ein
// Fehler im Plan, kein Aufräumen.
const nochReferenziert = new Set(
  (
    await pruefe(supabase.from('summaries').select('datei_url').in('datei_url', pfade.length ? pfade : ['-']), 'Verweise')
  ).map((r) => r.datei_url),
)
console.log(`\n4. Dateien im eigenen Ordner von "zusammenfassungen": ${pfade.length}`)
const loeschen = []
for (const p of pfade) {
  const referenziert = nochReferenziert.has(p)
  console.log(`   - ${dateiname(p)}${referenziert ? ' (noch referenziert, bleibt)' : ''}`)
  if (!referenziert) loeschen.push(p)
}
if (aendern && loeschen.length > 0) {
  await mkdir(EXPORT_DIR, { recursive: true })
  for (const p of loeschen) {
    const blob = await pruefe(supabase.storage.from('zusammenfassungen').download(p), `Sichern ${p}`)
    await writeFile(path.join(EXPORT_DIR, dateiname(p)), Buffer.from(await blob.arrayBuffer()))
  }
  await pruefe(supabase.storage.from('zusammenfassungen').remove(loeschen), 'Dateien löschen')
  console.log(`   gesichert und gelöscht: ${loeschen.length}`)
}

console.log(`\nFertig (${MODUS}).`)
