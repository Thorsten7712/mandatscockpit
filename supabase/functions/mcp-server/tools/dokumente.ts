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

interface CallerProfile {
  partei: string | null
  ebenen: string[]
  gliederung_kommune: string | null
  gliederung_kreis: string | null
  gliederung_land: string | null
}

/** gliederung wird NIE als Client-Parameter akzeptiert, sondern immer aus dem
 *  eigenen Profil des Aufrufers (bzw. beim Anhängen an ein Dokument aus
 *  dessen Elternteil) übernommen - sonst könnte sich jemand versehentlich
 *  oder absichtlich in die falsche Gliederung eintragen und ein geteiltes
 *  Dokument an die falschen Leute "leaken" oder unsichtbar machen. */
function gliederungFeldFuer(ebene: string): 'gliederung_kommune' | 'gliederung_kreis' | 'gliederung_land' | null {
  if (ebene === 'kommune') return 'gliederung_kommune'
  if (ebene === 'kreis') return 'gliederung_kreis'
  if (ebene === 'land') return 'gliederung_land'
  return null
}

function gliederungVonProfil(profile: CallerProfile, ebene: string): string | null {
  const feld = gliederungFeldFuer(ebene)
  return feld ? profile[feld] : null
}

/** Der MCP-Server läuft komplett über den Service-Role-Client (siehe
 *  index.ts) - Postgres-RLS wird dadurch für JEDE Abfrage umgangen, die
 *  Sichtbarkeitsprüfung muss deshalb explizit im Tool-Code passieren (gleiches
 *  Muster wie list_antraege/list_todos: eigene Zeilen + manuell aufgelöste
 *  Freigaben, niemals ein "RLS filtert das schon"-Trugschluss). Prüft, ob
 *  `caller` ein Dokument von `uploaderPartei` mit `sichtbarkeit`/`ebene`/
 *  `gliederung` sehen darf. */
function darfSehen(
  caller: CallerProfile,
  callerUserId: string,
  doc: { user_id: string; sichtbarkeit: string; ebene: string | null; gliederung: string | null },
  uploaderPartei: string | null,
  istPerDokumentShareFreigegeben: boolean,
): boolean {
  if (doc.user_id === callerUserId) return true
  if (doc.sichtbarkeit === 'geteilt') {
    if (!doc.ebene || !uploaderPartei || uploaderPartei !== caller.partei) return false
    if (!caller.ebenen.includes(doc.ebene)) return false
    if (doc.ebene === 'bund') return true
    return Boolean(doc.gliederung) && doc.gliederung === gliederungVonProfil(caller, doc.ebene)
  }
  if (doc.sichtbarkeit === 'einzelpersonen') return istPerDokumentShareFreigegeben
  return false // 'persoenlich' und fremd
}

async function loadCallerProfile(supabase: SupabaseClient, userId: string): Promise<CallerProfile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('partei, ebenen, gliederung_kommune, gliederung_kreis, gliederung_land')
    .eq('id', userId)
    .single()
  return (data as CallerProfile) ?? null
}

/** Namen gegen für den Aufrufer sichtbare Profile auflösen (RLS auf profiles
 *  begrenzt die Treffer ohnehin auf Partei-/Ebene-Kolleg*innen) - genutzt von
 *  createDocument (Notiz mit sichtbarkeit="einzelpersonen" anlegen) UND
 *  updateDocumentSharing (nachträglich teilen). Nicht gefundene Namen brechen
 *  den Aufruf nicht ab, sondern werden nur zurückgemeldet. */
async function resolveTeilenMitNamen(
  supabase: SupabaseClient,
  userId: string,
  caller: CallerProfile,
  namen: string[],
): Promise<{ ids: string[]; unaufgeloest: string[] }> {
  const ids: string[] = []
  const unaufgeloest: string[] = []
  for (const name of namen) {
    const { data: matches } = await supabase
      .from('profiles')
      .select('id, name, partei, ebenen')
      .ilike('name', `%${name}%`)
      .neq('id', userId)
    const treffer = (matches ?? []).find((p) => p.partei === caller.partei && (p.ebenen as string[]).some((e) => caller.ebenen.includes(e)))
    if (treffer) ids.push(treffer.id as string)
    else unaufgeloest.push(name)
  }
  return { ids, unaufgeloest }
}

export async function createDocument(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const titel = typeof args.titel === 'string' ? args.titel.trim() : ''
  if (!titel) return toolTextResult('Fehler: titel ist erforderlich.', true)

  const sichtbarkeit =
    args.sichtbarkeit === 'geteilt' || args.sichtbarkeit === 'persoenlich' || args.sichtbarkeit === 'einzelpersonen'
      ? args.sichtbarkeit
      : ''
  if (!sichtbarkeit) return toolTextResult('Fehler: sichtbarkeit muss "persoenlich", "geteilt" oder "einzelpersonen" sein.', true)

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

  const tags = Array.isArray(args.tags)
    ? args.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim())
    : []

  const parentId = typeof args.parent_id === 'string' && args.parent_id.trim() ? args.parent_id.trim() : null
  let parent: { user_id: string; sichtbarkeit: string; ebene: string | null; gliederung: string | null } | null = null
  const caller = await loadCallerProfile(supabase, userId)
  if (!caller) return toolTextResult('Fehler: eigenes Profil konnte nicht geladen werden.', true)

  if (parentId) {
    const { data: parentRow } = await supabase
      .from('dokumente')
      .select('user_id, sichtbarkeit, ebene, gliederung')
      .eq('id', parentId)
      .maybeSingle()
    if (!parentRow) return toolTextResult(`Fehler: Dokument ${parentId} (parent_id) wurde nicht gefunden.`, true)
    const uploaderPartei =
      parentRow.user_id === userId
        ? caller.partei
        : ((await supabase.from('profiles').select('partei').eq('id', parentRow.user_id).maybeSingle()).data?.partei ?? null)
    let freigegeben = false
    if (parentRow.sichtbarkeit === 'einzelpersonen') {
      freigegeben = Boolean(
        (await supabase.from('dokument_shares').select('id').eq('dokument_id', parentId).eq('user_id', userId).maybeSingle()).data,
      )
    }
    if (!darfSehen(caller, userId, parentRow, uploaderPartei, freigegeben)) {
      return toolTextResult(`Fehler: Dokument ${parentId} (parent_id) gehört nicht zu deinem sichtbaren Bestand.`, true)
    }
    parent = parentRow
  }

  let ebene: string | null = null
  let gliederung: string | null = null
  if (sichtbarkeit === 'geteilt') {
    if (parent) {
      // Kind eines bestehenden Dokuments: Ebene/Gliederung 1:1 vom
      // Elternteil übernehmen, damit die bestehende dokumente_select_shared-
      // Policy (Ebene-weite Sichtbarkeit) unverändert funktioniert.
      if (!parent.ebene) {
        return toolTextResult('Fehler: das übergeordnete Dokument ist nicht Ebene-weit geteilt - sichtbarkeit="geteilt" ist für ein daran angehängtes Dokument deshalb nicht möglich (persoenlich oder einzelpersonen verwenden).', true)
      }
      ebene = parent.ebene
      gliederung = parent.gliederung
    } else {
      ebene = typeof args.ebene === 'string' ? args.ebene.trim() : ''
      if (!EBENEN.includes(ebene)) {
        return toolTextResult(`Fehler: ebene muss eine von ${EBENEN.join('/')} sein (Pflicht bei sichtbarkeit="geteilt" ohne parent_id).`, true)
      }
      if (!caller.ebenen.includes(ebene)) {
        return toolTextResult(
          `Fehler: du hast laut deinem Profil kein Mandat auf der Ebene "${EBENE_LABEL[ebene]}" - ein geteiltes Dokument kann nur für eine eigene Ebene angelegt werden (siehe Einstellungen -> Meine Gremien).`,
          true,
        )
      }
      gliederung = gliederungVonProfil(caller, ebene)
      if (gliederungFeldFuer(ebene) && !gliederung) {
        return toolTextResult(
          `Fehler: für die Ebene "${EBENE_LABEL[ebene]}" ist in deinem Profil keine Gliederung hinterlegt (siehe Einstellungen -> Meine Gremien) - ohne das kann kein geteiltes Dokument für diese Ebene angelegt werden.`,
          true,
        )
      }
    }
  }

  // Namen der Personen, mit denen individuell geteilt werden soll, gegen für
  // den Aufrufer sichtbare Profile auflösen (RLS auf profiles begrenzt die
  // Treffer ohnehin auf Partei-/Ebene-Kolleg*innen) - nicht gefundene Namen
  // brechen den Aufruf nicht ab, sondern werden nur im Hinweistext genannt.
  let teilenMitUserIds: string[] = []
  let unaufgeloesteNamen: string[] = []
  if (sichtbarkeit === 'einzelpersonen') {
    const namen = Array.isArray(args.teilen_mit_namen)
      ? args.teilen_mit_namen.filter((n): n is string => typeof n === 'string' && n.trim() !== '').map((n) => n.trim())
      : []
    if (namen.length === 0) {
      return toolTextResult('Fehler: teilen_mit_namen ist erforderlich (mindestens ein Name) bei sichtbarkeit="einzelpersonen".', true)
    }
    const resolved = await resolveTeilenMitNamen(supabase, userId, caller, namen)
    teilenMitUserIds = resolved.ids
    unaufgeloesteNamen = resolved.unaufgeloest
    if (teilenMitUserIds.length === 0) {
      return toolTextResult(`Fehler: keiner der angegebenen Namen (${namen.join(', ')}) konnte einer Partei-/Ebenen-Kolleg*in zugeordnet werden.`, true)
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
    .insert({ user_id: userId, parent_id: parentId, titel, sichtbarkeit, ebene, gliederung, tags, inhalt, datei_url: dateiUrl })
    .select('id')
    .single()
  if (error || !dokument) return toolTextResult(`Fehler beim Anlegen des Dokuments: ${error?.message}`, true)

  if (teilenMitUserIds.length > 0) {
    const { error: shareError } = await supabase
      .from('dokument_shares')
      .insert(teilenMitUserIds.map((uid) => ({ dokument_id: dokument.id, user_id: uid })))
    if (shareError) return toolTextResult(`Dokument wurde angelegt, aber Freigabe schlug fehl: ${shareError.message}`, true)
  }

  let sichtbarkeitsHinweis: string
  if (sichtbarkeit === 'geteilt') {
    sichtbarkeitsHinweis = `sichtbar für alle Mitglieder deiner Partei auf Ebene "${EBENE_LABEL[ebene!]}"${gliederung ? ` (${gliederung})` : ''}`
  } else if (sichtbarkeit === 'einzelpersonen') {
    sichtbarkeitsHinweis = `geteilt mit ${teilenMitUserIds.length} Person(en)${unaufgeloesteNamen.length > 0 ? ` - nicht gefunden: ${unaufgeloesteNamen.join(', ')}` : ''}`
  } else {
    sichtbarkeitsHinweis = 'nur für dich sichtbar'
  }
  return toolTextResult(`Dokument "${titel}" wurde${parent ? ' an das übergeordnete Dokument angehängt' : ' im Dokumenten-Hub angelegt'} (id: ${dokument.id}), ${sichtbarkeitsHinweis}.`)
}

interface DokumentListRow {
  id: string
  parent_id: string | null
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
  const sichtbarkeitFilter =
    args.sichtbarkeit === 'persoenlich' || args.sichtbarkeit === 'geteilt' || args.sichtbarkeit === 'einzelpersonen'
      ? args.sichtbarkeit
      : 'alle'
  const ebeneFilter = typeof args.ebene === 'string' && args.ebene.trim() ? args.ebene.trim() : ''
  const tag = typeof args.tag === 'string' && args.tag.trim() ? args.tag.trim().toLowerCase() : ''
  // Ohne parent_id: nur Top-Level-Dokumente (parent_id is null), analog zur
  // Web-UI (Dokumente.tsx) - mit parent_id: gezielt die an ein Dokument
  // angehängten Notizen/Analysen.
  const parentIdFilter = typeof args.parent_id === 'string' && args.parent_id.trim() ? args.parent_id.trim() : null
  const limit = parseLimit(args.limit)

  const caller = await loadCallerProfile(supabase, userId)
  if (!caller) return toolTextResult('Fehler: eigenes Profil konnte nicht geladen werden.', true)

  const cols = 'id, parent_id, titel, sichtbarkeit, ebene, gliederung, tags, inhalt, datei_url, erstellt_am, user_id'
  let baseQuery = supabase.from('dokumente').select(cols)
  baseQuery = parentIdFilter ? baseQuery.eq('parent_id', parentIdFilter) : baseQuery.is('parent_id', null)

  // Eigene Zeilen + potenziell sichtbare geteilte/einzelpersonen-Zeilen laden
  // (Filterung auf "wirklich sichtbar" passiert unten in JS, siehe darfSehen() -
  // der Service-Role-Client umgeht RLS, das muss also hier nachgebaut werden).
  const [ownRows, geteiltRows, shareRows] = await Promise.all([
    baseQuery.eq('user_id', userId),
    caller.ebenen.length > 0
      ? supabase.from('dokumente').select(cols).eq('sichtbarkeit', 'geteilt').in('ebene', caller.ebenen).then((r) => {
          const rows = (r.data ?? []) as DokumentListRow[]
          return { data: parentIdFilter ? rows.filter((d) => d.parent_id === parentIdFilter) : rows.filter((d) => !d.parent_id) }
        })
      : Promise.resolve({ data: [] as DokumentListRow[] }),
    supabase.from('dokument_shares').select('dokument_id').eq('user_id', userId),
  ])

  const sharedDokIds = (shareRows.data ?? []).map((s) => s.dokument_id as string)
  const { data: einzelRows } =
    sharedDokIds.length > 0
      ? await (parentIdFilter
          ? supabase.from('dokumente').select(cols).in('id', sharedDokIds).eq('parent_id', parentIdFilter)
          : supabase.from('dokumente').select(cols).in('id', sharedDokIds).is('parent_id', null))
      : { data: [] as DokumentListRow[] }

  const byId = new Map<string, DokumentListRow>()
  for (const row of [...((ownRows.data ?? []) as DokumentListRow[]), ...((geteiltRows.data ?? []) as DokumentListRow[]), ...((einzelRows ?? []) as DokumentListRow[])]) {
    byId.set(row.id, row)
  }

  const uploaderIds = Array.from(new Set(Array.from(byId.values()).filter((d) => d.user_id !== userId).map((d) => d.user_id)))
  const uploaderPartei = new Map<string, string | null>()
  if (uploaderIds.length > 0) {
    const { data: uploaders } = await supabase.from('profiles').select('id, partei').in('id', uploaderIds)
    for (const u of uploaders ?? []) uploaderPartei.set(u.id as string, u.partei as string | null)
  }
  const sharedDokIdSet = new Set(sharedDokIds)

  let rows = Array.from(byId.values()).filter((d) =>
    darfSehen(caller, userId, d, d.user_id === userId ? caller.partei : uploaderPartei.get(d.user_id) ?? null, sharedDokIdSet.has(d.id)),
  )
  if (sichtbarkeitFilter !== 'alle') rows = rows.filter((d) => d.sichtbarkeit === sichtbarkeitFilter)
  if (ebeneFilter) rows = rows.filter((d) => d.ebene === ebeneFilter)
  if (tag) rows = rows.filter((d) => d.tags.some((t) => t.toLowerCase().includes(tag)))

  rows.sort((a, b) => b.erstellt_am.localeCompare(a.erstellt_am))
  rows = rows.slice(0, limit)

  if (rows.length === 0) return toolTextResult('Keine Dokumente gefunden.')

  const authorNameById = new Map<string, string>()
  const fremdeAutorIds = rows.filter((d) => d.user_id !== userId).map((d) => d.user_id)
  if (fremdeAutorIds.length > 0) {
    const { data: authors } = await supabase.from('profiles').select('id, name').in('id', Array.from(new Set(fremdeAutorIds)))
    for (const a of authors ?? []) authorNameById.set(a.id as string, a.name as string)
  }

  const lines = rows.map((d) => {
    const teile = [`- "${d.titel}" (id: ${d.id})`]
    if (d.sichtbarkeit === 'geteilt') {
      teile.push(`geteilt, ${EBENE_LABEL[d.ebene ?? ''] ?? d.ebene}${d.gliederung ? ` ${d.gliederung}` : ''}`)
    } else if (d.sichtbarkeit === 'einzelpersonen') {
      teile.push('mit einzelnen Personen geteilt')
    } else {
      teile.push('persönlich')
    }
    if (d.user_id !== userId) teile.push(`von ${authorNameById.get(d.user_id) ?? 'unbekannt'}`)
    if (d.tags.length > 0) teile.push(`Tags: ${d.tags.join(', ')}`)
    if (d.datei_url) teile.push(`Datei: ${fileNameFromPath(d.datei_url)}`)
    teile.push(formatDate(d.erstellt_am.slice(0, 10)))
    return teile.join(' · ')
  })
  return toolTextResult(lines.join('\n'))
}

export async function updateDocumentTags(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const dokumentId = typeof args.dokument_id === 'string' ? args.dokument_id.trim() : ''
  if (!dokumentId) return toolTextResult('Fehler: dokument_id ist erforderlich.', true)
  if (!Array.isArray(args.tags)) {
    return toolTextResult('Fehler: tags muss ein Array von Strings sein (leeres Array entfernt alle Tags).', true)
  }
  const tags = args.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim())

  const { data: dok } = await supabase.from('dokumente').select('id, user_id, titel').eq('id', dokumentId).maybeSingle()
  if (!dok) return toolTextResult(`Fehler: Dokument ${dokumentId} wurde nicht gefunden.`, true)
  if (dok.user_id !== userId) return toolTextResult('Fehler: nur der/die Ersteller*in eines Dokuments darf dessen Tags ändern.', true)

  const { error } = await supabase.from('dokumente').update({ tags }).eq('id', dokumentId)
  if (error) return toolTextResult(`Fehler beim Aktualisieren der Tags: ${error.message}`, true)

  return toolTextResult(`Tags von "${dok.titel}" wurden aktualisiert: ${tags.length > 0 ? tags.join(', ') : '(keine)'}.`)
}

export async function updateDocumentSharing(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const dokumentId = typeof args.dokument_id === 'string' ? args.dokument_id.trim() : ''
  if (!dokumentId) return toolTextResult('Fehler: dokument_id ist erforderlich.', true)

  const sichtbarkeit =
    args.sichtbarkeit === 'geteilt' || args.sichtbarkeit === 'persoenlich' || args.sichtbarkeit === 'einzelpersonen'
      ? args.sichtbarkeit
      : ''
  if (!sichtbarkeit) return toolTextResult('Fehler: sichtbarkeit muss "persoenlich", "geteilt" oder "einzelpersonen" sein.', true)

  const { data: dok } = await supabase
    .from('dokumente')
    .select('id, user_id, titel, parent_id, ebene, gliederung')
    .eq('id', dokumentId)
    .maybeSingle()
  if (!dok) return toolTextResult(`Fehler: Dokument ${dokumentId} wurde nicht gefunden.`, true)
  if (dok.user_id !== userId) return toolTextResult('Fehler: nur der/die Ersteller*in eines Dokuments darf dessen Freigabe ändern.', true)

  const caller = await loadCallerProfile(supabase, userId)
  if (!caller) return toolTextResult('Fehler: eigenes Profil konnte nicht geladen werden.', true)

  // ebene/gliederung wie beim Anlegen (createDocument): bei "geteilt" für ein
  // an ein anderes Dokument angehängtes Dokument 1:1 vom Elternteil
  // übernehmen; für ein Top-Level-Dokument (kein parent_id) bleiben sie
  // unverändert (Top-Level-Dokumente werden bereits "geteilt" angelegt, siehe
  // Dokumente.tsx). Bei persoenlich/einzelpersonen werden beide genullt.
  let ebene: string | null = dok.ebene
  let gliederung: string | null = dok.gliederung
  if (sichtbarkeit === 'geteilt') {
    if (dok.parent_id) {
      const { data: parent } = await supabase.from('dokumente').select('ebene, gliederung').eq('id', dok.parent_id).maybeSingle()
      if (!parent?.ebene) {
        return toolTextResult('Fehler: das übergeordnete Dokument ist nicht Ebene-weit geteilt - sichtbarkeit="geteilt" ist für ein daran angehängtes Dokument deshalb nicht möglich (persoenlich oder einzelpersonen verwenden).', true)
      }
      ebene = parent.ebene
      gliederung = parent.gliederung
    }
  } else {
    ebene = null
    gliederung = null
  }

  let teilenMitUserIds: string[] = []
  let unaufgeloesteNamen: string[] = []
  if (sichtbarkeit === 'einzelpersonen') {
    const namen = Array.isArray(args.teilen_mit_namen)
      ? args.teilen_mit_namen.filter((n): n is string => typeof n === 'string' && n.trim() !== '').map((n) => n.trim())
      : []
    if (namen.length === 0) {
      return toolTextResult('Fehler: teilen_mit_namen ist erforderlich (mindestens ein Name) bei sichtbarkeit="einzelpersonen".', true)
    }
    const resolved = await resolveTeilenMitNamen(supabase, userId, caller, namen)
    teilenMitUserIds = resolved.ids
    unaufgeloesteNamen = resolved.unaufgeloest
    if (teilenMitUserIds.length === 0) {
      return toolTextResult(`Fehler: keiner der angegebenen Namen (${namen.join(', ')}) konnte einer Partei-/Ebenen-Kolleg*in zugeordnet werden.`, true)
    }
  }

  const { error: updateError } = await supabase.from('dokumente').update({ sichtbarkeit, ebene, gliederung }).eq('id', dokumentId)
  if (updateError) return toolTextResult(`Fehler beim Aktualisieren der Sichtbarkeit: ${updateError.message}`, true)

  const { error: deleteError } = await supabase.from('dokument_shares').delete().eq('dokument_id', dokumentId)
  if (deleteError) return toolTextResult(`Sichtbarkeit wurde geändert, aber alte Freigaben konnten nicht entfernt werden: ${deleteError.message}`, true)

  if (teilenMitUserIds.length > 0) {
    const { error: shareError } = await supabase
      .from('dokument_shares')
      .insert(teilenMitUserIds.map((uid) => ({ dokument_id: dokumentId, user_id: uid })))
    if (shareError) return toolTextResult(`Sichtbarkeit wurde geändert, aber Freigabe schlug fehl: ${shareError.message}`, true)
  }

  let sichtbarkeitsHinweis: string
  if (sichtbarkeit === 'geteilt') {
    sichtbarkeitsHinweis = `sichtbar für alle Mitglieder deiner Partei auf Ebene "${EBENE_LABEL[ebene!]}"${gliederung ? ` (${gliederung})` : ''}`
  } else if (sichtbarkeit === 'einzelpersonen') {
    sichtbarkeitsHinweis = `geteilt mit ${teilenMitUserIds.length} Person(en)${unaufgeloesteNamen.length > 0 ? ` - nicht gefunden: ${unaufgeloesteNamen.join(', ')}` : ''}`
  } else {
    sichtbarkeitsHinweis = 'nur für dich sichtbar'
  }
  return toolTextResult(`Sichtbarkeit von "${dok.titel}" wurde aktualisiert: ${sichtbarkeitsHinweis}.`)
}
