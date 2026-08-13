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

// "webcal://"/"webcals://" sind nur eine Client-Konvention ("das hier ist ein
// abonnierbarer Kalender") und kein von fetch unterstütztes Protokoll -
// ical.async.fromURL() wirft dafür deterministisch "fetch failed" (kein
// Netzwerkfehler). WICHTIG: identischer Fix in scripts/import-ics.mjs
// nachziehen (Logik bewusst dupliziert, siehe CLAUDE.md).
function normalizeIcsUrl(url: string): string {
  if (url.startsWith('webcal://')) return `https://${url.slice('webcal://'.length)}`
  if (url.startsWith('webcals://')) return `https://${url.slice('webcals://'.length)}`
  return url
}

// Nutzerentscheidung: der Kalender-Horizont beginnt am 11.11.2025 - ältere
// Feed-Einträge werden nicht (neu) importiert.
// WICHTIG: identischer Wert in scripts/import-ics.mjs nachziehen.
const MIN_IMPORT_DATUM = new Date('2025-11-11T00:00:00Z')

// Bug gefunden am 2026-07-26 (identische Begründung wie in
// scripts/import-ics.mjs, dort ausführlich kommentiert): ALLRIS-Feeds liefern
// nur ein rollierendes Zeitfenster, ältere Termine fallen mit der Zeit aus
// dem Feed heraus, unabhängig davon ob sie stattfanden oder abgesagt wurden.
// Die Absage-/Reaktivierungs-Erkennung darf deshalb nur auf noch nicht
// vergangene Sitzungen angewendet werden.
function startOfTodayUtcIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
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
  /** Nur bei wiederkehrenden Terminen gesetzt (rrule.js-Instanz aus node-ical) - siehe expandOccurrences(). */
  rrule?: { between: (after: Date, before: Date, inclusive?: boolean) => Date[] }
  /** Individuell geänderte Vorkommen (RECURRENCE-ID), keyed u. a. nach YYYY-MM-DD. */
  recurrences?: Record<string, unknown>
}

// Wie weit in die Zukunft wiederkehrende Termine (RRULE ohne UNTIL, z. B.
// "jeden Montag") expandiert werden - ohne Obergrenze wäre die Anzahl der
// erzeugten Zeilen unbegrenzt. WICHTIG: identischer Wert in
// scripts/import-ics.mjs nachziehen.
const RECURRENCE_HORIZON_MS = 365 * 24 * 60 * 60 * 1000

// Bug gefunden 2026-08 (Nutzerfeedback: "Nächste Termine" zeigt nur
// Gremiensitzungen, keine Termine aus reinen Terminkalender-Quellen): bei
// einem wiederkehrenden Termin (RRULE) liefert node-ical in entry.start NUR
// den ERSTEN Termin der Serie, ohne die Wiederholungen selbst zu expandieren
// - liegt dieser erste Termin in der Vergangenheit (typisch bei einer seit
// Monaten laufenden wöchentlichen Serie), verschwindet der gesamte Termin
// unter "Nächste Termine", obwohl er z. B. jeden Montag weiter stattfindet.
// node-ical liefert bei RRULE-Terminen zusätzlich ein fertiges rrule.js-
// RRule-Objekt (entry.rrule) - dessen .between() übernimmt die Expansion,
// keine zusätzliche Abhängigkeit nötig. Bereits individuell geänderte
// Vorkommen (RECURRENCE-ID) tauchen im Feed als eigener VEVENT mit eigener
// uid auf (normaler, nicht-rrule Zweig unten) - deren Datum wird beim
// Expandieren der Basis-Serie übersprungen, sonst gäbe es für diesen Tag
// zwei widersprüchliche Zeilen. WICHTIG: identische Logik in
// scripts/import-ics.mjs nachziehen.
function expandOccurrences(rawEntries: IcalEntry[]): IcalEntry[] {
  const von = MIN_IMPORT_DATUM
  const bis = new Date(Date.now() + RECURRENCE_HORIZON_MS)
  const expanded: IcalEntry[] = []
  for (const entry of rawEntries) {
    if (!entry.rrule) {
      expanded.push(entry)
      continue
    }
    const overrideDates = new Set(
      Object.keys(entry.recurrences ?? {}).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)),
    )
    for (const occurrence of entry.rrule.between(von, bis, true)) {
      const dateKey = occurrence.toISOString().slice(0, 10)
      if (overrideDates.has(dateKey)) continue
      expanded.push({
        type: 'VEVENT',
        uid: `${entry.uid}::${occurrence.toISOString()}`,
        start: occurrence,
        summary: entry.summary,
        location: entry.location,
        url: entry.url,
        status: entry.status,
      })
    }
  }
  return expanded
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
    .gte('datum', startOfTodayUtcIso())
  const existingByUid = new Map<string, string>((existingRows ?? []).map((r) => [r.ics_uid as string, r.status as string]))

  let parsed: Record<string, unknown>
  try {
    parsed = await ical.async.fromURL(normalizeIcsUrl(source.ics_url))
  } catch (err) {
    return jsonResponse({ error: `Fehler beim Laden des ICS-Feeds: ${String(err)}` }, 502)
  }

  // Wiederkehrende Termine (entry.rrule gesetzt) NICHT hier schon auf
  // MIN_IMPORT_DATUM filtern - ihr entry.start ist nur der erste Termin der
  // Serie und liegt bei einer laufenden Serie oft weit davor; die eigentliche
  // Datums-/Horizont-Filterung passiert je Vorkommen in expandOccurrences()
  // via rrule.between().
  const rawEntries = (Object.values(parsed) as IcalEntry[]).filter(
    (entry): entry is IcalEntry & { uid: string; start: Date } =>
      entry.type === 'VEVENT' &&
      Boolean(entry.uid) &&
      Boolean(entry.start) &&
      (Boolean(entry.rrule) || new Date(entry.start!) >= MIN_IMPORT_DATUM),
  )
  const entries = expandOccurrences(rawEntries) as (IcalEntry & { uid: string; start: Date })[]

  // "termin"-Quellen tragen bewusst kein gremium, siehe scripts/import-ics.mjs.
  const rows = entries.map((entry) => {
    const summary = toText(entry.summary)
    return {
      source_id: source.id,
      ics_uid: entry.uid,
      titel: summary || 'Ohne Titel',
      gremium: source.art === 'termin' ? null : summary ? extractGremium(summary) : null,
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
