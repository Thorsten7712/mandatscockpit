// Supabase Edge Function: Remote-MCP-Server für MandatsCockpit.
//
// Implementiert das MCP-JSON-RPC-Protokoll (initialize, tools/list,
// tools/call) über einen einzigen HTTP-POST-Endpunkt ("Streamable HTTP"
// ohne SSE-Streaming, da hier nur einfache, synchrone Tool-Aufrufe
// gebraucht werden). Es gibt kein fertiges Supabase/Deno-MCP-Template -
// das Protokoll-Handling unten ist bewusst schlank auf genau die drei
// Tools zugeschnitten, kein allgemeiner MCP-SDK-Nachbau.
//
// Auth: Bearer-Token pro Nutzer (kein OAuth). Jedes Mitglied erzeugt sich
// in Settings.tsx ("Claude-Integration") ein persönliches Token; nur der
// SHA-256-Hash landet in der Tabelle mcp_tokens (siehe
// supabase/migrations/0016_mcp_tokens.sql für die Begründung). Diese
// Function hasht das eingehende Bearer-Token identisch und schlägt damit
// den zugehörigen Nutzer nach - alle DB-Operationen laufen danach über den
// SUPABASE_SERVICE_ROLE_KEY (automatisch injiziert, wie bei
// import-ics-source/admin-users) im Namen dieses einen Nutzers, RLS wird
// hier also bewusst umgangen und durch den Token-Lookup ersetzt.
//
// Claude ruft diesen Endpunkt über "Connectors -> Custom Connector" auf
// (Funktions-URL + das persönliche Token als Bearer-Token), siehe
// README.md.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

// Access-Control-Allow-Methods fehlte ursprünglich: Der POST-Request mit
// Content-Type: application/json ist keine "simple request" (nicht-simpler
// Content-Type), Browser lösen deshalb einen CORS-Preflight (OPTIONS) aus.
// Ohne Allow-Methods in der Preflight-Antwort blockiert der Browser den
// eigentlichen POST komplett, obwohl OPTIONS selbst mit 200 beantwortet
// wird - curl simuliert diese Browser-CORS-Prüfung nicht und hat den Bug
// deshalb nie sichtbar gemacht. Betrifft echte Browser-/Electron-Clients
// (z. B. Claudes claude.ai-Web-App/Desktop-App), nicht serverseitige
// HTTP-Clients wie Claude Code.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
}

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

type JsonRpcId = string | number | null

interface JsonRpcRequest {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
}

function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function jsonRpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function toolTextResult(text: string, isError = false) {
  return { content: [{ type: 'text', text }], isError }
}

// Gleicher Algorithmus wie client-seitig in Settings.tsx (sha256Hex) - muss
// identisch bleiben, sonst schlägt der Token-Lookup fehl.
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const TOOLS = [
  {
    name: 'create_todo',
    description: 'Legt eine neue ToDo-Karte im MandatsCockpit-Board des angemeldeten Nutzers an.',
    inputSchema: {
      type: 'object',
      properties: {
        titel: { type: 'string', description: 'Titel der Aufgabe' },
        spalte: {
          type: 'string',
          description:
            "Name der Board-Spalte (z. B. 'Neu', 'Geplant', 'Wartet', 'Fertig'). Wird angelegt, falls sie beim Nutzer noch nicht existiert.",
        },
        faellig_am: {
          type: 'string',
          description: 'Fälligkeitsdatum im Format YYYY-MM-DD (optional).',
        },
        session_id: {
          type: 'string',
          description:
            'UUID einer Sitzung (z. B. aus list_next_sessions), an die die Aufgabe geknüpft werden soll (optional).',
        },
      },
      required: ['titel', 'spalte'],
    },
  },
  {
    name: 'create_event',
    description: "Legt einen neuen eigenen Termin (herkunft='privat') im persönlichen Kalender des angemeldeten Nutzers an.",
    inputSchema: {
      type: 'object',
      properties: {
        titel: { type: 'string', description: 'Titel des Termins' },
        start: {
          type: 'string',
          description: 'Start als ISO-8601-Zeitstempel, z. B. 2026-08-12T18:00:00+02:00',
        },
        ende: { type: 'string', description: 'Ende als ISO-8601-Zeitstempel (optional).' },
      },
      required: ['titel', 'start'],
    },
  },
  {
    name: 'list_sessions',
    description:
      'Listet Sitzungstermine (importiert aus den Kalenderquellen oder manuell nachgetragen) auf - wahlweise zukünftige, vergangene oder alle. Für Rückblicke ("worüber wurde im letzten Verkehrsausschuss gesprochen") zeitraum="vergangenheit" verwenden. Liefert je Sitzung auch die id, die für create_session_note gebraucht wird.',
    inputSchema: {
      type: 'object',
      properties: {
        zeitraum: {
          type: 'string',
          enum: ['zukunft', 'vergangenheit', 'alle'],
          description:
            'Welche Sitzungen: "zukunft" (Standard, nächste zuerst), "vergangenheit" (jüngste zuerst) oder "alle" (neueste zuerst).',
        },
        gremium: {
          type: 'string',
          description: "Filtert per Teilstring-Suche nach Gremium/Ausschuss, z. B. 'Verkehrsausschuss' (optional).",
        },
        nur_meine_gremien: {
          type: 'boolean',
          description:
            'true = nur Sitzungen der Gremien, in denen der Nutzer ein Mandat hat (plus reine Terminkalender-Quellen) - entspricht der Filterung im Dashboard/Archiv der Web-App. Standard false (alle sichtbaren Sitzungen). Bei Formulierungen wie "meine Sitzungen" true setzen.',
        },
        limit: {
          type: 'number',
          description: 'Maximale Anzahl Sitzungen (Standard 20, Maximum 100).',
        },
      },
    },
  },
  {
    name: 'list_events',
    description:
      'Listet die eigenen Termine des angemeldeten Nutzers (persönlicher Kalender, keine Gremiensitzungen) auf - wahlweise zukünftige, vergangene oder alle. Liefert je Termin auch die id, die für create_event_note gebraucht wird.',
    inputSchema: {
      type: 'object',
      properties: {
        zeitraum: {
          type: 'string',
          enum: ['zukunft', 'vergangenheit', 'alle'],
          description:
            'Welche Termine: "zukunft" (Standard, nächste zuerst), "vergangenheit" (jüngste zuerst) oder "alle" (neueste zuerst).',
        },
        limit: {
          type: 'number',
          description: 'Maximale Anzahl Termine (Standard 20, Maximum 100).',
        },
      },
    },
  },
  {
    name: 'create_session_note',
    description:
      'Speichert eine Notiz zu einer bestimmten Sitzung im MandatsCockpit-Account des angemeldeten Nutzers (erscheint dort in der Termindetailsicht der Sitzung, wie eine manuell eingetragene Notiz/ein manuell hochgeladenes Dokument). Unterstützt Freitext (z. B. eine im Chat erstellte Analyse/Zusammenfassung eines eingefügten Sammeldokuments), einen Datei-Anhang (Base64-kodiert, z. B. das Sammeldokument selbst) oder beides zusammen. Mindestens eins von beidem ist erforderlich. Für den Datei-Anhang gilt ein praktisches Limit von einigen MB (Base64 vergrößert die Originaldatei um ca. 33%, das Edge-Function-Request-Limit greift zuerst).',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'UUID der Sitzung (z. B. aus list_next_sessions), zu der die Notiz gehört.',
        },
        inhalt: {
          type: 'string',
          description: 'Freitext-Notiz, z. B. eine im Chat erstellte Analyse/Zusammenfassung (optional).',
        },
        dateiname: {
          type: 'string',
          description: 'Dateiname inkl. Endung für einen Datei-Anhang, z. B. "sammeldokument.pdf" (optional, nur zusammen mit datei_base64).',
        },
        datei_base64: {
          type: 'string',
          description: 'Base64-kodierter Inhalt der anzuhängenden Datei (optional, nur zusammen mit dateiname).',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'create_event_note',
    description:
      'Speichert eine Notiz zu einem bestimmten eigenen Termin (nicht Sitzung) im MandatsCockpit-Account des angemeldeten Nutzers (erscheint dort in der Termindetailsicht, wie eine manuell eingetragene Notiz/ein manuell hochgeladenes Dokument). Nur für Termine, die dem angemeldeten Nutzer gehören. Unterstützt Freitext, einen Datei-Anhang (Base64-kodiert) oder beides zusammen. Mindestens eins von beidem ist erforderlich.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: {
          type: 'string',
          description: 'UUID des eigenen Termins, zu dem die Notiz gehört.',
        },
        inhalt: {
          type: 'string',
          description: 'Freitext-Notiz (optional).',
        },
        dateiname: {
          type: 'string',
          description: 'Dateiname inkl. Endung für einen Datei-Anhang (optional, nur zusammen mit datei_base64).',
        },
        datei_base64: {
          type: 'string',
          description: 'Base64-kodierter Inhalt der anzuhängenden Datei (optional, nur zusammen mit dateiname).',
        },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'create_todo_note',
    description:
      'Speichert eine Notiz zu einer bestimmten ToDo-Karte im MandatsCockpit-Account des angemeldeten Nutzers (erscheint dort im Karten-Detail-Modal, wie ein manuell hochgeladenes Dokument - reiner Freitext ohne Datei landet ebenfalls dort, auch wenn die Web-UI für Karten primär Datei-Uploads zeigt). Nur für ToDo-Karten, die dem angemeldeten Nutzer gehören. Unterstützt Freitext, einen Datei-Anhang (Base64-kodiert) oder beides zusammen. Mindestens eins von beidem ist erforderlich.',
    inputSchema: {
      type: 'object',
      properties: {
        todo_id: {
          type: 'string',
          description: 'UUID der eigenen ToDo-Karte, zu der die Notiz gehört.',
        },
        inhalt: {
          type: 'string',
          description: 'Freitext-Notiz (optional).',
        },
        dateiname: {
          type: 'string',
          description: 'Dateiname inkl. Endung für einen Datei-Anhang (optional, nur zusammen mit datei_base64).',
        },
        datei_base64: {
          type: 'string',
          description: 'Base64-kodierter Inhalt der anzuhängenden Datei (optional, nur zusammen mit dateiname).',
        },
      },
      required: ['todo_id'],
    },
  },
] as const

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface ResolvedUser {
  id: string
  name: string | null
}

async function resolveUser(supabase: SupabaseClient, bearerToken: string): Promise<ResolvedUser | null> {
  const tokenHash = await sha256Hex(bearerToken)
  const { data: tokenRow } = await supabase
    .from('mcp_tokens')
    .select('user_id')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (!tokenRow) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', tokenRow.user_id)
    .maybeSingle()
  return { id: tokenRow.user_id as string, name: profile?.name ?? null }
}

async function createTodo(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const titel = typeof args.titel === 'string' ? args.titel.trim() : ''
  const spalte = typeof args.spalte === 'string' ? args.spalte.trim() : ''
  if (!titel || !spalte) {
    return toolTextResult('Fehler: titel und spalte sind erforderlich.', true)
  }
  const faelligAm = typeof args.faellig_am === 'string' && args.faellig_am ? args.faellig_am : null
  const sessionId = typeof args.session_id === 'string' && args.session_id ? args.session_id : null

  const { data: columns, error: columnsError } = await supabase
    .from('todo_columns')
    .select('id, titel, reihenfolge')
    .eq('user_id', userId)
  if (columnsError) return toolTextResult(`Fehler beim Laden der Spalten: ${columnsError.message}`, true)

  let column = (columns ?? []).find((c) => c.titel.trim().toLowerCase() === spalte.toLowerCase())
  if (!column) {
    const maxOrder = (columns ?? []).reduce((max, c) => Math.max(max, c.reihenfolge), -1)
    const { data: created, error: createError } = await supabase
      .from('todo_columns')
      .insert({ user_id: userId, titel: spalte, reihenfolge: maxOrder + 1 })
      .select('id, titel, reihenfolge')
      .single()
    if (createError || !created) {
      return toolTextResult(`Fehler beim Anlegen der Spalte "${spalte}": ${createError?.message}`, true)
    }
    column = created
  }

  // Board-Platzierung (Spalte/Position) lebt seit dem Erledigt/Teilen-Ausbau
  // in einer eigenen todo_placements-Zeile statt direkt auf todos, damit eine
  // Karte auf mehreren Boards unterschiedlich einsortiert sein kann (siehe
  // 0021_todo_erledigt_sharing.sql). Teilen selbst bleibt über MCP nicht
  // möglich, nur die eigene Platzierung wird hier angelegt.
  const { data: last } = await supabase
    .from('todo_placements')
    .select('position')
    .eq('column_id', column.id)
    .order('position', { ascending: false })
    .limit(1)
  const position = last && last.length > 0 ? last[0].position + 1 : 0

  const { data: todo, error: todoError } = await supabase
    .from('todos')
    .insert({
      user_id: userId,
      titel,
      faellig_am: faelligAm,
      session_id: sessionId,
    })
    .select('id')
    .single()
  if (todoError || !todo) return toolTextResult(`Fehler beim Anlegen des ToDos: ${todoError?.message}`, true)

  const { error: placementError } = await supabase
    .from('todo_placements')
    .insert({ todo_id: todo.id, user_id: userId, column_id: column.id, position })
  if (placementError) {
    return toolTextResult(`ToDo angelegt, aber Platzierung auf dem Board fehlgeschlagen: ${placementError.message}`, true)
  }

  return toolTextResult(`ToDo "${titel}" wurde in Spalte "${column.titel}" angelegt (id: ${todo.id}).`)
}

async function createEvent(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const titel = typeof args.titel === 'string' ? args.titel.trim() : ''
  const start = typeof args.start === 'string' ? args.start : ''
  if (!titel || !start || Number.isNaN(new Date(start).getTime())) {
    return toolTextResult('Fehler: titel und ein gültiges start-Datum (ISO-8601) sind erforderlich.', true)
  }
  const ende = typeof args.ende === 'string' && args.ende ? args.ende : null
  if (ende && Number.isNaN(new Date(ende).getTime())) {
    return toolTextResult('Fehler: ende ist kein gültiges ISO-8601-Datum.', true)
  }

  const { data: event, error } = await supabase
    .from('events')
    .insert({ user_id: userId, titel, start, ende, herkunft: 'privat', erstellt_von: userId })
    .select('id')
    .single()
  if (error || !event) return toolTextResult(`Fehler beim Anlegen des Termins: ${error?.message}`, true)

  return toolTextResult(`Termin "${titel}" am ${formatDateTime(start)} wurde angelegt (id: ${event.id}).`)
}

type Zeitraum = 'zukunft' | 'vergangenheit' | 'alle'

function parseZeitraum(value: unknown): Zeitraum {
  return value === 'vergangenheit' || value === 'alle' ? value : 'zukunft'
}

/** Nur "zukunft" sortiert aufsteigend (nächster Termin zuerst); Vergangenheit und
 *  "alle" absteigend, damit das Limit die jüngsten Einträge behält statt der ältesten. */
function sortAscending(zeitraum: Zeitraum): boolean {
  return zeitraum === 'zukunft'
}

function parseLimit(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : 20
  return Math.min(Math.max(Number.isFinite(n) ? n : 20, 1), 100)
}

function zeitraumLabel(zeitraum: Zeitraum): string {
  if (zeitraum === 'vergangenheit') return 'vergangene'
  if (zeitraum === 'alle') return ''
  return 'zukünftige'
}

interface SessionListRow {
  id: string
  titel: string
  gremium: string | null
  datum: string
  ort: string | null
  status: string
}

async function listSessions(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const zeitraum = parseZeitraum(args.zeitraum)
  const gremium = typeof args.gremium === 'string' ? args.gremium.trim() : ''
  const nurMeineGremien = args.nur_meine_gremien === true
  const limit = parseLimit(args.limit)
  const jetzt = new Date().toISOString()

  // supabase läuft hier mit dem Service-Role-Key (siehe Datei-Kopfkommentar),
  // RLS greift also nicht automatisch - die Sichtbarkeitsregel aus
  // "sessions_select_visible_source"/"calendar_sources_select_shared_or_own"
  // (supabase/migrations/0018_calendar_sources_privat.sql) muss hier manuell
  // nachgebildet werden, sonst würde dieses Tool private Kalenderquellen
  // anderer Mitglieder mit auflisten.
  const { data: visibleSources } = await supabase
    .from('calendar_sources')
    .select('id, art')
    .or(`verwaltet_von.is.null,verwaltet_von.eq.${userId}`)
  const visibleSourceIds = (visibleSources ?? []).map((s) => s.id as string)
  const terminSourceIds = (visibleSources ?? []).filter((s) => s.art === 'termin').map((s) => s.id as string)

  const baseQuery = () => {
    let q = supabase.from('sessions').select('id, titel, gremium, datum, ort, status')
    if (zeitraum === 'zukunft') q = q.gte('datum', jetzt)
    else if (zeitraum === 'vergangenheit') q = q.lt('datum', jetzt)
    q =
      visibleSourceIds.length > 0
        ? q.or(`source_id.is.null,source_id.in.(${visibleSourceIds.join(',')})`)
        : q.is('source_id', null)
    if (gremium) q = q.ilike('gremium', `%${gremium}%`)
    return q.order('datum', { ascending: sortAscending(zeitraum) }).limit(limit)
  }

  let rows: SessionListRow[]
  if (nurMeineGremien) {
    // Gleiche Vereinigungs-Semantik wie CalendarView.tsx/Archiv.tsx: Sitzungen der
    // eigenen Gremien PLUS alles aus reinen Terminkalender-Quellen (art='termin',
    // dort gibt es keine Gremien-Zuordnung). Bewusst zwei .in()-Abfragen statt
    // eines rohen .or()-Strings, weil Gremiennamen Kommas/Klammern enthalten und
    // damit das PostgREST-Filterformat brechen würden (siehe CLAUDE.md).
    const { data: gremienRows } = await supabase.from('user_gremien').select('gremium').eq('user_id', userId)
    const meineGremien = (gremienRows ?? []).map((g) => g.gremium as string)
    if (meineGremien.length === 0 && terminSourceIds.length === 0) {
      return toolTextResult(
        'Keine Gremien ausgewählt - unter Einstellungen -> Meine Gremien festlegen oder nur_meine_gremien weglassen.',
      )
    }
    const [byGremium, byTerminSource] = await Promise.all([
      meineGremien.length > 0 ? baseQuery().in('gremium', meineGremien) : Promise.resolve({ data: [], error: null }),
      terminSourceIds.length > 0
        ? baseQuery().in('source_id', terminSourceIds)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (byGremium.error) return toolTextResult(`Fehler beim Laden der Sitzungen: ${byGremium.error.message}`, true)
    if (byTerminSource.error) {
      return toolTextResult(`Fehler beim Laden der Sitzungen: ${byTerminSource.error.message}`, true)
    }
    const byId = new Map<string, SessionListRow>()
    ;[...(byGremium.data ?? []), ...(byTerminSource.data ?? [])].forEach((s) => byId.set(s.id, s as SessionListRow))
    rows = Array.from(byId.values())
      .sort((a, b) => (sortAscending(zeitraum) ? a.datum.localeCompare(b.datum) : b.datum.localeCompare(a.datum)))
      .slice(0, limit)
  } else {
    const { data, error } = await baseQuery()
    if (error) return toolTextResult(`Fehler beim Laden der Sitzungen: ${error.message}`, true)
    rows = (data ?? []) as SessionListRow[]
  }

  if (rows.length === 0) {
    const label = zeitraumLabel(zeitraum)
    return toolTextResult(
      gremium
        ? `Keine ${label} Sitzungen für "${gremium}" gefunden.`.replace('  ', ' ')
        : `Keine ${label} Sitzungen gefunden.`.replace('  ', ' '),
    )
  }

  const lines = rows.map((s) => {
    const status = s.status === 'abgesagt' ? ' [ABGESAGT]' : ''
    const ort = s.ort ? `, ${s.ort}` : ''
    return `- ${s.titel} (${s.gremium ?? 'ohne Gremium'}) am ${formatDateTime(s.datum)}${ort} — id: ${s.id}${status}`
  })
  return toolTextResult(lines.join('\n'))
}

async function listEvents(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const zeitraum = parseZeitraum(args.zeitraum)
  const limit = parseLimit(args.limit)
  const jetzt = new Date().toISOString()

  // events gehören immer genau einem Nutzer (RLS events_select_own) - der
  // Service-Role-Client umgeht RLS, daher hier manuell auf user_id filtern.
  let query = supabase.from('events').select('id, titel, start, ende, ort, status, herkunft').eq('user_id', userId)
  if (zeitraum === 'zukunft') query = query.gte('start', jetzt)
  else if (zeitraum === 'vergangenheit') query = query.lt('start', jetzt)

  const { data, error } = await query.order('start', { ascending: sortAscending(zeitraum) }).limit(limit)
  if (error) return toolTextResult(`Fehler beim Laden der Termine: ${error.message}`, true)
  if (!data || data.length === 0) {
    return toolTextResult(`Keine ${zeitraumLabel(zeitraum)} Termine gefunden.`.replace('  ', ' '))
  }

  const lines = data.map((e) => {
    const status = e.status === 'abgesagt' ? ' [ABGESAGT]' : ''
    const ort = e.ort ? `, ${e.ort}` : ''
    const herkunft = e.herkunft === 'fraktionsbuero' ? ' (vom Fraktionsbüro eingetragen)' : ''
    return `- ${e.titel} am ${formatDateTime(e.start)}${ort}${herkunft} — id: ${e.id}${status}`
  })
  return toolTextResult(lines.join('\n'))
}

interface NoteTargetConfig {
  /** Name des Arguments, das die UUID des Ziels trägt (session_id/event_id/todo_id). */
  idArgName: string
  /** Tabelle des Ziels. */
  table: 'sessions' | 'events' | 'todos'
  /** Spalte in summaries, die auf das Ziel zeigt. */
  idColumn: 'session_id' | 'event_id' | 'todo_id'
  /** events/todos gehören einem Nutzer (RLS events_select_own/todos_select_own_or_placed) -
   *  Service-Role-Client umgeht RLS, daher hier manuell auf user_id prüfen. sessions gehören
   *  dagegen keinem einzelnen Nutzer und werden nicht ownership-geprüft (Sichtbarkeit hängt an
   *  der Kalenderquelle, siehe sessions_select_visible_source - hier bewusst nicht nachgebildet,
   *  da eine Notiz am fremden Sitzungs-Datensatz nur im eigenen summaries-Bestand landet). */
  ownerScoped: boolean
  /** Für Fehlermeldungen/Bestätigungstext, z. B. "Sitzung", "Termin", "ToDo". */
  label: string
}

async function createNote(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
  target: NoteTargetConfig,
) {
  const targetId = typeof args[target.idArgName] === 'string' ? (args[target.idArgName] as string).trim() : ''
  const inhalt = typeof args.inhalt === 'string' && args.inhalt.trim() ? args.inhalt.trim() : null
  const dateiname = typeof args.dateiname === 'string' ? args.dateiname.trim() : ''
  const dateiBase64 = typeof args.datei_base64 === 'string' ? args.datei_base64.trim() : ''
  const hasFile = Boolean(dateiname && dateiBase64)

  if (!targetId) return toolTextResult(`Fehler: ${target.idArgName} ist erforderlich.`, true)
  if (!inhalt && !hasFile) {
    return toolTextResult('Fehler: entweder inhalt oder dateiname+datei_base64 sind erforderlich.', true)
  }
  if ((dateiname && !dateiBase64) || (!dateiname && dateiBase64)) {
    return toolTextResult('Fehler: dateiname und datei_base64 müssen zusammen angegeben werden.', true)
  }

  let targetQuery = supabase.from(target.table).select('id, titel').eq('id', targetId)
  if (target.ownerScoped) targetQuery = targetQuery.eq('user_id', userId)
  const { data: targetRow, error: targetError } = await targetQuery.maybeSingle()
  if (targetError) return toolTextResult(`Fehler beim Prüfen (${target.label}): ${targetError.message}`, true)
  if (!targetRow) {
    return toolTextResult(
      `${target.label} mit id ${targetId} wurde nicht gefunden${target.ownerScoped ? ' (oder gehört nicht zu diesem Konto)' : ''}.`,
      true,
    )
  }

  let dateiUrl: string | null = null
  if (hasFile) {
    let bytes: Uint8Array
    try {
      bytes = Uint8Array.from(atob(dateiBase64), (c) => c.charCodeAt(0))
    } catch {
      return toolTextResult('Fehler: datei_base64 ist kein gültiges Base64.', true)
    }
    const path = `${userId}/${Date.now()}-${dateiname}`
    const { error: uploadError } = await supabase.storage.from('zusammenfassungen').upload(path, bytes)
    if (uploadError) return toolTextResult(`Fehler beim Hochladen der Datei: ${uploadError.message}`, true)
    dateiUrl = path
  }

  const { data: note, error } = await supabase
    .from('summaries')
    .insert({ user_id: userId, [target.idColumn]: targetId, inhalt, datei_url: dateiUrl })
    .select('id')
    .single()
  if (error || !note) return toolTextResult(`Fehler beim Speichern der Notiz: ${error?.message}`, true)

  const parts = [inhalt ? 'Text' : null, dateiUrl ? `Datei "${dateiname}"` : null].filter(Boolean)
  return toolTextResult(
    `Notiz (${parts.join(' + ')}) zu ${target.label} "${targetRow.titel}" wurde gespeichert (id: ${note.id}).`,
  )
}

function createSessionNote(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  return createNote(supabase, userId, args, {
    idArgName: 'session_id',
    table: 'sessions',
    idColumn: 'session_id',
    ownerScoped: false,
    label: 'Sitzung',
  })
}

function createEventNote(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  return createNote(supabase, userId, args, {
    idArgName: 'event_id',
    table: 'events',
    idColumn: 'event_id',
    ownerScoped: true,
    label: 'Termin',
  })
}

function createTodoNote(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  return createNote(supabase, userId, args, {
    idArgName: 'todo_id',
    table: 'todos',
    idColumn: 'todo_id',
    ownerScoped: true,
    label: 'ToDo',
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Nur POST wird unterstützt.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen serverseitig.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  let body: JsonRpcRequest
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify(jsonRpcError(null, -32700, 'Parse error')), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const id = (body.id ?? null) as JsonRpcId
  const isNotification = !('id' in body)

  const respond = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  // Auth-Fehler werden bewusst NIE als HTTP 401 zurückgegeben: Claudes
  // MCP-Client startet einen OAuth-Registrierungsversuch, sobald der Server
  // irgendwann mit 401 antwortet (Standardverhalten laut MCP-Authorization-
  // Spezifikation) - das schlägt bei uns immer fehl, da diese Function kein
  // OAuth implementiert. Da Claudes "Custom Connector"-Dialog ohnehin kein
  // separates Token-Feld hat (nur die Connector-URL), reicht ein simpler
  // JSON-RPC-Fehler mit HTTP 200 völlig aus - das Ergebnis ist für den
  // aufrufenden Client identisch (Tool-Aufruf schlägt sichtbar fehl), löst
  // aber keine OAuth-Discovery aus.
  //
  // Claudes "Custom Connector"-UI bietet aktuell nur ein einzelnes URL-Feld
  // an - das Token wird deshalb direkt in der Connector-URL als
  // Query-Parameter mitgegeben (?token=...), siehe Settings.tsx und
  // README.md Abschnitt 9. Der Authorization-Header wird zusätzlich
  // unterstützt (falls ein anderer MCP-Client ihn doch setzen kann), Header
  // hat Vorrang vor dem Query-Parameter.
  const headerToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  const queryToken = new URL(req.url).searchParams.get('token') ?? ''
  const bearerToken = headerToken || queryToken
  if (!bearerToken) {
    return respond(jsonRpcError(id, -32001, 'Unauthorized: Token fehlt (weder Authorization-Header noch ?token=).'))
  }
  const user = await resolveUser(supabase, bearerToken)
  if (!user) {
    return respond(jsonRpcError(id, -32001, 'Unauthorized: ungültiges oder unbekanntes Token.'))
  }

  // Ab hier läuft jede Antwort bewusst über HTTP 200, auch JSON-RPC-Fehler
  // (falsche/fehlende method, unbekanntes Tool, nicht unterstützte
  // Methode wie resources/list oder prompts/list, die Claude beim Verbinden
  // offenbar unabhängig von den in initialize deklarierten capabilities
  // abfragt). Ein Nicht-200-Status an dieser Stelle hat bereits einmal die
  // komplette Connector-Verbindung in Claude abbrechen lassen, obwohl der
  // JSON-RPC-Fehler im Body für sich genommen korrekt war - siehe
  // CLAUDE.md für die Historie. Non-200 bleibt nur für echte
  // Transport-Fehler (kaputtes JSON, falsche HTTP-Methode, fehlendes
  // Token) reserviert.
  if (!body.method) {
    return respond(jsonRpcError(id, -32600, 'Invalid Request'))
  }

  switch (body.method) {
    case 'initialize': {
      const requested = (body.params?.protocolVersion as string) ?? DEFAULT_PROTOCOL_VERSION
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION
      return respond(
        jsonRpcResult(id, {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'mandatscockpit-mcp', version: '1.0.0' },
          instructions: `Verwaltet ToDos, eigene Termine und Sitzungstermine im MandatsCockpit-Account von ${user.name ?? 'diesem Nutzer'}.`,
        }),
      )
    }

    // Notifications (kein "id"-Feld) erwarten laut JSON-RPC/MCP-Spezifikation
    // keine Response - nur ein leerer 202er.
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return new Response(null, { status: 202, headers: corsHeaders })

    case 'ping':
      return respond(jsonRpcResult(id, {}))

    case 'tools/list':
      return respond(jsonRpcResult(id, { tools: TOOLS }))

    case 'tools/call': {
      const name = body.params?.name as string | undefined
      const args = (body.params?.arguments as Record<string, unknown>) ?? {}
      let result: ReturnType<typeof toolTextResult>
      switch (name) {
        case 'create_todo':
          result = await createTodo(supabase, user.id, args)
          break
        case 'create_event':
          result = await createEvent(supabase, user.id, args)
          break
        case 'list_sessions':
          result = await listSessions(supabase, user.id, args)
          break
        case 'list_events':
          result = await listEvents(supabase, user.id, args)
          break
        case 'create_session_note':
          result = await createSessionNote(supabase, user.id, args)
          break
        case 'create_event_note':
          result = await createEventNote(supabase, user.id, args)
          break
        case 'create_todo_note':
          result = await createTodoNote(supabase, user.id, args)
          break
        default:
          return respond(jsonRpcError(id, -32602, `Unbekanntes Tool: ${name}`))
      }
      return respond(jsonRpcResult(id, result))
    }

    default:
      if (isNotification) return new Response(null, { status: 202, headers: corsHeaders })
      return respond(jsonRpcError(id, -32601, `Methode nicht gefunden: ${body.method}`))
  }
})
