// Supabase Edge Function: importiert den ICS-Feed EINER einzelnen
// calendar_sources-Zeile neu und upsertet die Sitzungen in sessions.
// Wird vom "Aktualisieren"-Button neben jeder Kalenderquelle in
// src/pages/Settings.tsx aufgerufen (supabase.functions.invoke).
//
// Läuft mit SUPABASE_SERVICE_ROLE_KEY, weil sessions keine Insert/Update-
// Policy für normale Nutzer hat (siehe supabase/migrations/0001_init.sql).
// Der Key bleibt serverseitig - Edge Functions bekommen ihn automatisch
// als Umgebungsvariable, ohne dass er im Browser landet.
//
// Teilt sich die Parsing-Logik konzeptionell mit scripts/import-ics.mjs
// (Node-Skript für den periodischen Gesamt-Import); eine echte Code-
// Wiederverwendung zwischen Deno Edge Function und Node-Skript ist ohne
// gemeinsames Build-Tooling nicht sinnvoll möglich, daher bewusst dupliziert.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import ical from 'npm:node-ical@0.20.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// node-ical liefert ICS-Properties mit Parametern (z. B. "SUMMARY;LANGUAGE=de:...",
// wie im echten ALLRIS-Feed von Iserlohn) als { params, val } statt als String.
function toText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'val' in (value as Record<string, unknown>)) {
    return String((value as { val: unknown }).val)
  }
  return String(value)
}

// An einem echten Auszug des ALLRIS-Feeds (Stadtrat Iserlohn) verifiziert
// (siehe docs/KONZEPT.md Abschnitt 11): SUMMARY enthält dort bereits direkt
// den Gremiumsnamen ohne Zusatz. Für andere Feed-Formate mit
// "Gremium – Sitzung"-Schema bleibt der Bindestrich-Fallback erhalten.
//
// Manche SUMMARYs tragen eine Anmerkung VOR dem Gremiumsnamen
// ("<Anmerkung> - <Gremium>", z. B. "Verschiebung auf den 12.11.2026 -
// Aufsichtsrat der Schillerplatz GmbH", "keine relevanten TOP´s -
// Verwaltungsrat Märkischer Stadtbetrieb Iserlohn/Hemer") - die Anmerkung
// wird fürs gremium-Feld abgetrennt, der Titel behält den vollen Text.
// WICHTIG: Änderungen hier auch in scripts/import-ics.mjs nachziehen
// (Logik bewusst dupliziert, siehe CLAUDE.md).
const ANMERKUNG_MIT_GREMIUM = [
  /^verschiebung[^-–—]*[-–—]\s*(.+)$/i,
  /^verschoben[^-–—]*[-–—]\s*(.+)$/i,
  /^keine relevanten top[^-–—]*[-–—]\s*(.+)$/i,
  /^absage[^-–—]*[-–—]\s*(.+)$/i,
  /^entfällt[^-–—]*[-–—]\s*(.+)$/i,
]

function extractGremium(summary: string): string | null {
  let s = summary.trim()
  for (const re of ANMERKUNG_MIT_GREMIUM) {
    const m = s.match(re)
    if (m) {
      s = m[1].trim()
      break
    }
  }
  const dashMatch = s.match(/^(.+?)\s*[-–—]\s*.*sitzung/i)
  if (dashMatch) return dashMatch[1].trim()
  return s || null
}

interface IcalEntry {
  type: string
  uid?: string
  start?: Date
  summary?: unknown
  location?: unknown
  url?: unknown
  status?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let sourceId: string | undefined
  try {
    const body = await req.json()
    sourceId = body?.source_id
  } catch {
    return jsonResponse({ error: 'Ungültiger Request-Body, source_id (JSON) erwartet.' }, 400)
  }

  if (!sourceId) {
    return jsonResponse({ error: 'source_id fehlt.' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen serverseitig.' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: source, error: sourceError } = await supabase
    .from('calendar_sources')
    .select('*')
    .eq('id', sourceId)
    .single()

  if (sourceError || !source) {
    return jsonResponse({ error: 'Kalenderquelle nicht gefunden.' }, 404)
  }

  // Bestehende Sessions dieser Quelle VOR dem Import laden, um nachher zu
  // erkennen, welche UIDs aus dem Feed verschwunden sind (= vermutlich
  // abgesagt - der ALLRIS-Feed markiert Absagen nicht über STATUS:CANCELLED,
  // sondern entfernt den Termin einfach aus dem Feed).
  const { data: existingRows } = await supabase
    .from('sessions')
    .select('ics_uid, status')
    .eq('source_id', source.id)
    .not('ics_uid', 'is', null)
  const existingByUid = new Map<string, string>((existingRows ?? []).map((r) => [r.ics_uid as string, r.status as string]))

  let parsed: Record<string, unknown>
  try {
    parsed = await ical.async.fromURL(source.ics_url)
  } catch (err) {
    return jsonResponse({ error: `Fehler beim Laden des ICS-Feeds: ${String(err)}` }, 502)
  }

  const entries = (Object.values(parsed) as IcalEntry[]).filter(
    (entry): entry is IcalEntry & { uid: string; start: Date } =>
      entry.type === 'VEVENT' && Boolean(entry.uid) && Boolean(entry.start),
  )

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
    return jsonResponse({ imported: 0 })
  }

  // status wird bewusst nicht mitgeschickt (siehe scripts/import-ics.mjs für
  // die Begründung: Insert nutzt den Tabellen-Default, Update lässt einen
  // manuell gesetzten Status wie 'aktiv' unangetastet). Cancel-/Uncancel-
  // Logik läuft danach separat.
  const { error: upsertError } = await supabase
    .from('sessions')
    .upsert(rows, { onConflict: 'source_id,ics_uid' })

  if (upsertError) {
    return jsonResponse({ error: upsertError.message }, 500)
  }

  const seenUids = new Set(rows.map((r) => r.ics_uid))
  const cancelledInFeed = new Set(entries.filter((e) => e.status === 'CANCELLED').map((e) => e.uid))
  const missingFromFeed = new Set([...existingByUid.keys()].filter((uid) => !seenUids.has(uid)))
  const toCancel = [...new Set([...cancelledInFeed, ...missingFromFeed])]

  const toUncancel = [...existingByUid.entries()]
    .filter(([uid, status]) => status === 'abgesagt' && seenUids.has(uid) && !cancelledInFeed.has(uid))
    .map(([uid]) => uid)

  if (toCancel.length > 0) {
    await supabase.from('sessions').update({ status: 'abgesagt' }).eq('source_id', source.id).in('ics_uid', toCancel)
  }
  if (toUncancel.length > 0) {
    await supabase.from('sessions').update({ status: 'geplant' }).eq('source_id', source.id).in('ics_uid', toUncancel)
  }

  return jsonResponse({ imported: rows.length, abgesagt: toCancel.length, reaktiviert: toUncancel.length })
})
