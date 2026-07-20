// Supabase Edge Function: ToDo-Karte mit einem Kollegen/einer Kollegin
// gleicher Partei+Ebene teilen (aufgerufen aus TodoDetailModal.tsx über
// supabase.functions.invoke).
//
// Warum eine Edge Function statt eines direkten Inserts vom Client aus:
// Um die Karte auf dem Board der Ziel-Person zu platzieren, muss deren
// passende todo_columns-Zeile (Spalte "Neu", sonst kleinste reihenfolge)
// gefunden werden - todo_columns_manage_own erlaubt aber nur den Zugriff auf
// die EIGENEN Spalten (siehe 0011_todo_board_ausbau.sql). Der Ersteller kann
// also client-seitig per RLS nicht die Spalten der Ziel-Person lesen. Diese
// Function läuft deshalb mit Service Role (bypasst RLS), analog zu
// admin-users/import-ics-source.
//
// Zugriffsschutz: Aufrufer-JWT wird verifiziert (echter Supabase-Auth-JWT,
// siehe supabase/config.toml - verify_jwt bleibt hier beim Default true).
// Serverseitig wird zusätzlich zur reinen Auth-Prüfung verifiziert, dass der
// Aufrufer Eigentümer der Karte ist und die Ziel-Person tatsächlich gleiche
// Partei + die auf der Karte gewählte Ebene hat - nicht nur der UI-Filter im
// Frontend.
//
// API (POST, JSON-Body):
//   { action: 'share', todo_id, target_user_id } -> { ok: true }
// "Unshare" (Freigabe entziehen) braucht keine Function - der Ersteller darf
// fremde todo_placements-Zeilen direkt per RLS löschen (todo_placements_delete
// in 0021_todo_erledigt_sharing.sql), das läuft direkt über den normalen
// Supabase-Client im Frontend.

import { createClient } from 'jsr:@supabase/supabase-js@2'

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

interface RequestBody {
  action?: string
  todo_id?: string
  target_user_id?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen serverseitig.' }, 500)
  }
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) {
    return jsonResponse({ error: 'Nicht angemeldet.' }, 401)
  }
  const {
    data: { user: caller },
    error: authError,
  } = await admin.auth.getUser(jwt)
  if (authError || !caller) {
    return jsonResponse({ error: 'Nicht angemeldet.' }, 401)
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ungültiger Request-Body (JSON erwartet).' }, 400)
  }

  if (body.action !== 'share') {
    return jsonResponse({ error: `Unbekannte action: ${body.action}` }, 400)
  }
  if (!body.todo_id || !body.target_user_id) {
    return jsonResponse({ error: 'todo_id und target_user_id sind erforderlich.' }, 400)
  }

  const { data: todo, error: todoError } = await admin
    .from('todos')
    .select('id, user_id, ebene')
    .eq('id', body.todo_id)
    .single()
  if (todoError || !todo) {
    return jsonResponse({ error: 'Karte nicht gefunden.' }, 404)
  }
  if (todo.user_id !== caller.id) {
    return jsonResponse({ error: 'Nur die Erstellerin/der Ersteller einer Karte darf sie teilen.' }, 403)
  }
  if (!todo.ebene) {
    return jsonResponse({ error: 'Bitte zuerst eine Ebene für diese Karte wählen.' }, 400)
  }

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('partei')
    .eq('id', caller.id)
    .single()
  const { data: targetProfile } = await admin
    .from('profiles')
    .select('id, partei, ebenen')
    .eq('id', body.target_user_id)
    .single()
  if (!targetProfile) {
    return jsonResponse({ error: 'Ziel-Nutzer nicht gefunden.' }, 404)
  }
  if (!callerProfile?.partei || targetProfile.partei !== callerProfile.partei) {
    return jsonResponse({ error: 'Teilen ist nur mit Kolleg*innen derselben Partei möglich.' }, 403)
  }
  if (!(targetProfile.ebenen ?? []).includes(todo.ebene)) {
    return jsonResponse({ error: 'Ziel-Nutzer hat kein Mandat auf der gewählten Ebene.' }, 403)
  }

  const { data: columns } = await admin
    .from('todo_columns')
    .select('id, titel, reihenfolge')
    .eq('user_id', body.target_user_id)
    .order('reihenfolge')
  const neuColumn = (columns ?? []).find((c) => c.titel.trim().toLowerCase() === 'neu') ?? (columns ?? [])[0]
  if (!neuColumn) {
    return jsonResponse({ error: 'Ziel-Nutzer hat kein ToDo-Board (keine Spalten).' }, 500)
  }

  const { data: last } = await admin
    .from('todo_placements')
    .select('position')
    .eq('column_id', neuColumn.id)
    .order('position', { ascending: false })
    .limit(1)
  const position = last && last.length > 0 ? last[0].position + 1 : 0

  const { error: placementError } = await admin
    .from('todo_placements')
    .upsert(
      { todo_id: body.todo_id, user_id: body.target_user_id, column_id: neuColumn.id, position },
      { onConflict: 'todo_id,user_id' },
    )
  if (placementError) {
    return jsonResponse({ error: placementError.message }, 500)
  }

  return jsonResponse({ ok: true })
})
