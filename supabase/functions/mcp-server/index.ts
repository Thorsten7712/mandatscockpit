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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, mcp-protocol-version',
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
    name: 'list_next_sessions',
    description:
      'Listet zukünftige Sitzungstermine (importiert aus den Kalenderquellen) auf, optional gefiltert nach Gremium.',
    inputSchema: {
      type: 'object',
      properties: {
        gremium: {
          type: 'string',
          description: "Filtert per Teilstring-Suche nach Gremium/Ausschuss, z. B. 'Verkehrsausschuss' (optional).",
        },
      },
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

  const { data: last } = await supabase
    .from('todos')
    .select('position')
    .eq('column_id', column.id)
    .order('position', { ascending: false })
    .limit(1)
  const position = last && last.length > 0 ? last[0].position + 1 : 0

  const { data: todo, error: todoError } = await supabase
    .from('todos')
    .insert({
      user_id: userId,
      column_id: column.id,
      position,
      titel,
      faellig_am: faelligAm,
      session_id: sessionId,
    })
    .select('id')
    .single()
  if (todoError || !todo) return toolTextResult(`Fehler beim Anlegen des ToDos: ${todoError?.message}`, true)

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

async function listNextSessions(supabase: SupabaseClient, args: Record<string, unknown>) {
  const gremium = typeof args.gremium === 'string' ? args.gremium.trim() : ''
  let query = supabase
    .from('sessions')
    .select('id, titel, gremium, ebene, datum, ort, status')
    .gte('datum', new Date().toISOString())
    .order('datum', { ascending: true })
    .limit(20)
  if (gremium) query = query.ilike('gremium', `%${gremium}%`)

  const { data, error } = await query
  if (error) return toolTextResult(`Fehler beim Laden der Sitzungen: ${error.message}`, true)
  if (!data || data.length === 0) {
    return toolTextResult(
      gremium ? `Keine zukünftigen Sitzungen für "${gremium}" gefunden.` : 'Keine zukünftigen Sitzungen gefunden.',
    )
  }

  const lines = data.map((s) => {
    const status = s.status === 'abgesagt' ? ' [ABGESAGT]' : ''
    const ort = s.ort ? `, ${s.ort}` : ''
    return `- ${s.titel} (${s.gremium ?? 'ohne Gremium'}) am ${formatDateTime(s.datum)}${ort} — id: ${s.id}${status}`
  })
  return toolTextResult(lines.join('\n'))
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

  const bearerToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!bearerToken) {
    return new Response(JSON.stringify({ error: 'Bearer-Token fehlt.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
    })
  }
  const user = await resolveUser(supabase, bearerToken)
  if (!user) {
    return new Response(JSON.stringify({ error: 'Ungültiges oder unbekanntes Token.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
    })
  }

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

  if (!body.method) {
    return respond(jsonRpcError(id, -32600, 'Invalid Request'), 400)
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
        case 'list_next_sessions':
          result = await listNextSessions(supabase, args)
          break
        default:
          return respond(jsonRpcError(id, -32602, `Unbekanntes Tool: ${name}`), 400)
      }
      return respond(jsonRpcResult(id, result))
    }

    default:
      if (isNotification) return new Response(null, { status: 202, headers: corsHeaders })
      return respond(jsonRpcError(id, -32601, `Methode nicht gefunden: ${body.method}`), 404)
  }
})
