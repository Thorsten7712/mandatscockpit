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
    name: 'list_todos',
    description:
      'Listet die ToDo-Karten des angemeldeten Nutzers auf (eigene und mit ihm geteilte), sortiert nach Fälligkeitsdatum. Für Fragen wie "was steht noch offen" oder "was ist diese Woche fällig". Liefert je Karte auch die id, die für create_todo_note gebraucht wird.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['offen', 'erledigt', 'alle'],
          description: 'Welche Karten: "offen" (Standard), "erledigt" oder "alle".',
        },
        spalte: {
          type: 'string',
          description:
            'Filtert auf eine Board-Spalte des Nutzers, z. B. "Wartet" (optional, Teilstring-Vergleich ohne Groß-/Kleinschreibung).',
        },
        limit: {
          type: 'number',
          description: 'Maximale Anzahl Karten (Standard 20, Maximum 100).',
        },
      },
    },
  },
  {
    name: 'list_notes',
    description:
      'Liest gespeicherte Notizen und hochgeladene Dokumente wieder aus (das Gegenstück zu create_session_note/create_event_note/create_todo_note). Ohne Filter kommen die zuletzt gespeicherten Einträge über alle Sitzungen/Termine/ToDos hinweg; mit genau einem der *_id-Filter alle Einträge zu diesem einen Objekt. Für Fragen wie "was habe ich zur letzten Ratssitzung notiert". Bei Datei-Anhängen wird nur der Dateiname genannt - der Dateiinhalt selbst kann über MCP nicht heruntergeladen werden.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Nur Notizen zu dieser Sitzung (optional).' },
        event_id: { type: 'string', description: 'Nur Notizen zu diesem eigenen Termin (optional).' },
        todo_id: { type: 'string', description: 'Nur Notizen zu dieser ToDo-Karte (optional).' },
        limit: {
          type: 'number',
          description: 'Maximale Anzahl Notizen (Standard 20, Maximum 100).',
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
      'Speichert eine Notiz zu einer bestimmten ToDo-Karte im MandatsCockpit-Account des angemeldeten Nutzers (erscheint dort im Karten-Detail-Modal, wie ein manuell hochgeladenes Dokument - reiner Freitext ohne Datei landet ebenfalls dort, auch wenn die Web-UI für Karten primär Datei-Uploads zeigt). Nur für ToDo-Karten, die dem Nutzer gehören oder mit ihm geteilt sind. Unterstützt Freitext, einen Datei-Anhang (Base64-kodiert) oder beides zusammen. Mindestens eins von beidem ist erforderlich.',
    inputSchema: {
      type: 'object',
      properties: {
        todo_id: {
          type: 'string',
          description: 'UUID der ToDo-Karte, zu der die Notiz gehört.',
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
  {
    name: 'complete_todo',
    description:
      'Hakt eine ToDo-Karte ab oder macht das rückgängig. Für Karten, die dem Nutzer gehören oder mit ihm geteilt sind.',
    inputSchema: {
      type: 'object',
      properties: {
        todo_id: { type: 'string', description: 'UUID der ToDo-Karte.' },
        erledigt: {
          type: 'boolean',
          description: 'true = abhaken (Standard), false = wieder auf offen setzen.',
        },
      },
      required: ['todo_id'],
    },
  },
  {
    name: 'update_todo',
    description:
      'Ändert Titel, Beschreibung, Fälligkeitsdatum, Zuständigkeit und/oder Board-Spalte einer ToDo-Karte. Für Karten, die dem Nutzer gehören oder mit ihm geteilt sind - "spalte" verschiebt dabei nur die eigene Platzierung des Nutzers (jede Person hat ein eigenes Board), nicht die der anderen. Nur angegebene Felder werden geändert.',
    inputSchema: {
      type: 'object',
      properties: {
        todo_id: { type: 'string', description: 'UUID der ToDo-Karte.' },
        titel: { type: 'string', description: 'Neuer Titel (optional).' },
        beschreibung: { type: 'string', description: 'Neue Beschreibung (optional).' },
        faellig_am: { type: 'string', description: 'Neues Fälligkeitsdatum im Format YYYY-MM-DD (optional).' },
        zustaendig: { type: 'string', description: 'Neue Zuständigkeit als Freitext (optional).' },
        spalte: {
          type: 'string',
          description:
            'Board-Spalte, in die die Karte (auf dem eigenen Board des Nutzers) verschoben werden soll - wird angelegt, falls sie noch nicht existiert (optional).',
        },
      },
      required: ['todo_id'],
    },
  },
  {
    name: 'create_antrag',
    description:
      'Legt einen neuen eigenen Antrag an (Status startet immer bei "entwurf"). Wird eine session_id angegeben, werden ausschuss und ebene automatisch aus deren Gremium/Ebene übernommen, sofern nicht explizit gesetzt (wie im "+ Antrag"-Formular der Web-App).',
    inputSchema: {
      type: 'object',
      properties: {
        titel: { type: 'string', description: 'Titel des Antrags' },
        inhalt: { type: 'string', description: 'Antragstext (optional).' },
        ausschuss: { type: 'string', description: 'Vorgesehener Ausschuss (optional, sonst aus session_id übernommen).' },
        ebene: {
          type: 'string',
          enum: ['kommune', 'kreis', 'land', 'bund'],
          description: 'Ebene, für Fristen-Nachschlag und Teilen-Filter (optional, sonst aus session_id übernommen).',
        },
        session_id: {
          type: 'string',
          description: 'UUID der vorgesehenen Sitzung, an die der Antrag geknüpft werden soll (optional).',
        },
      },
      required: ['titel'],
    },
  },
  {
    name: 'list_antraege',
    description:
      'Listet Anträge auf - eigene und mit dem Nutzer geteilte. Liefert je Antrag auch die id, die für update_antrag_status und create_antrag_note gebraucht wird.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['aktiv', 'entwurf', 'gestellt', 'in_beratung', 'vertagt', 'abgestimmt', 'zurueckgezogen', 'alle'],
          description:
            '"aktiv" (Standard) = entwurf/gestellt/in_beratung/vertagt (noch nicht final entschieden), ein einzelner Status, oder "alle".',
        },
        ausschuss: {
          type: 'string',
          description: 'Filtert per Teilstring-Suche nach Ausschuss (optional).',
        },
        limit: {
          type: 'number',
          description: 'Maximale Anzahl Anträge (Standard 20, Maximum 100).',
        },
      },
    },
  },
  {
    name: 'update_antrag_status',
    description:
      'Ändert den Status eines Antrags (z. B. von "entwurf" auf "gestellt", oder auf "abgestimmt" mit Ergebnis). Für Anträge, die dem Nutzer gehören oder mit ihm geteilt sind. Beim Übergang auf "gestellt" wird eingereicht_am automatisch auf heute gesetzt, falls nicht bereits vorhanden oder explizit angegeben.',
    inputSchema: {
      type: 'object',
      properties: {
        antrag_id: { type: 'string', description: 'UUID des Antrags.' },
        status: {
          type: 'string',
          enum: ['entwurf', 'gestellt', 'in_beratung', 'vertagt', 'abgestimmt', 'zurueckgezogen'],
          description: 'Neuer Status.',
        },
        ergebnis: {
          type: 'string',
          enum: ['positiv', 'negativ'],
          description: 'Erforderlich, wenn status="abgestimmt" gesetzt wird.',
        },
        eingereicht_am: {
          type: 'string',
          description: 'Einreichungsdatum im Format YYYY-MM-DD, überschreibt die Automatik (optional).',
        },
      },
      required: ['antrag_id', 'status'],
    },
  },
  {
    name: 'create_antrag_note',
    description:
      'Speichert eine Notiz zu einem bestimmten Antrag (Freitext, ein Datei-Anhang als Base64, oder beides). Für Anträge, die dem Nutzer gehören oder mit ihm geteilt sind. Mindestens eins von Text oder Datei ist erforderlich.',
    inputSchema: {
      type: 'object',
      properties: {
        antrag_id: { type: 'string', description: 'UUID des Antrags, zu dem die Notiz gehört.' },
        inhalt: { type: 'string', description: 'Freitext-Notiz (optional).' },
        dateiname: {
          type: 'string',
          description: 'Dateiname inkl. Endung für einen Datei-Anhang (optional, nur zusammen mit datei_base64).',
        },
        datei_base64: {
          type: 'string',
          description: 'Base64-kodierter Inhalt der anzuhängenden Datei (optional, nur zusammen mit dateiname).',
        },
      },
      required: ['antrag_id'],
    },
  },
  {
    name: 'list_antrag_fristen',
    description:
      'Berechnet die Einreichungsfristen (Sitzungsdatum minus die für die Ebene konfigurierte Vorlaufzeit aus Einstellungen -> Antrags-Fristen) für die eigenen aktiven Anträge mit verknüpfter Sitzung, sortiert nach Frist. Nur berechenbar, wenn Antrag, verknüpfte Sitzung UND eine Fristen-Einstellung für die jeweilige Ebene vorhanden sind.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search',
    description:
      'Durchsucht Titel/Inhalte von ToDo-Karten, Anträgen und Notizen (Freitext-Suche, Groß-/Kleinschreibung egal) - berücksichtigt dabei nur für den Nutzer sichtbare Einträge (eigene und geteilte). Für Fragen wie "wo ging es um XY".',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Suchbegriff.' },
        limit: {
          type: 'number',
          description: 'Maximale Anzahl Treffer je Kategorie (Standard 10, Maximum 50).',
        },
      },
      required: ['query'],
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

/** `faellig_am` ist ein reines Datum (date, kein timestamptz) - hier ohne Uhrzeit und
 *  ohne Zeitzonen-Umrechnung formatieren, sonst kippt das Datum je nach Zeitzone. */
function formatDate(isoDate: string): string {
  const [jahr, monat, tag] = isoDate.split('-')
  return tag && monat && jahr ? `${tag}.${monat}.${jahr}` : isoDate
}

/** Storage-Pfade sind `<user_id>/<timestamp>-<dateiname>` - für die Anzeige nur den Dateinamen. */
function fileNameFromPath(path: string): string {
  return path.split('/').pop() ?? path
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [gekürzt, ${text.length} Zeichen gesamt]`
}

interface TodoListRow {
  id: string
  titel: string
  faellig_am: string | null
  zustaendig: string | null
  erledigt: boolean
  erledigt_am: string | null
  user_id: string
}

async function listTodos(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const status = args.status === 'erledigt' || args.status === 'alle' ? args.status : 'offen'
  const spalte = typeof args.spalte === 'string' ? args.spalte.trim().toLowerCase() : ''
  const limit = parseLimit(args.limit)

  // Die Platzierungen des Nutzers liefern beides: die Menge der für ihn sichtbaren
  // Karten (eigene UND mit ihm geteilte, vgl. todos_select_own_or_placed - der
  // Service-Role-Client umgeht RLS) und die Board-Spalte je Karte.
  const { data: placements } = await supabase
    .from('todo_placements')
    .select('todo_id, column_id')
    .eq('user_id', userId)
  const columnIdByTodo = new Map((placements ?? []).map((p) => [p.todo_id as string, p.column_id as string]))
  const placedTodoIds = (placements ?? []).map((p) => p.todo_id as string)

  const { data: columns } = await supabase.from('todo_columns').select('id, titel').eq('user_id', userId)
  const columnTitleById = new Map((columns ?? []).map((c) => [c.id as string, c.titel as string]))

  const baseQuery = () => {
    let q = supabase.from('todos').select('id, titel, faellig_am, zustaendig, erledigt, erledigt_am, user_id')
    if (status === 'offen') q = q.eq('erledigt', false)
    else if (status === 'erledigt') q = q.eq('erledigt', true)
    return q
  }
  const [own, placed] = await Promise.all([
    baseQuery().eq('user_id', userId),
    placedTodoIds.length > 0 ? baseQuery().in('id', placedTodoIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (own.error) return toolTextResult(`Fehler beim Laden der ToDos: ${own.error.message}`, true)
  if (placed.error) return toolTextResult(`Fehler beim Laden der ToDos: ${placed.error.message}`, true)

  const byId = new Map<string, TodoListRow>()
  ;[...(own.data ?? []), ...(placed.data ?? [])].forEach((t) => byId.set(t.id, t as TodoListRow))
  let rows = Array.from(byId.values())

  if (spalte) {
    rows = rows.filter((t) => {
      const titel = columnTitleById.get(columnIdByTodo.get(t.id) ?? '')
      return titel ? titel.toLowerCase().includes(spalte) : false
    })
  }

  rows.sort((a, b) =>
    status === 'erledigt'
      ? (b.erledigt_am ?? '').localeCompare(a.erledigt_am ?? '')
      : // Karten ohne Fälligkeit ans Ende statt an den Anfang sortieren.
        (a.faellig_am ?? '9999-12-31').localeCompare(b.faellig_am ?? '9999-12-31'),
  )
  rows = rows.slice(0, limit)

  if (rows.length === 0) {
    const was = status === 'erledigt' ? 'erledigten' : status === 'alle' ? '' : 'offenen'
    return toolTextResult(
      (spalte ? `Keine ${was} ToDos in einer Spalte mit "${spalte}" gefunden.` : `Keine ${was} ToDos gefunden.`)
        .replace('  ', ' '),
    )
  }

  const lines = rows.map((t) => {
    const box = t.erledigt ? '[x]' : '[ ]'
    const details: string[] = []
    if (t.erledigt && t.erledigt_am) details.push(`erledigt am ${formatDate(t.erledigt_am.slice(0, 10))}`)
    else if (t.faellig_am) details.push(`fällig ${formatDate(t.faellig_am)}`)
    const spaltenTitel = columnTitleById.get(columnIdByTodo.get(t.id) ?? '')
    if (spaltenTitel) details.push(`Spalte: ${spaltenTitel}`)
    if (t.zustaendig) details.push(`zuständig: ${t.zustaendig}`)
    if (t.user_id !== userId) details.push('geteilt')
    const suffix = details.length > 0 ? ` — ${details.join(' · ')}` : ''
    return `- ${box} ${t.titel}${suffix} — id: ${t.id}`
  })
  return toolTextResult(lines.join('\n'))
}

interface NoteListRow {
  id: string
  session_id: string | null
  event_id: string | null
  todo_id: string | null
  antrag_id: string | null
  inhalt: string | null
  datei_url: string | null
  erstellt_am: string
  user_id: string
}

async function listNotes(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const sessionId = typeof args.session_id === 'string' && args.session_id.trim() ? args.session_id.trim() : null
  const eventId = typeof args.event_id === 'string' && args.event_id.trim() ? args.event_id.trim() : null
  const todoId = typeof args.todo_id === 'string' && args.todo_id.trim() ? args.todo_id.trim() : null
  const limit = parseLimit(args.limit)

  const gesetzteFilter = [sessionId, eventId, todoId].filter(Boolean)
  if (gesetzteFilter.length > 1) {
    return toolTextResult('Fehler: bitte höchstens einen der Filter session_id, event_id, todo_id setzen.', true)
  }

  // Sichtbarkeit wie in der Web-UI: eigene Notizen (summaries_manage_own) plus
  // Notizen anderer auf ToDo-Karten, auf denen der Nutzer eine Platzierung hat
  // (summaries_select_via_todo_placement). Anträge bleiben außen vor, solange es
  // keine Antrags-Tools gibt.
  const { data: placements } = await supabase.from('todo_placements').select('todo_id').eq('user_id', userId)
  const placedTodoIds = (placements ?? []).map((p) => p.todo_id as string)

  const baseQuery = () => {
    let q = supabase
      .from('summaries')
      .select('id, session_id, event_id, todo_id, antrag_id, inhalt, datei_url, erstellt_am, user_id')
    if (sessionId) q = q.eq('session_id', sessionId)
    if (eventId) q = q.eq('event_id', eventId)
    if (todoId) q = q.eq('todo_id', todoId)
    return q.order('erstellt_am', { ascending: false }).limit(limit)
  }
  const [own, viaTodo] = await Promise.all([
    baseQuery().eq('user_id', userId),
    placedTodoIds.length > 0 ? baseQuery().in('todo_id', placedTodoIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (own.error) return toolTextResult(`Fehler beim Laden der Notizen: ${own.error.message}`, true)
  if (viaTodo.error) return toolTextResult(`Fehler beim Laden der Notizen: ${viaTodo.error.message}`, true)

  const byId = new Map<string, NoteListRow>()
  ;[...(own.data ?? []), ...(viaTodo.data ?? [])].forEach((n) => byId.set(n.id, n as NoteListRow))
  const rows = Array.from(byId.values())
    .sort((a, b) => b.erstellt_am.localeCompare(a.erstellt_am))
    .slice(0, limit)

  if (rows.length === 0) return toolTextResult('Keine Notizen/Dokumente gefunden.')

  // Titel der verknüpften Objekte in je einer Sammelabfrage nachladen.
  const idsOf = (key: 'session_id' | 'event_id' | 'todo_id') =>
    Array.from(new Set(rows.map((r) => r[key]).filter((v): v is string => Boolean(v))))
  const [sessions, events, todos] = await Promise.all([
    idsOf('session_id').length > 0
      ? supabase.from('sessions').select('id, titel').in('id', idsOf('session_id'))
      : Promise.resolve({ data: [] }),
    idsOf('event_id').length > 0
      ? supabase.from('events').select('id, titel').in('id', idsOf('event_id'))
      : Promise.resolve({ data: [] }),
    idsOf('todo_id').length > 0
      ? supabase.from('todos').select('id, titel').in('id', idsOf('todo_id'))
      : Promise.resolve({ data: [] }),
  ])
  const titelById = new Map<string, string>()
  ;[...(sessions.data ?? []), ...(events.data ?? []), ...(todos.data ?? [])].forEach((r) =>
    titelById.set(r.id as string, r.titel as string),
  )

  // Bei einem gesetzten Filter ist der Kontext eng - dann den vollen Text zeigen,
  // sonst kürzen, damit eine breite Liste die Antwort nicht sprengt.
  const maxLen = gesetzteFilter.length === 1 ? 4000 : 500

  const lines = rows.map((n) => {
    let ziel = 'ohne Zuordnung'
    if (n.session_id) ziel = `Sitzung "${titelById.get(n.session_id) ?? n.session_id}"`
    else if (n.event_id) ziel = `Termin "${titelById.get(n.event_id) ?? n.event_id}"`
    else if (n.todo_id) ziel = `ToDo "${titelById.get(n.todo_id) ?? n.todo_id}"`
    else if (n.antrag_id) ziel = 'Antrag'
    const teile: string[] = []
    if (n.inhalt) teile.push(truncate(n.inhalt, maxLen))
    if (n.datei_url) teile.push(`[Datei: ${fileNameFromPath(n.datei_url)}]`)
    if (n.user_id !== userId) teile.push('(von einer geteilten Karte)')
    return `- ${formatDateTime(n.erstellt_am)} · ${ziel}: ${teile.join(' ')}`
  })
  return toolTextResult(lines.join('\n\n'))
}

/** Prüft, ob eine ToDo-Karte dem Nutzer gehört oder mit ihm geteilt ist (RLS
 *  todos_update_own_or_placed - Service-Role-Client umgeht RLS, daher hier manuell). */
async function todoIstZugreifbar(supabase: SupabaseClient, userId: string, todoId: string): Promise<boolean> {
  const { data: todo } = await supabase.from('todos').select('user_id').eq('id', todoId).maybeSingle()
  if (!todo) return false
  if (todo.user_id === userId) return true
  const { data: placement } = await supabase
    .from('todo_placements')
    .select('id')
    .eq('todo_id', todoId)
    .eq('user_id', userId)
    .maybeSingle()
  return Boolean(placement)
}

async function completeTodo(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const todoId = typeof args.todo_id === 'string' ? args.todo_id.trim() : ''
  if (!todoId) return toolTextResult('Fehler: todo_id ist erforderlich.', true)
  const erledigt = args.erledigt === false ? false : true

  if (!(await todoIstZugreifbar(supabase, userId, todoId))) {
    return toolTextResult(`ToDo mit id ${todoId} wurde nicht gefunden (oder gehört nicht zu diesem Konto).`, true)
  }

  const { data: current } = await supabase.from('todos').select('erledigt, erledigt_am, titel').eq('id', todoId).single()
  // erledigt_am nur beim Übergang false->true neu setzen (gleiche Logik wie
  // TodoDetailModal.tsx), damit ein erneutes Abhaken einen bereits gesetzten
  // Zeitpunkt nicht verändert.
  const wurdeGesetzt = erledigt && !current?.erledigt
  const erledigtAm = erledigt ? (wurdeGesetzt ? new Date().toISOString() : current?.erledigt_am ?? null) : null

  const { error } = await supabase.from('todos').update({ erledigt, erledigt_am: erledigtAm }).eq('id', todoId)
  if (error) return toolTextResult(`Fehler beim Aktualisieren: ${error.message}`, true)

  return toolTextResult(
    `ToDo "${current?.titel ?? todoId}" wurde als ${erledigt ? 'erledigt' : 'offen'} markiert.`,
  )
}

async function updateTodo(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const todoId = typeof args.todo_id === 'string' ? args.todo_id.trim() : ''
  if (!todoId) return toolTextResult('Fehler: todo_id ist erforderlich.', true)

  if (!(await todoIstZugreifbar(supabase, userId, todoId))) {
    return toolTextResult(`ToDo mit id ${todoId} wurde nicht gefunden (oder gehört nicht zu diesem Konto).`, true)
  }

  const updates: Record<string, unknown> = {}
  if (typeof args.titel === 'string' && args.titel.trim()) updates.titel = args.titel.trim()
  if (typeof args.beschreibung === 'string') updates.beschreibung = args.beschreibung.trim() || null
  if (typeof args.faellig_am === 'string') updates.faellig_am = args.faellig_am.trim() || null
  if (typeof args.zustaendig === 'string') updates.zustaendig = args.zustaendig.trim() || null

  const spalte = typeof args.spalte === 'string' ? args.spalte.trim() : ''
  let spaltenHinweis = ''
  if (spalte) {
    const { data: columns } = await supabase.from('todo_columns').select('id, titel, reihenfolge').eq('user_id', userId)
    let column = (columns ?? []).find((c) => c.titel.trim().toLowerCase() === spalte.toLowerCase())
    if (!column) {
      const maxOrder = (columns ?? []).reduce((max, c) => Math.max(max, c.reihenfolge), -1)
      const { data: created, error: createError } = await supabase
        .from('todo_columns')
        .insert({ user_id: userId, titel: spalte, reihenfolge: maxOrder + 1 })
        .select('id, titel, reihenfolge')
        .single()
      if (createError || !created) return toolTextResult(`Fehler beim Anlegen der Spalte "${spalte}": ${createError?.message}`, true)
      column = created
    }
    const { data: last } = await supabase
      .from('todo_placements')
      .select('position')
      .eq('column_id', column.id)
      .order('position', { ascending: false })
      .limit(1)
    const position = last && last.length > 0 ? last[0].position + 1 : 0
    // Eigene Platzierung des Nutzers verschieben (nicht die anderer Personen auf
    // geteilten Karten - jede Person hat ein eigenes Board, siehe todo_placements).
    const { error: placementError } = await supabase
      .from('todo_placements')
      .upsert({ todo_id: todoId, user_id: userId, column_id: column.id, position }, { onConflict: 'todo_id,user_id' })
    if (placementError) return toolTextResult(`Fehler beim Verschieben auf die Spalte: ${placementError.message}`, true)
    spaltenHinweis = ` und in Spalte "${column.titel}" verschoben`
  }

  if (Object.keys(updates).length === 0 && !spalte) {
    return toolTextResult('Fehler: mindestens ein zu änderndes Feld (oder spalte) angeben.', true)
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase.from('todos').update(updates).eq('id', todoId)
    if (error) return toolTextResult(`Fehler beim Aktualisieren: ${error.message}`, true)
  }

  return toolTextResult(`ToDo aktualisiert${spaltenHinweis}.`)
}

async function createAntrag(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const titel = typeof args.titel === 'string' ? args.titel.trim() : ''
  if (!titel) return toolTextResult('Fehler: titel ist erforderlich.', true)
  const inhalt = typeof args.inhalt === 'string' && args.inhalt.trim() ? args.inhalt.trim() : null
  const sessionId = typeof args.session_id === 'string' && args.session_id.trim() ? args.session_id.trim() : null
  let ausschuss = typeof args.ausschuss === 'string' && args.ausschuss.trim() ? args.ausschuss.trim() : null
  let ebene = typeof args.ebene === 'string' && args.ebene.trim() ? args.ebene.trim() : null

  // Wie im "+ Antrag"-Formular der Web-App: ausschuss/ebene aus der Sitzung
  // übernehmen, sofern nicht explizit angegeben.
  if (sessionId && (!ausschuss || !ebene)) {
    const { data: session } = await supabase.from('sessions').select('gremium, ebene').eq('id', sessionId).maybeSingle()
    if (session) {
      ausschuss = ausschuss ?? (session.gremium as string | null)
      ebene = ebene ?? (session.ebene as string | null)
    }
  }

  const { data: antrag, error } = await supabase
    .from('antraege')
    .insert({ user_id: userId, titel, inhalt, session_id: sessionId, ausschuss, ebene })
    .select('id')
    .single()
  if (error || !antrag) return toolTextResult(`Fehler beim Anlegen des Antrags: ${error?.message}`, true)

  return toolTextResult(`Antrag "${titel}" wurde als Entwurf angelegt (id: ${antrag.id}).`)
}

const ANTRAG_STATUS_AKTIV = ['entwurf', 'gestellt', 'in_beratung', 'vertagt']

interface AntragListRow {
  id: string
  titel: string
  status: string
  ergebnis: string | null
  ausschuss: string | null
  ebene: string | null
  session_id: string | null
  eingereicht_am: string | null
  user_id: string
}

async function listAntraege(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const status = typeof args.status === 'string' && args.status ? args.status : 'aktiv'
  const ausschuss = typeof args.ausschuss === 'string' ? args.ausschuss.trim() : ''
  const limit = parseLimit(args.limit)

  const { data: shares } = await supabase.from('antrag_shares').select('antrag_id').eq('user_id', userId)
  const sharedIds = (shares ?? []).map((s) => s.antrag_id as string)

  const baseQuery = () => {
    let q = supabase
      .from('antraege')
      .select('id, titel, status, ergebnis, ausschuss, ebene, session_id, eingereicht_am, user_id')
    if (status === 'aktiv') q = q.in('status', ANTRAG_STATUS_AKTIV)
    else if (status !== 'alle') q = q.eq('status', status)
    if (ausschuss) q = q.ilike('ausschuss', `%${ausschuss}%`)
    return q
  }
  const [own, shared] = await Promise.all([
    baseQuery().eq('user_id', userId),
    sharedIds.length > 0 ? baseQuery().in('id', sharedIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (own.error) return toolTextResult(`Fehler beim Laden der Anträge: ${own.error.message}`, true)
  if (shared.error) return toolTextResult(`Fehler beim Laden der Anträge: ${shared.error.message}`, true)

  const byId = new Map<string, AntragListRow>()
  ;[...(own.data ?? []), ...(shared.data ?? [])].forEach((a) => byId.set(a.id, a as AntragListRow))
  const rows = Array.from(byId.values())
    .sort((a, b) => b.id.localeCompare(a.id))
    .slice(0, limit)

  if (rows.length === 0) return toolTextResult('Keine Anträge gefunden.')

  const lines = rows.map((a) => {
    const statusLabel =
      a.status === 'abgestimmt' && a.ergebnis ? `Abgestimmt · ${a.ergebnis === 'positiv' ? 'Positiv' : 'Negativ'}` : a.status
    const details: string[] = [statusLabel]
    if (a.ausschuss) details.push(a.ausschuss)
    if (a.eingereicht_am) details.push(`eingereicht ${formatDate(a.eingereicht_am)}`)
    if (a.user_id !== userId) details.push('geteilt')
    return `- ${a.titel} (${details.join(' · ')}) — id: ${a.id}`
  })
  return toolTextResult(lines.join('\n'))
}

/** Prüft, ob ein Antrag dem Nutzer gehört oder mit ihm geteilt ist. */
async function antragIstZugreifbar(
  supabase: SupabaseClient,
  userId: string,
  antragId: string,
): Promise<{ ok: boolean; titel?: string; status?: string }> {
  const { data: antrag } = await supabase.from('antraege').select('user_id, titel, status').eq('id', antragId).maybeSingle()
  if (!antrag) return { ok: false }
  if (antrag.user_id === userId) return { ok: true, titel: antrag.titel, status: antrag.status }
  const { data: share } = await supabase
    .from('antrag_shares')
    .select('id')
    .eq('antrag_id', antragId)
    .eq('user_id', userId)
    .maybeSingle()
  return share ? { ok: true, titel: antrag.titel, status: antrag.status } : { ok: false }
}

async function updateAntragStatus(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const antragId = typeof args.antrag_id === 'string' ? args.antrag_id.trim() : ''
  const status = typeof args.status === 'string' ? args.status.trim() : ''
  if (!antragId || !status) return toolTextResult('Fehler: antrag_id und status sind erforderlich.', true)
  const ergebnis = typeof args.ergebnis === 'string' && args.ergebnis ? args.ergebnis : null
  if (status === 'abgestimmt' && !ergebnis) {
    return toolTextResult('Fehler: bei status="abgestimmt" ist ergebnis ("positiv" oder "negativ") erforderlich.', true)
  }

  const { ok, titel, status: bisherigerStatus } = await antragIstZugreifbar(supabase, userId, antragId)
  if (!ok) return toolTextResult(`Antrag mit id ${antragId} wurde nicht gefunden (oder gehört nicht zu diesem Konto).`, true)

  // eingereicht_am nur beim Übergang auf "gestellt" automatisch auf heute setzen
  // (gleiche Logik wie AntragDetailModal.tsx), falls nicht explizit angegeben.
  const explizitesDatum = typeof args.eingereicht_am === 'string' && args.eingereicht_am.trim() ? args.eingereicht_am.trim() : null
  const wirdGestellt = status === 'gestellt' && bisherigerStatus !== 'gestellt'
  const eingereichtAm = explizitesDatum ?? (wirdGestellt ? new Date().toISOString().slice(0, 10) : undefined)

  const updates: Record<string, unknown> = { status, ergebnis: status === 'abgestimmt' ? ergebnis : null }
  if (eingereichtAm !== undefined) updates.eingereicht_am = eingereichtAm

  const { error } = await supabase.from('antraege').update(updates).eq('id', antragId)
  if (error) return toolTextResult(`Fehler beim Aktualisieren: ${error.message}`, true)

  return toolTextResult(`Antrag "${titel}" wurde auf Status "${status}" gesetzt.`)
}

async function listAntragFristen(supabase: SupabaseClient, userId: string) {
  const { data: antraege } = await supabase
    .from('antraege')
    .select('id, titel, status, ebene, session_id')
    .eq('user_id', userId)
    .in('status', ANTRAG_STATUS_AKTIV)
    .not('session_id', 'is', null)
    .not('ebene', 'is', null)
  if (!antraege || antraege.length === 0) return toolTextResult('Keine aktiven Anträge mit Sitzungsbezug gefunden.')

  const { data: fristen } = await supabase.from('antrag_deadline_settings').select('ebene, tage_vor_sitzung').eq('user_id', userId)
  const tageByEbene = new Map((fristen ?? []).map((f) => [f.ebene as string, f.tage_vor_sitzung as number]))

  const sessionIds = Array.from(new Set(antraege.map((a) => a.session_id as string)))
  const { data: sessions } = await supabase.from('sessions').select('id, titel, datum').in('id', sessionIds)
  const sessionById = new Map((sessions ?? []).map((s) => [s.id as string, s]))

  // Gleiche Formel wie computeAntragDeadline() in src/lib/antragDeadline.ts:
  // Sitzungsdatum minus die für die Ebene konfigurierte Vorlaufzeit.
  const zeilen = antraege
    .map((a) => {
      const tage = tageByEbene.get(a.ebene as string)
      const session = sessionById.get(a.session_id as string)
      if (tage === undefined || !session) return null
      const frist = new Date(session.datum as string)
      frist.setDate(frist.getDate() - tage)
      const ueberfaellig = a.status === 'entwurf' && frist.getTime() < Date.now()
      return { antrag: a, session, frist, ueberfaellig }
    })
    .filter((z): z is NonNullable<typeof z> => z !== null)
    .sort((a, b) => a.frist.getTime() - b.frist.getTime())

  if (zeilen.length === 0) {
    return toolTextResult(
      'Keine Frist berechenbar - dafür braucht jeder Antrag eine verknüpfte Sitzung, eine Ebene und eine passende Fristen-Einstellung unter Einstellungen -> Antrags-Fristen.',
    )
  }

  const lines = zeilen.map(
    (z) =>
      `- ${z.antrag.titel}: Frist ${formatDate(z.frist.toISOString().slice(0, 10))}${z.ueberfaellig ? ' [ÜBERFÄLLIG]' : ''} (Sitzung "${z.session.titel}" am ${formatDate((z.session.datum as string).slice(0, 10))}) — id: ${z.antrag.id}`,
  )
  return toolTextResult(lines.join('\n'))
}

async function search(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) return toolTextResult('Fehler: query ist erforderlich.', true)
  const limit = Math.min(Math.max(typeof args.limit === 'number' ? Math.floor(args.limit) : 10, 1), 50)
  const like = `%${query}%`

  const { data: placements } = await supabase.from('todo_placements').select('todo_id').eq('user_id', userId)
  const placedTodoIds = (placements ?? []).map((p) => p.todo_id as string)
  const { data: shares } = await supabase.from('antrag_shares').select('antrag_id').eq('user_id', userId)
  const sharedAntragIds = (shares ?? []).map((s) => s.antrag_id as string)

  // Bewusst KEIN .or('titel.ilike.X,beschreibung.ilike.Y') mit eingesetztem
  // Suchbegriff: Kommas/Klammern im Suchbegriff würden das PostgREST-Filterformat
  // brechen (gleiches Problem wie Gremiennamen in list_sessions/CalendarView.tsx) -
  // stattdessen je Spalte eine eigene Abfrage und in JS per Map mergen.
  const todoById = new Map<string, string>()
  const addTodos = (rows: { id: string; titel: string }[] | null) => (rows ?? []).forEach((t) => todoById.set(t.id, t.titel))
  addTodos((await supabase.from('todos').select('id, titel').eq('user_id', userId).ilike('titel', like).limit(limit)).data)
  addTodos((await supabase.from('todos').select('id, titel').eq('user_id', userId).ilike('beschreibung', like).limit(limit)).data)
  if (placedTodoIds.length > 0) {
    addTodos((await supabase.from('todos').select('id, titel').in('id', placedTodoIds).ilike('titel', like).limit(limit)).data)
    addTodos((await supabase.from('todos').select('id, titel').in('id', placedTodoIds).ilike('beschreibung', like).limit(limit)).data)
  }

  const antragById = new Map<string, string>()
  const addAntraege = (rows: { id: string; titel: string }[] | null) => (rows ?? []).forEach((a) => antragById.set(a.id, a.titel))
  addAntraege((await supabase.from('antraege').select('id, titel').eq('user_id', userId).ilike('titel', like).limit(limit)).data)
  addAntraege((await supabase.from('antraege').select('id, titel').eq('user_id', userId).ilike('inhalt', like).limit(limit)).data)
  if (sharedAntragIds.length > 0) {
    addAntraege((await supabase.from('antraege').select('id, titel').in('id', sharedAntragIds).ilike('titel', like).limit(limit)).data)
    addAntraege((await supabase.from('antraege').select('id, titel').in('id', sharedAntragIds).ilike('inhalt', like).limit(limit)).data)
  }

  interface NoteHit {
    id: string
    inhalt: string | null
    session_id: string | null
    event_id: string | null
    todo_id: string | null
    antrag_id: string | null
  }
  const noteById = new Map<string, NoteHit>()
  const addNotes = (rows: NoteHit[] | null) => (rows ?? []).forEach((n) => noteById.set(n.id, n))
  addNotes(
    (
      await supabase
        .from('summaries')
        .select('id, inhalt, session_id, event_id, todo_id, antrag_id')
        .eq('user_id', userId)
        .ilike('inhalt', like)
        .limit(limit)
    ).data,
  )
  if (placedTodoIds.length > 0) {
    addNotes(
      (
        await supabase
          .from('summaries')
          .select('id, inhalt, session_id, event_id, todo_id, antrag_id')
          .in('todo_id', placedTodoIds)
          .ilike('inhalt', like)
          .limit(limit)
      ).data,
    )
  }

  const abschnitte: string[] = []
  if (todoById.size > 0) {
    abschnitte.push(`ToDos:\n${Array.from(todoById.entries()).map(([id, titel]) => `- ${titel} — id: ${id}`).join('\n')}`)
  }
  if (antragById.size > 0) {
    abschnitte.push(`Anträge:\n${Array.from(antragById.entries()).map(([id, titel]) => `- ${titel} — id: ${id}`).join('\n')}`)
  }
  if (noteById.size > 0) {
    abschnitte.push(
      `Notizen:\n${Array.from(noteById.values())
        .map((n) => `- ${truncate(n.inhalt ?? '', 200)} — id des Ziels: ${n.session_id ?? n.event_id ?? n.todo_id ?? n.antrag_id}`)
        .join('\n')}`,
    )
  }

  if (abschnitte.length === 0) return toolTextResult(`Keine Treffer für "${query}".`)
  return toolTextResult(abschnitte.join('\n\n'))
}

interface NoteTargetConfig {
  /** Name des Arguments, das die UUID des Ziels trägt (session_id/event_id/todo_id/antrag_id). */
  idArgName: string
  /** Tabelle des Ziels. */
  table: 'sessions' | 'events' | 'todos' | 'antraege'
  /** Spalte in summaries, die auf das Ziel zeigt. */
  idColumn: 'session_id' | 'event_id' | 'todo_id' | 'antrag_id'
  /** events/todos/antraege gehören einem Nutzer (RLS events_select_own/
   *  todos_select_own_or_placed/antraege_select_own_or_shared) - Service-Role-Client umgeht RLS,
   *  daher hier manuell auf user_id prüfen. sessions gehören dagegen keinem einzelnen Nutzer und
   *  werden nicht ownership-geprüft (Sichtbarkeit hängt an der Kalenderquelle, siehe
   *  sessions_select_visible_source - hier bewusst nicht nachgebildet, da eine Notiz am fremden
   *  Sitzungs-Datensatz nur im eigenen summaries-Bestand landet). */
  ownerScoped: boolean
  /** Zusätzlicher Zugriffsweg neben user_id = userId (Teilen), z. B. todo_placements für ToDos
   *  oder antrag_shares für Anträge - Tabelle hat eine Spalte namens idColumn mit der Ziel-id und
   *  eine Spalte user_id. */
  sharedVia?: { table: string; idColumn: string }
  /** Für Fehlermeldungen/Bestätigungstext, z. B. "Sitzung", "Termin", "ToDo", "Antrag". */
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

  // Immer dieselbe, konstante Spaltenliste abfragen (nicht abhängig von
  // ownerScoped) - sessions hat z. B. gar keine user_id-Spalte, und ein
  // laufzeitabhängiger Select-String verwirrt außerdem supabase-js' Typinferenz.
  const { data: targetRow, error: targetError } = await supabase
    .from(target.table)
    .select('id, titel')
    .eq('id', targetId)
    .maybeSingle()
  if (targetError) return toolTextResult(`Fehler beim Prüfen (${target.label}): ${targetError.message}`, true)
  if (!targetRow) return toolTextResult(`${target.label} mit id ${targetId} wurde nicht gefunden.`, true)

  if (target.ownerScoped) {
    const { data: ownerRow } = await supabase.from(target.table).select('user_id').eq('id', targetId).maybeSingle()
    let erlaubt = ownerRow?.user_id === userId
    if (!erlaubt && target.sharedVia) {
      const { data: shareRow } = await supabase
        .from(target.sharedVia.table)
        .select('id')
        .eq(target.sharedVia.idColumn, targetId)
        .eq('user_id', userId)
        .maybeSingle()
      erlaubt = Boolean(shareRow)
    }
    if (!erlaubt) {
      return toolTextResult(`${target.label} mit id ${targetId} gehört nicht zu diesem Konto (auch nicht per Teilen).`, true)
    }
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
    sharedVia: { table: 'todo_placements', idColumn: 'todo_id' },
    label: 'ToDo',
  })
}

function createAntragNote(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  return createNote(supabase, userId, args, {
    idArgName: 'antrag_id',
    table: 'antraege',
    idColumn: 'antrag_id',
    ownerScoped: true,
    sharedVia: { table: 'antrag_shares', idColumn: 'antrag_id' },
    label: 'Antrag',
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
