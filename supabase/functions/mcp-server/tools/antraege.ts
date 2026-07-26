import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { formatDate, parseLimit, toolTextResult } from '../shared.ts'

export async function createAntrag(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
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

export const ANTRAG_STATUS_AKTIV = ['entwurf', 'gestellt', 'in_beratung', 'vertagt']

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

export async function listAntraege(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
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
export async function antragIstZugreifbar(
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

export async function updateAntragStatus(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
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

export async function listAntragFristen(supabase: SupabaseClient, userId: string) {
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
