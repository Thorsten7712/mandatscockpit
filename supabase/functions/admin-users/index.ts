// Supabase Edge Function: Benutzerverwaltung für Admins.
// Wird von der "Benutzerverwaltung"-Sektion in src/pages/Settings.tsx
// aufgerufen (supabase.functions.invoke, Komponente
// src/components/UserManagement.tsx).
//
// Benutzer anlegen/ändern/löschen geht nur über die Auth-Admin-API mit dem
// SUPABASE_SERVICE_ROLE_KEY - der bleibt serverseitig (Edge Functions
// bekommen ihn automatisch injiziert, siehe import-ics-source).
//
// Zugriffsschutz: Der Aufrufer-JWT (Authorization-Header) wird verifiziert
// und die Rolle in profiles muss 'admin' sein. RLS greift hier nicht (die
// Function läuft mit Service Role), deshalb ist dieser Check Pflicht.
//
// API (POST, JSON-Body mit action):
//   { action: 'list' }
//     -> { users: [{ id, email, name, rolle, fraktion, partei, created_at, last_sign_in_at }] }
//   { action: 'create', email, password, name, rolle? }
//     -> { user: {...} }  (Profil legt der handle_new_user-Trigger an,
//        rolle wird danach gesetzt; email_confirm: true, damit keine
//        Bestätigungsmail nötig ist - der Admin teilt das Startpasswort mit;
//        muss_passwort_aendern ist per Spalten-Default bereits true)
//   { action: 'update', user_id, name?, rolle?, fraktion?, partei?, email?, password? }
//     -> { ok: true }  (wird password gesetzt, erzwingt das wie bei der
//        Neuanlage einen Passwortwechsel beim nächsten Login -
//        muss_passwort_aendern wird auf true zurückgesetzt)
//   { action: 'delete', user_id }
//     -> { ok: true }  (bereinigt vorher calendar_sources.verwaltet_von und
//        events.erstellt_von, die NICHT on delete cascade sind, sowie die
//        Storage-Dateien des Nutzers; alles andere cascaded über profiles)

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

const ROLLEN = ['mitglied', 'fraktionsbuero', 'admin']

interface RequestBody {
  action?: string
  user_id?: string
  email?: string
  password?: string
  name?: string
  rolle?: string
  fraktion?: string | null
  partei?: string | null
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

  // Aufrufer verifizieren: JWT aus dem Authorization-Header prüfen und
  // Admin-Rolle im Profil verlangen.
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
  const { data: callerProfile } = await admin
    .from('profiles')
    .select('rolle')
    .eq('id', caller.id)
    .single()
  if (callerProfile?.rolle !== 'admin') {
    return jsonResponse({ error: 'Nur Admins dürfen die Benutzerverwaltung nutzen.' }, 403)
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ungültiger Request-Body (JSON erwartet).' }, 400)
  }

  switch (body.action) {
    case 'list': {
      // Free-Tier-Größenordnung: eine Seite mit 200 reicht für einen Stadtrat
      // locker; bei mehr Nutzern müsste hier paginiert werden.
      const { data: authUsers, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
      if (error) return jsonResponse({ error: error.message }, 500)
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, name, rolle, fraktion, partei')
      const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))
      const users = authUsers.users
        .map((u) => {
          const p = profileById.get(u.id)
          return {
            id: u.id,
            email: u.email ?? '',
            name: p?.name ?? u.email ?? '',
            rolle: p?.rolle ?? 'mitglied',
            fraktion: p?.fraktion ?? null,
            partei: p?.partei ?? null,
            created_at: u.created_at,
            last_sign_in_at: u.last_sign_in_at ?? null,
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'de'))
      return jsonResponse({ users })
    }

    case 'create': {
      if (!body.email || !body.password || !body.name) {
        return jsonResponse({ error: 'email, password und name sind erforderlich.' }, 400)
      }
      const rolle = body.rolle ?? 'mitglied'
      if (!ROLLEN.includes(rolle)) {
        return jsonResponse({ error: `Ungültige Rolle: ${rolle}` }, 400)
      }
      const { data: created, error } = await admin.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true,
        user_metadata: { name: body.name },
      })
      if (error || !created.user) {
        return jsonResponse({ error: error?.message ?? 'Anlegen fehlgeschlagen.' }, 500)
      }
      // Der handle_new_user-Trigger hat das Profil (rolle 'mitglied') samt
      // Standard-Board-Spalten angelegt - Rolle/Fraktion/Partei nachziehen.
      const { error: profileError } = await admin
        .from('profiles')
        .update({ rolle, fraktion: body.fraktion ?? null, partei: body.partei ?? null })
        .eq('id', created.user.id)
      if (profileError) {
        return jsonResponse({ error: `Nutzer angelegt, aber Profil-Update fehlgeschlagen: ${profileError.message}` }, 500)
      }
      return jsonResponse({ user: { id: created.user.id, email: created.user.email } })
    }

    case 'update': {
      if (!body.user_id) return jsonResponse({ error: 'user_id fehlt.' }, 400)
      if (body.rolle && !ROLLEN.includes(body.rolle)) {
        return jsonResponse({ error: `Ungültige Rolle: ${body.rolle}` }, 400)
      }
      // Der letzte Admin darf sich nicht selbst degradieren, sonst sperrt
      // sich die Benutzerverwaltung dauerhaft aus.
      if (body.user_id === caller.id && body.rolle && body.rolle !== 'admin') {
        const { count } = await admin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('rolle', 'admin')
        if ((count ?? 0) <= 1) {
          return jsonResponse({ error: 'Du bist der letzte Admin und kannst dir die Admin-Rolle nicht selbst entziehen.' }, 400)
        }
      }

      const profileUpdate: Record<string, unknown> = {}
      if (body.name !== undefined) profileUpdate.name = body.name
      if (body.rolle !== undefined) profileUpdate.rolle = body.rolle
      if (body.fraktion !== undefined) profileUpdate.fraktion = body.fraktion || null
      if (body.partei !== undefined) profileUpdate.partei = body.partei || null
      if (Object.keys(profileUpdate).length > 0) {
        const { error } = await admin.from('profiles').update(profileUpdate).eq('id', body.user_id)
        if (error) return jsonResponse({ error: error.message }, 500)
      }

      const authUpdate: { email?: string; password?: string; email_confirm?: boolean } = {}
      if (body.email) {
        authUpdate.email = body.email
        authUpdate.email_confirm = true
      }
      if (body.password) {
        authUpdate.password = body.password
        // Ein Admin-Reset zählt wie ein Start-Passwort bei der Neuanlage -
        // der Nutzer muss es beim nächsten Login zwingend ändern.
        await admin.from('profiles').update({ muss_passwort_aendern: true }).eq('id', body.user_id)
      }
      if (Object.keys(authUpdate).length > 0) {
        const { error } = await admin.auth.admin.updateUserById(body.user_id, authUpdate)
        if (error) return jsonResponse({ error: error.message }, 500)
      }
      return jsonResponse({ ok: true })
    }

    case 'delete': {
      if (!body.user_id) return jsonResponse({ error: 'user_id fehlt.' }, 400)
      if (body.user_id === caller.id) {
        return jsonResponse({ error: 'Du kannst dich nicht selbst löschen.' }, 400)
      }

      // Referenzen ohne on delete cascade bereinigen, sonst schlägt das
      // Löschen mit FK-Fehler fehl:
      // - calendar_sources.verwaltet_von -> null (= gemeinsam verwaltet)
      // - events.erstellt_von (not null): Fraktionsbüro-Termine für andere
      //   Mitglieder gehören weiter dem Mitglied -> erstellt_von auf den
      //   Termininhaber umbiegen. Eigene Termine cascaden über user_id.
      await admin.from('calendar_sources').update({ verwaltet_von: null }).eq('verwaltet_von', body.user_id)
      const { data: fremdeEvents } = await admin
        .from('events')
        .select('id, user_id')
        .eq('erstellt_von', body.user_id)
        .neq('user_id', body.user_id)
      for (const ev of fremdeEvents ?? []) {
        await admin.from('events').update({ erstellt_von: ev.user_id }).eq('id', ev.id)
      }

      // Storage-Dateien des Nutzers entfernen (liegen unter <user_id>/...,
      // würden sonst verwaist im Bucket bleiben).
      for (const bucket of ['profilbilder', 'zusammenfassungen']) {
        const { data: files } = await admin.storage.from(bucket).list(body.user_id)
        if (files && files.length > 0) {
          await admin.storage.from(bucket).remove(files.map((f) => `${body.user_id}/${f.name}`))
        }
      }

      const { error } = await admin.auth.admin.deleteUser(body.user_id)
      if (error) return jsonResponse({ error: error.message }, 500)
      return jsonResponse({ ok: true })
    }

    default:
      return jsonResponse({ error: `Unbekannte action: ${body.action}` }, 400)
  }
})
