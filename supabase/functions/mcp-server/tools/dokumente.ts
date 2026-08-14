import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { fileNameFromPath, formatDate, parseLimit, toolTextResult, uploadBase64File } from '../shared.ts'

const EBENEN = ['kommune', 'kreis', 'land', 'bund']

// Gleiche Labels wie EBENE_LABEL in src/lib/sourceColors.ts (Frontend) -
// bewusst dupliziert, kein gemeinsames Build-Tooling zwischen Deno und dem
// React-Frontend (siehe CLAUDE.md).
const EBENE_LABEL: Record<string, string> = {
  kommune: 'Kommune',
  kreis: 'Kreis',
  land: 'Land',
  bund: 'Bund',
}

/** gliederung wird NIE als Client-Parameter akzeptiert, sondern immer aus dem
 *  eigenen Profil des Aufrufers gelesen - sonst könnte sich jemand
 *  versehentlich oder absichtlich in die falsche Gliederung eintragen und ein
 *  geteiltes Dokument an die falschen Leute "leaken" oder unsichtbar machen
 *  (siehe RLS-Funktion current_user_gliederung_matches() in
 *  0033_dokumente.sql). */
function gliederungFeldFuer(ebene: string): 'gliederung_kommune' | 'gliederung_kreis' | 'gliederung_land' | null {
  if (ebene === 'kommune') return 'gliederung_kommune'
  if (ebene === 'kreis') return 'gliederung_kreis'
  if (ebene === 'land') return 'gliederung_land'
  return null
}

export async function createDocument(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const titel = typeof args.titel === 'string' ? args.titel.trim() : ''
  if (!titel) return toolTextResult('Fehler: titel ist erforderlich.', true)

  const sichtbarkeit = args.sichtbarkeit === 'geteilt' || args.sichtbarkeit === 'persoenlich' ? args.sichtbarkeit : ''
  if (!sichtbarkeit) return toolTextResult('Fehler: sichtbarkeit muss "persoenlich" oder "geteilt" sein.', true)

  const inhalt = typeof args.inhalt === 'string' && args.inhalt.trim() ? args.inhalt.trim() : null
  const dateiname = typeof args.dateiname === 'string' ? args.dateiname.trim() : ''
  const dateiBase64 = typeof args.datei_base64 === 'string' ? args.datei_base64.trim() : ''
  const dateiPfad = typeof args.datei_pfad === 'string' ? args.datei_pfad.trim() : ''
  const hasFile = Boolean((dateiname && dateiBase64) || dateiPfad)

  if (!inhalt && !hasFile) {
    return toolTextResult('Fehler: entweder inhalt, dateiname+datei_base64 oder datei_pfad sind erforderlich.', true)
  }
  if ((dateiname && !dateiBase64) || (!dateiname && dateiBase64)) {
    return toolTextResult('Fehler: dateiname und datei_base64 müssen zusammen angegeben werden.', true)
  }
  if (dateiPfad && (dateiname || dateiBase64)) {
    return toolTextResult('Fehler: datei_pfad kann nicht zusammen mit dateiname/datei_base64 angegeben werden.', true)
  }
  if (dateiPfad && !dateiPfad.startsWith(`${userId}/`)) {
    return toolTextResult('Fehler: datei_pfad gehört nicht zu diesem Konto.', true)
  }

  const tags = Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim()) : []

  let ebene: string | null = null
  let gliederung: string | null = null
  if (sichtbarkeit === 'geteilt') {
    ebene = typeof args.ebene === 'string' ? args.ebene.trim() : ''
    if (!EBENEN.includes(ebene)) {
      return toolTextResult(`Fehler: ebene muss eine von ${EBENEN.join('/')} sein (Pflicht bei sichtbarkeit="geteilt").`, true)
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('ebenen, gliederung_kommune, gliederung_kreis, gliederung_land')
      .eq('id', userId)
      .single()
    if (!profile || !(profile.ebenen as string[]).includes(ebene)) {
      return toolTextResult(
        `Fehler: du hast laut deinem Profil kein Mandat auf der Ebene "${EBENE_LABEL[ebene]}" - ein geteiltes Dokument kann nur für eine eigene Ebene angelegt werden (siehe Einstellungen -> Meine Gremien).`,
        true,
      )
    }
    const feld = gliederungFeldFuer(ebene)
    if (feld) {
      gliederung = (profile[feld] as string | null) ?? null
      if (!gliederung) {
        return toolTextResult(
          `Fehler: für die Ebene "${EBENE_LABEL[ebene]}" ist in deinem Profil keine Gliederung hinterlegt (siehe Einstellungen -> Meine Gremien) - ohne das kann kein geteiltes Dokument für diese Ebene angelegt werden.`,
          true,
        )
      }
    }
  }

  let dateiUrl: string | null = null
  if (dateiPfad) {
    dateiUrl = dateiPfad
  } else if (dateiname && dateiBase64) {
    const uploaded = await uploadBase64File(supabase, 'dokumente', userId, dateiname, dateiBase64)
    if (uploaded.error) return toolTextResult(uploaded.error, true)
    dateiUrl = uploaded.path!
  }

  const { data: dokument, error } = await supabase
    .from('dokumente')
    .insert({ user_id: userId, titel, sichtbarkeit, ebene, gliederung, tags, inhalt, datei_url: dateiUrl })
    .select('id')
    .single()
  if (error || !dokument) return toolTextResult(`Fehler beim Anlegen des Dokuments: ${error?.message}`, true)

  const sichtbarkeitsHinweis =
    sichtbarkeit === 'geteilt'
      ? `sichtbar für alle Mitglieder deiner Partei auf Ebene "${EBENE_LABEL[ebene!]}"${gliederung ? ` (${gliederung})` : ''}`
      : 'nur für dich sichtbar'
  return toolTextResult(`Dokument "${titel}" wurde im Dokumenten-Hub angelegt (id: ${dokument.id}), ${sichtbarkeitsHinweis}.`)
}

interface DokumentListRow {
  id: string
  titel: string
  sichtbarkeit: string
  ebene: string | null
  gliederung: string | null
  tags: string[]
  inhalt: string | null
  datei_url: string | null
  erstellt_am: string
  user_id: string
}

export async function listDocuments(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const sichtbarkeit = args.sichtbarkeit === 'persoenlich' || args.sichtbarkeit === 'geteilt' ? args.sichtbarkeit : 'alle'
  const ebene = typeof args.ebene === 'string' && args.ebene.trim() ? args.ebene.trim() : ''
  const tag = typeof args.tag === 'string' && args.tag.trim() ? args.tag.trim().toLowerCase() : ''
  const limit = parseLimit(args.limit)

  // RLS (dokumente_select_own/_shared) filtert automatisch auf eigene +
  // sichtbare geteilte Dokumente (gleiche Partei+Ebene+Gliederung) - kein
  // manuelles Partei/Ebene-Matching hier nötig.
  let query = supabase
    .from('dokumente')
    .select('id, titel, sichtbarkeit, ebene, gliederung, tags, inhalt, datei_url, erstellt_am, user_id')
    .order('erstellt_am', { ascending: false })
    .limit(limit)
  if (sichtbarkeit !== 'alle') query = query.eq('sichtbarkeit', sichtbarkeit)
  if (ebene) query = query.eq('ebene', ebene)

  const { data, error } = await query
  if (error) return toolTextResult(`Fehler beim Laden der Dokumente: ${error.message}`, true)

  let rows = (data ?? []) as DokumentListRow[]
  if (tag) rows = rows.filter((d) => d.tags.some((t) => t.toLowerCase().includes(tag)))

  if (rows.length === 0) return toolTextResult('Keine Dokumente gefunden.')

  const authorIds = Array.from(new Set(rows.filter((d) => d.user_id !== userId).map((d) => d.user_id)))
  const authorNameById = new Map<string, string>()
  if (authorIds.length > 0) {
    const { data: authors } = await supabase.from('profiles').select('id, name').in('id', authorIds)
    for (const a of authors ?? []) authorNameById.set(a.id as string, a.name as string)
  }

  const lines = rows.map((d) => {
    const teile = [`- "${d.titel}" (id: ${d.id})`]
    teile.push(d.sichtbarkeit === 'geteilt' ? `geteilt, ${EBENE_LABEL[d.ebene ?? ''] ?? d.ebene}${d.gliederung ? ` ${d.gliederung}` : ''}` : 'persönlich')
    if (d.sichtbarkeit === 'geteilt' && d.user_id !== userId) {
      teile.push(`von ${authorNameById.get(d.user_id) ?? 'unbekannt'}`)
    }
    if (d.tags.length > 0) teile.push(`Tags: ${d.tags.join(', ')}`)
    if (d.datei_url) teile.push(`Datei: ${fileNameFromPath(d.datei_url)}`)
    teile.push(formatDate(d.erstellt_am.slice(0, 10)))
    return teile.join(' · ')
  })
  return toolTextResult(lines.join('\n'))
}
