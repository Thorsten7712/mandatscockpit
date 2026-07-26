// Supabase Edge Function: Remote-MCP-Server für MandatsCockpit.
//
// Implementiert das MCP-JSON-RPC-Protokoll (initialize, tools/list,
// tools/call) über einen einzigen HTTP-POST-Endpunkt ("Streamable HTTP"
// ohne SSE-Streaming, da hier nur einfache, synchrone Tool-Aufrufe
// gebraucht werden). Es gibt kein fertiges Supabase/Deno-MCP-Template -
// das Protokoll-Handling unten ist bewusst schlank, kein allgemeiner
// MCP-SDK-Nachbau.
//
// Auth: Bearer-Token pro Nutzer (kein OAuth). Jedes Mitglied erzeugt sich
// in Settings.tsx ("MCP Connection") ein persönliches Token; nur der
// SHA-256-Hash landet in der Tabelle mcp_tokens (siehe
// supabase/migrations/0016_mcp_tokens.sql für die Begründung). Diese
// Function hasht das eingehende Bearer-Token identisch und schlägt damit
// den zugehörigen Nutzer nach - alle DB-Operationen laufen danach über den
// SUPABASE_SERVICE_ROLE_KEY (automatisch injiziert, wie bei
// import-ics-source/admin-users) im Namen dieses einen Nutzers, RLS wird
// hier also bewusst umgangen und durch den Token-Lookup ersetzt.
//
// Claude ruft diesen Endpunkt über "Connectors -> Custom Connector" auf
// (Funktions-URL + das persönliche Token als Query-Parameter), siehe
// README.md Abschnitt 9.
//
// Datei-Aufteilung (siehe docs/CHANGELOG.md für die Begründung - reine
// Umstrukturierung, keine Verhaltensänderung): diese Datei bündelt nur noch
// die JSON-RPC-Hülle (Parsing, Auth, Dispatch); die Tool-Implementierungen
// liegen nach Domäne sortiert in tools/*.ts, die Tool-Schemas in
// tools_schema.ts, gemeinsame Helper in shared.ts.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  corsHeaders,
  type JsonRpcId,
  type JsonRpcRequest,
  jsonRpcError,
  jsonRpcResult,
  resolveUser,
  toolTextResult,
} from './shared.ts'
import { TOOLS } from './tools_schema.ts'
import { createTodo, listTodos, completeTodo, updateTodo } from './tools/todos.ts'
import { createEvent, listEvents } from './tools/events.ts'
import { listSessions } from './tools/sessions.ts'
import { createAntrag, listAntraege, updateAntragStatus, listAntragFristen } from './tools/antraege.ts'
import { listNotes, createSessionNote, createEventNote, createTodoNote, createAntragNote } from './tools/notes.ts'
import { search } from './tools/search.ts'

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

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
  // docs/CHANGELOG.md für die Historie. Non-200 bleibt nur für echte
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
          instructions: `Verwaltet ToDos, eigene Termine, Sitzungen, Anträge und Notizen im MandatsCockpit-Account von ${user.name ?? 'diesem Nutzer'}.`,
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
        case 'list_todos':
          result = await listTodos(supabase, user.id, args)
          break
        case 'list_notes':
          result = await listNotes(supabase, user.id, args)
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
        case 'complete_todo':
          result = await completeTodo(supabase, user.id, args)
          break
        case 'update_todo':
          result = await updateTodo(supabase, user.id, args)
          break
        case 'create_antrag':
          result = await createAntrag(supabase, user.id, args)
          break
        case 'list_antraege':
          result = await listAntraege(supabase, user.id, args)
          break
        case 'update_antrag_status':
          result = await updateAntragStatus(supabase, user.id, args)
          break
        case 'create_antrag_note':
          result = await createAntragNote(supabase, user.id, args)
          break
        case 'list_antrag_fristen':
          result = await listAntragFristen(supabase, user.id)
          break
        case 'search':
          result = await search(supabase, user.id, args)
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
