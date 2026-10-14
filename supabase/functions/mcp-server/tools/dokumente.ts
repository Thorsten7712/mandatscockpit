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

/**
 * Maskiert die Platzhalter von ILIKE, damit ein Suchbegriff wörtlich gesucht
 * wird. PostgREST ersetzt in Mustern zusätzlich `*` durch `%`, deshalb wird
 * auch das maskiert - sonst wäre ein Stern im Suchbegriff eine Wildcard.
 * Drucksachennummern enthalten davon nichts, aber der Parameter ist allgemein
 * nutzbar.
 */
function ilikeMuster(suchbegriff: string): string {
  const maskiert = suchbegriff.replace(/[\\%_*]/g, (zeichen) => `\\${zeichen}`)
  return `%${maskiert}%`
}

/** Beginn des heutigen Tages als ISO-String - Grundlage der Archiv-Regel.
 *  Edge Functions laufen in UTC, die Web-UI rechnet in der lokalen Zeitzone des
 *  Browsers; die Abweichung von bis zu zwei Stunden ist hier folgenlos, weil
 *  keine Sitzung zwischen Mitternacht und 2 Uhr stattfindet. Gleiche
 *  Vereinfachung wie in listSessions() (tools/sessions.ts). */
function startOfTodayIso(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

/** Bewusster Spiegel von archivGrund() in src/lib/dokumenteArchiv.ts - zwischen
 *  Deno und dem React-Frontend gibt es kein gemeinsames Build-Tooling, das eine
 *  Abstraktion rechtfertigen würde (siehe CLAUDE.md). Ein Dokument gilt als
 *  archiviert, wenn entweder die verknüpfte Sitzung vorbei ist ODER
 *  archiviert_am gesetzt wurde (0038_dokumente_archiv.sql). Eine nicht
 *  gefundene Sitzung archiviert nicht - lieber ein Dokument zu viel in der
 *  Arbeitsliste als eines, das unauffindbar wird. */
function archivGrund(
  dokument: { id: string; archiviert_am: string | null },
  datenJeDokument: Map<string, string[]>,
  stichtagIso: string,
): 'manuell' | 'sitzung' | null {
  if (dokument.archiviert_am) return 'manuell'
  const daten = datenJeDokument.get(dokument.id) ?? []
  if (daten.length === 0) return null
  // Maßgeblich ist die LETZTE Sitzung: eine Vorlage läuft meist erst durch den
  // Fachausschuss und danach durch den Rat. Würde schon die erste vergangene
  // Sitzung archivieren, verschwände sie, während der Rat noch entscheidet.
  // Numerisch statt lexikografisch (PostgREST liefert "...+00:00").
  const letzte = Math.max(...daten.map((d) => Date.parse(d)))
  return letzte < Date.parse(stichtagIso) ? 'sitzung' : null
}

/** Lädt zu Dokument-Ids alle verknüpften Sitzungen (0042_sitzung_dokumente.sql). */
async function ladeSitzungen(
  supabase: SupabaseClient,
  dokumentIds: string[],
): Promise<{ titelJeDokument: Map<string, string[]>; datenJeDokument: Map<string, string[]> }> {
  const titelJeDokument = new Map<string, string[]>()
  const datenJeDokument = new Map<string, string[]>()
  if (dokumentIds.length === 0) return { titelJeDokument, datenJeDokument }

  const { data: links } = await supabase
    .from('sitzung_dokumente')
    .select('dokument_id, session_id, top_nummer')
    .in('dokument_id', dokumentIds)
  const paare = (links ?? []) as { dokument_id: string; session_id: string; top_nummer: string | null }[]
  const sessionIds = Array.from(new Set(paare.map((l) => l.session_id)))
  if (sessionIds.length === 0) return { titelJeDokument, datenJeDokument }

  const { data: sessionRows } = await supabase.from('sessions').select('id, titel, datum').in('id', sessionIds)
  const byId = new Map((sessionRows ?? []).map((si) => [si.id as string, si as { titel: string; datum: string }]))
  for (const l of paare) {
    const si = byId.get(l.session_id)
    if (!si) continue
    const bezeichnung = l.top_nummer ? `${si.titel} (TOP ${l.top_nummer})` : si.titel
    titelJeDokument.set(l.dokument_id, [...(titelJeDokument.get(l.dokument_id) ?? []), bezeichnung])
    datenJeDokument.set(l.dokument_id, [...(datenJeDokument.get(l.dokument_id) ?? []), si.datum])
  }
  return { titelJeDokument, datenJeDokument }
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
      .select('id, name, partei, ebenen, technisch')
      .ilike('name', `%${name}%`)
      .neq('id', userId)
    // Technische Konten (ALLRIS-Import) sind keine Adressaten einer Freigabe -
    // sie lesen nichts und verwirren nur die Trefferliste, siehe
    // 0041_profiles_technisch.sql.
    const treffer = (matches ?? []).find(
      (p) => !p.technisch && p.partei === caller.partei && (p.ebenen as string[]).some((e) => caller.ebenen.includes(e)),
    )
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

  const sessionId = typeof args.session_id === 'string' && args.session_id.trim() ? args.session_id.trim() : null

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

  // session_id ist seit 0042_sitzung_dokumente.sql keine Spalte mehr, sondern
  // eine Verknüpfungszeile - der Parameter bleibt erhalten, damit bestehende
  // Aufrufer weiter funktionieren.
  if (sessionId) {
    const { error: linkError } = await supabase
      .from('sitzung_dokumente')
      .upsert({ dokument_id: dokument.id, session_id: sessionId }, { onConflict: 'session_id,dokument_id', ignoreDuplicates: true })
    if (linkError) {
      return toolTextResult(`Dokument wurde angelegt, aber die Sitzungs-Verknüpfung schlug fehl: ${linkError.message}`, true)
    }
  }

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
  archiviert_am: string | null
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
  const sessionIdFilter = typeof args.session_id === 'string' && args.session_id.trim() ? args.session_id.trim() : ''
  // Titel-Teilstring, z. B. eine Drucksachennummer. Anders als tag/ebene wird
  // dieser Filter in der Datenbankabfrage angewendet und nicht erst beim
  // Formatieren: das Limit greift sonst zuerst, und eine ältere Drucksache
  // wäre unauffindbar, weil sie nicht unter den neuesten Treffern liegt.
  const titelFilter = typeof args.titel === 'string' && args.titel.trim() ? args.titel.trim() : ''
  // Standard "ohne" spiegelt die Web-UI (Dokumente.tsx blendet Archiviertes
  // aus). "alle"/"nur" für den Blick ins Archiv, siehe archivGrund() oben.
  const archivFilter = args.archiv === 'alle' || args.archiv === 'nur' ? args.archiv : 'ohne'
  // Ohne parent_id: nur Top-Level-Dokumente (parent_id is null), analog zur
  // Web-UI (Dokumente.tsx) - mit parent_id: gezielt die an ein Dokument
  // angehängten Notizen/Analysen.
  const parentIdFilter = typeof args.parent_id === 'string' && args.parent_id.trim() ? args.parent_id.trim() : null
  const limit = parseLimit(args.limit)

  const caller = await loadCallerProfile(supabase, userId)
  if (!caller) return toolTextResult('Fehler: eigenes Profil konnte nicht geladen werden.', true)

  const cols =
    'id, parent_id, titel, sichtbarkeit, ebene, gliederung, tags, inhalt, datei_url, archiviert_am, erstellt_am, user_id'
  let baseQuery = supabase.from('dokumente').select(cols)
  baseQuery = parentIdFilter ? baseQuery.eq('parent_id', parentIdFilter) : baseQuery.is('parent_id', null)
  if (titelFilter) baseQuery = baseQuery.ilike('titel', ilikeMuster(titelFilter))

  // Eigene Zeilen + potenziell sichtbare geteilte/einzelpersonen-Zeilen laden
  // (Filterung auf "wirklich sichtbar" passiert unten in JS, siehe darfSehen() -
  // der Service-Role-Client umgeht RLS, das muss also hier nachgebaut werden).
  const [ownRows, geteiltRows, shareRows] = await Promise.all([
    baseQuery.eq('user_id', userId),
    caller.ebenen.length > 0
      ? (() => {
          let q = supabase.from('dokumente').select(cols).eq('sichtbarkeit', 'geteilt').in('ebene', caller.ebenen)
          if (titelFilter) q = q.ilike('titel', ilikeMuster(titelFilter))
          return q.then((r) => {
            const rows = (r.data ?? []) as DokumentListRow[]
            return { data: parentIdFilter ? rows.filter((d) => d.parent_id === parentIdFilter) : rows.filter((d) => !d.parent_id) }
          })
        })()
      : Promise.resolve({ data: [] as DokumentListRow[] }),
    supabase.from('dokument_shares').select('dokument_id').eq('user_id', userId),
  ])

  const sharedDokIds = (shareRows.data ?? []).map((s) => s.dokument_id as string)
  let einzelQuery = supabase.from('dokumente').select(cols).in('id', sharedDokIds)
  einzelQuery = parentIdFilter ? einzelQuery.eq('parent_id', parentIdFilter) : einzelQuery.is('parent_id', null)
  if (titelFilter) einzelQuery = einzelQuery.ilike('titel', ilikeMuster(titelFilter))
  const { data: einzelRows } = sharedDokIds.length > 0 ? await einzelQuery : { data: [] as DokumentListRow[] }

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
  // Sitzungen VOR dem Archiv- und Sitzungsfilter laden: deren Datum entscheidet
  // mit darüber, welche Zeilen übrig bleiben (das Limit greift erst danach).
  const { titelJeDokument, datenJeDokument } = await ladeSitzungen(supabase, rows.map((d) => d.id))

  if (sessionIdFilter) {
    const { data: gefiltert } = await supabase
      .from('sitzung_dokumente')
      .select('dokument_id')
      .eq('session_id', sessionIdFilter)
    const erlaubt = new Set((gefiltert ?? []).map((l) => l.dokument_id as string))
    rows = rows.filter((d) => erlaubt.has(d.id))
  }

  const stichtag = startOfTodayIso()
  const archivGrundById = new Map(rows.map((d) => [d.id, archivGrund(d, datenJeDokument, stichtag)]))
  if (archivFilter === 'ohne') rows = rows.filter((d) => !archivGrundById.get(d.id))
  else if (archivFilter === 'nur') rows = rows.filter((d) => archivGrundById.get(d.id))

  rows.sort((a, b) => b.erstellt_am.localeCompare(a.erstellt_am))
  rows = rows.slice(0, limit)

  if (rows.length === 0) {
    const zusatz = titelFilter ? ` für Titel-Suche "${titelFilter}"` : ''
    if (archivFilter === 'nur') return toolTextResult(`Keine archivierten Dokumente gefunden${zusatz}.`)
    return toolTextResult(
      archivFilter === 'ohne'
        ? `Keine Dokumente gefunden${zusatz} (archivierte sind ausgeblendet - archiv="alle" oder archiv="nur" zeigt sie).`
        : `Keine Dokumente gefunden${zusatz}.`,
    )
  }

  const authorNameById = new Map<string, string>()
  const fremdeAutorIds = rows.filter((d) => d.user_id !== userId).map((d) => d.user_id)
  if (fremdeAutorIds.length > 0) {
    const { data: authors } = await supabase.from('profiles').select('id, name').in('id', Array.from(new Set(fremdeAutorIds)))
    for (const a of authors ?? []) authorNameById.set(a.id as string, a.name as string)
  }

  // Verknüpfte ToDos (n:m über todo_dokumente, siehe 0037_todo_dokumente.sql).
  const rowIds = rows.map((d) => d.id)
  const { data: linkRows } = await supabase.from('todo_dokumente').select('todo_id, dokument_id').in('dokument_id', rowIds)
  const todoIdsByDokument = new Map<string, string[]>()
  for (const l of linkRows ?? []) {
    const list = todoIdsByDokument.get(l.dokument_id as string) ?? []
    list.push(l.todo_id as string)
    todoIdsByDokument.set(l.dokument_id as string, list)
  }
  const allTodoIds = Array.from(new Set((linkRows ?? []).map((l) => l.todo_id as string)))
  const todoTitelById = new Map<string, string>()
  if (allTodoIds.length > 0) {
    const { data: todoRows } = await supabase.from('todos').select('id, titel').in('id', allTodoIds)
    for (const t of todoRows ?? []) todoTitelById.set(t.id as string, t.titel as string)
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
    const sitzungsTitel = titelJeDokument.get(d.id) ?? []
    if (sitzungsTitel.length > 0) teile.push(`Sitzung: ${sitzungsTitel.join(', ')}`)
    const grund = archivGrundById.get(d.id)
    if (grund) teile.push(grund === 'sitzung' ? 'ARCHIV (Sitzung vorbei)' : 'ARCHIV (von Hand)')
    const todoTitel = (todoIdsByDokument.get(d.id) ?? []).map((tid) => todoTitelById.get(tid) ?? tid)
    if (todoTitel.length > 0) teile.push(`ToDos: ${todoTitel.join(', ')}`)
    teile.push(formatDate(d.erstellt_am.slice(0, 10)))
    return teile.join(' · ')
  })
  return toolTextResult(lines.join('\n'))
}

export async function updateDocumentTitel(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const dokumentId = typeof args.dokument_id === 'string' ? args.dokument_id.trim() : ''
  if (!dokumentId) return toolTextResult('Fehler: dokument_id ist erforderlich.', true)
  const titel = typeof args.titel === 'string' ? args.titel.trim() : ''
  if (!titel) return toolTextResult('Fehler: titel ist erforderlich.', true)

  const { data: dok } = await supabase.from('dokumente').select('id, user_id, titel').eq('id', dokumentId).maybeSingle()
  if (!dok) return toolTextResult(`Fehler: Dokument ${dokumentId} wurde nicht gefunden.`, true)
  if (dok.user_id !== userId) return toolTextResult('Fehler: nur der/die Ersteller*in eines Dokuments darf dessen Titel ändern.', true)

  const alterTitel = dok.titel
  const { error } = await supabase.from('dokumente').update({ titel }).eq('id', dokumentId)
  if (error) return toolTextResult(`Fehler beim Aktualisieren des Titels: ${error.message}`, true)

  return toolTextResult(`Titel von "${alterTitel}" wurde zu "${titel}" geändert.`)
}

/**
 * Setzt den Markdown-/Textinhalt eines eigenen Dokuments nachträglich - gedacht
 * für den Nachlauf von dailyallris, das bereits hochgeladene Vorlagen später
 * noch mit ihrer Markdown-Fassung versorgt.
 *
 * `modus: "anhaengen"` existiert wegen der Transportgrenze: ein einzelner
 * MCP-Aufruf wird ab etwa 13 KB Nutzlast unzuverlässig (gleiche Erfahrung wie
 * bei create_document mit datei_base64, siehe uploads.ts). Längere Vorlagen -
 * im Bestand bis über 30.000 Zeichen - werden deshalb in Stücken übertragen:
 * einmal "ersetzen", danach beliebig oft "anhaengen".
 */
export async function updateDocumentInhalt(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const dokumentId = typeof args.dokument_id === 'string' ? args.dokument_id.trim() : ''
  if (!dokumentId) return toolTextResult('Fehler: dokument_id ist erforderlich.', true)
  if (typeof args.inhalt !== 'string') {
    return toolTextResult('Fehler: inhalt ist erforderlich (leerer String löscht den Inhalt).', true)
  }
  const modus = args.modus === 'anhaengen' ? 'anhaengen' : 'ersetzen'

  const { data: dok } = await supabase
    .from('dokumente')
    .select('id, user_id, titel, inhalt')
    .eq('id', dokumentId)
    .maybeSingle()
  if (!dok) return toolTextResult(`Fehler: Dokument ${dokumentId} wurde nicht gefunden.`, true)
  if (dok.user_id !== userId) {
    return toolTextResult('Fehler: nur der/die Ersteller*in eines Dokuments darf dessen Inhalt ändern.', true)
  }

  // Beim Anhängen an ein leeres Dokument nicht "null" voranstellen.
  const bisher = typeof dok.inhalt === 'string' ? dok.inhalt : ''
  const neu = modus === 'anhaengen' ? bisher + args.inhalt : args.inhalt
  const wert = neu.length > 0 ? neu : null

  const { error } = await supabase.from('dokumente').update({ inhalt: wert }).eq('id', dokumentId)
  if (error) return toolTextResult(`Fehler beim Aktualisieren des Inhalts: ${error.message}`, true)

  if (modus === 'anhaengen') {
    return toolTextResult(
      `An "${dok.titel}" wurden ${args.inhalt.length} Zeichen angehängt (jetzt ${neu.length} Zeichen).`,
    )
  }
  return toolTextResult(
    wert === null
      ? `Inhalt von "${dok.titel}" wurde geleert.`
      : `Inhalt von "${dok.titel}" wurde ersetzt (${neu.length} Zeichen, vorher ${bisher.length}).`,
  )
}

/**
 * Verknüpft ein eigenes Dokument zusätzlich mit einer Sitzung.
 *
 * Idempotent: Ist die Verknüpfung schon da, ist das kein Fehler, sondern eine
 * Meldung - dailyallris ruft das bei jedem Lauf erneut auf.
 */
export async function linkDocumentSession(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const dokumentId = typeof args.dokument_id === 'string' ? args.dokument_id.trim() : ''
  const sessionId = typeof args.session_id === 'string' ? args.session_id.trim() : ''
  if (!dokumentId) return toolTextResult('Fehler: dokument_id ist erforderlich.', true)
  if (!sessionId) return toolTextResult('Fehler: session_id ist erforderlich.', true)

  // Tagesordnungs-Angaben (0043): optional, die Verknüpfungszeile ist der
  // Tagesordnungspunkt. Nur übergebene Felder werden geschrieben, damit ein
  // Aufruf ohne sie bestehende Angaben nicht leert.
  const topFelder: Record<string, unknown> = {}
  if (typeof args.top_nummer === 'string') topFelder.top_nummer = args.top_nummer.trim() || null
  if (typeof args.top_titel === 'string') topFelder.top_titel = args.top_titel.trim() || null
  if (typeof args.reihenfolge === 'number' && Number.isFinite(args.reihenfolge)) {
    topFelder.reihenfolge = Math.trunc(args.reihenfolge)
  }
  // Beratungsergebnis (0044) - gehört an den Tagesordnungspunkt, nicht an das
  // Dokument: dieselbe Vorlage wird im Fachausschuss empfohlen und im Rat
  // beschlossen, mit unterschiedlichem Ergebnis.
  if (typeof args.ergebnis === 'string') topFelder.ergebnis = args.ergebnis.trim() || null

  const { data: dok } = await supabase.from('dokumente').select('id, user_id, titel').eq('id', dokumentId).maybeSingle()
  if (!dok) return toolTextResult(`Fehler: Dokument ${dokumentId} wurde nicht gefunden.`, true)
  if (dok.user_id !== userId) {
    return toolTextResult('Fehler: nur der/die Ersteller*in eines Dokuments darf dessen Sitzungs-Verknüpfungen ändern.', true)
  }
  const { data: session } = await supabase.from('sessions').select('titel, datum').eq('id', sessionId).maybeSingle()
  if (!session) return toolTextResult(`Fehler: Sitzung ${sessionId} wurde nicht gefunden.`, true)

  const topHinweis = topFelder.top_nummer ? ` als TOP ${topFelder.top_nummer}` : ''
  const { data: vorhanden } = await supabase
    .from('sitzung_dokumente')
    .select('id')
    .eq('dokument_id', dokumentId)
    .eq('session_id', sessionId)
    .maybeSingle()

  if (vorhanden) {
    // Idempotent, aber nicht untätig: Kommen Tagesordnungs-Angaben mit, werden
    // sie aufgefrischt - eine Tagesordnung kann sich bis zur Sitzung ändern.
    if (Object.keys(topFelder).length === 0) {
      return toolTextResult(`"${dok.titel}" ist mit "${session.titel}" bereits verknüpft - nichts zu tun.`)
    }
    const { error: updateError } = await supabase.from('sitzung_dokumente').update(topFelder).eq('id', vorhanden.id)
    if (updateError) return toolTextResult(`Fehler beim Aktualisieren des Tagesordnungspunkts: ${updateError.message}`, true)
    return toolTextResult(`Verknüpfung von "${dok.titel}" mit "${session.titel}" war bereits vorhanden${topHinweis} - Tagesordnungs-Angaben aktualisiert.`)
  }

  const { error } = await supabase
    .from('sitzung_dokumente')
    .insert({ dokument_id: dokumentId, session_id: sessionId, ...topFelder })
  if (error) return toolTextResult(`Fehler beim Verknüpfen: ${error.message}`, true)
  return toolTextResult(
    `"${dok.titel}" wurde mit Sitzung "${session.titel}" (${formatDate(String(session.datum).slice(0, 10))}) verknüpft${topHinweis}.`,
  )
}

export async function unlinkDocumentSession(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const dokumentId = typeof args.dokument_id === 'string' ? args.dokument_id.trim() : ''
  const sessionId = typeof args.session_id === 'string' ? args.session_id.trim() : ''
  if (!dokumentId) return toolTextResult('Fehler: dokument_id ist erforderlich.', true)
  if (!sessionId) return toolTextResult('Fehler: session_id ist erforderlich.', true)

  const { data: dok } = await supabase.from('dokumente').select('id, user_id, titel').eq('id', dokumentId).maybeSingle()
  if (!dok) return toolTextResult(`Fehler: Dokument ${dokumentId} wurde nicht gefunden.`, true)
  if (dok.user_id !== userId) {
    return toolTextResult('Fehler: nur der/die Ersteller*in eines Dokuments darf dessen Sitzungs-Verknüpfungen ändern.', true)
  }

  const { error } = await supabase
    .from('sitzung_dokumente')
    .delete()
    .eq('dokument_id', dokumentId)
    .eq('session_id', sessionId)
  if (error) return toolTextResult(`Fehler beim Lösen der Verknüpfung: ${error.message}`, true)
  return toolTextResult(`Verknüpfung von "${dok.titel}" mit dieser Sitzung wurde gelöst.`)
}

export async function updateDocumentArchiv(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const dokumentId = typeof args.dokument_id === 'string' ? args.dokument_id.trim() : ''
  if (!dokumentId) return toolTextResult('Fehler: dokument_id ist erforderlich.', true)
  if (typeof args.archivieren !== 'boolean') {
    return toolTextResult('Fehler: archivieren ist erforderlich (true = ins Archiv, false = zurückholen).', true)
  }
  const archivieren = args.archivieren

  const { data: dok } = await supabase
    .from('dokumente')
    .select('id, user_id, titel, archiviert_am')
    .eq('id', dokumentId)
    .maybeSingle()
  if (!dok) return toolTextResult(`Fehler: Dokument ${dokumentId} wurde nicht gefunden.`, true)
  if (dok.user_id !== userId) {
    return toolTextResult('Fehler: nur der/die Ersteller*in eines Dokuments darf es archivieren oder zurückholen.', true)
  }

  const { error } = await supabase
    .from('dokumente')
    .update({ archiviert_am: archivieren ? new Date().toISOString() : null })
    .eq('id', dokumentId)
  if (error) return toolTextResult(`Fehler beim Aktualisieren des Archiv-Status: ${error.message}`, true)

  if (archivieren) return toolTextResult(`"${dok.titel}" wurde ins Archiv gelegt.`)

  const { titelJeDokument, datenJeDokument } = await ladeSitzungen(supabase, [dokumentId])
  if (archivGrund({ id: dokumentId, archiviert_am: null }, datenJeDokument, startOfTodayIso())) {
    const namen = (titelJeDokument.get(dokumentId) ?? []).join(', ')
    return toolTextResult(
      `Manuelle Archivierung von "${dok.titel}" wurde aufgehoben - das Dokument bleibt aber im Archiv, weil die letzte verknüpfte Sitzung (${namen}) vorbei ist. Zum vollständigen Zurückholen die Verknüpfung mit unlink_document_session lösen.`,
    )
  }
  return toolTextResult(`"${dok.titel}" wurde aus dem Archiv zurückgeholt.`)
}

/**
 * Löscht ein eigenes Dokument oder eine eigene Notiz samt Dateien.
 *
 * Entstand aus einer Lücke: Seit der Dokumentenbestand dem technischen
 * Import-Konto gehört, ist in der Web-UI niemand mehr Eigentümer - dort gibt
 * es also keinen Löschweg mehr. Ohne dieses Tool bliebe nur direkter
 * Datenbankzugriff, und das wird gebraucht, solange ein fehlgeschlagener
 * Import-Lauf Dubletten anlegen kann.
 *
 * Zwei Dinge, die der Aufruf ernst nimmt:
 *  - `dokumente.parent_id` hat ON DELETE CASCADE (0034_dokumente_kommentare.sql).
 *    Am Dokument hängende Notizen gehen also mit - auch fremde. Sind welche
 *    dabei, bricht der Aufruf ab, bis `auch_fremde_notizen: true` gesetzt ist.
 *  - Die Dateien im Storage verschwinden nicht von selbst, wenn die Zeile
 *    gelöscht wird. Sie werden deshalb vorher ausdrücklich entfernt - sonst
 *    sammeln sich verwaiste Dateien im Bucket an.
 */
export async function deleteDocument(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const dokumentId = typeof args.dokument_id === 'string' ? args.dokument_id.trim() : ''
  if (!dokumentId) return toolTextResult('Fehler: dokument_id ist erforderlich.', true)
  const auchFremde = args.auch_fremde_notizen === true

  const { data: dok } = await supabase
    .from('dokumente')
    .select('id, user_id, titel, datei_url, parent_id')
    .eq('id', dokumentId)
    .maybeSingle()
  if (!dok) return toolTextResult(`Fehler: Dokument ${dokumentId} wurde nicht gefunden.`, true)
  if (dok.user_id !== userId) {
    return toolTextResult('Fehler: nur der/die Ersteller*in eines Dokuments darf es löschen.', true)
  }

  const { data: kinder } = await supabase
    .from('dokumente')
    .select('id, user_id, datei_url')
    .eq('parent_id', dokumentId)
  const notizen = (kinder ?? []) as { id: string; user_id: string; datei_url: string | null }[]
  const fremde = notizen.filter((k) => k.user_id !== userId)

  if (fremde.length > 0 && !auchFremde) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, name')
      .in('id', Array.from(new Set(fremde.map((k) => k.user_id))))
    const namen = (profile ?? []).map((p) => p.name as string).join(', ')
    return toolTextResult(
      `Abgebrochen: An "${dok.titel}" hängen ${fremde.length} Notiz(en) von ${namen || 'anderen Personen'}, die beim Löschen mit verschwinden würden. Zum trotzdem Löschen den Aufruf mit auch_fremde_notizen: true wiederholen.`,
      true,
    )
  }

  // Dateien zuerst - bleibt die Zeile stehen, lässt sich der Vorgang
  // wiederholen; umgekehrt wären die Dateien unauffindbar verwaist.
  const pfade = [dok.datei_url, ...notizen.map((k) => k.datei_url)].filter((p): p is string => Boolean(p))
  if (pfade.length > 0) {
    const { error: storageError } = await supabase.storage.from('dokumente').remove(pfade)
    if (storageError) {
      return toolTextResult(`Fehler beim Entfernen der Dateien: ${storageError.message} - Dokument wurde nicht gelöscht.`, true)
    }
  }

  const { error } = await supabase.from('dokumente').delete().eq('id', dokumentId)
  if (error) return toolTextResult(`Fehler beim Löschen: ${error.message}`, true)

  const teile = [`"${dok.titel}" wurde gelöscht`]
  if (notizen.length > 0) teile.push(`${notizen.length} angehängte Notiz(en) ebenfalls`)
  if (pfade.length > 0) teile.push(`${pfade.length} Datei(en) aus dem Speicher entfernt`)
  return toolTextResult(`${teile.join(', ')}.`)
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
