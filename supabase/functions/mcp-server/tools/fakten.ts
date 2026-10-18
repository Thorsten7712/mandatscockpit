import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { formatDate, parseLimit, toolTextResult, truncate } from '../shared.ts'
import { type CallerProfile, gliederungVonProfil, loadCallerProfile } from './dokumente.ts'

// "Zahlen & Fakten" (Tabelle fakten, 0039/0040): Argumentationshilfen,
// Sprachregelungen und belegte Kennzahlen. Immer Ebenen-Material - es gibt
// keine privaten Fakten, sichtbarkeit ist stets 'geteilt'.
//
// Der MCP-Server umgeht RLS (Service-Role-Client). Die Sichtbarkeit wird
// deshalb hier nachgebaut, exakt wie fakten_select_own/fakten_select_shared:
// eigene Fakten, oder Fakten von jemandem derselben Partei auf einer eigenen
// Ebene und in derselben Gliederung (Bund ohne Gliederung). Ändern darf nur,
// wer den Fakt angelegt hat (fakten_update_own). Gelöscht wird nur in der
// Web-Oberfläche.

const KATEGORIEN = ['argumentationshilfe', 'sprachregelung', 'zahl'] as const
type Kategorie = (typeof KATEGORIEN)[number]
const KATEGORIE_LABEL: Record<Kategorie, string> = {
  argumentationshilfe: 'Argumentationshilfe',
  sprachregelung: 'Sprachregelung',
  zahl: 'Zahl',
}
const EBENEN = ['kommune', 'kreis', 'land', 'bund']
const DATUM_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const SPALTEN =
  'id, user_id, kategorie, titel, inhalt, kennzahl, einheit, quelle, stand, tags, ebene, gliederung, geaendert_am'

interface FaktZeile {
  id: string
  user_id: string
  kategorie: Kategorie
  titel: string
  inhalt: string | null
  kennzahl: string | null
  einheit: string | null
  quelle: string | null
  stand: string | null
  tags: string[]
  ebene: string
  gliederung: string | null
  geaendert_am: string
}

function darfFaktSehen(caller: CallerProfile, callerId: string, f: FaktZeile, erstellerPartei: string | null): boolean {
  if (f.user_id === callerId) return true
  if (!erstellerPartei || erstellerPartei !== caller.partei) return false
  if (!caller.ebenen.includes(f.ebene)) return false
  if (f.ebene === 'bund') return true
  return Boolean(f.gliederung) && f.gliederung === gliederungVonProfil(caller, f.ebene)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function tagsAus(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return Array.from(new Set(value.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim())))
}

/** Gemeinsame Regeln für Anlegen und Ändern, am fertigen Datensatz geprüft. */
function pruefeFakt(f: { kategorie: string; titel: string | null; inhalt: string | null; kennzahl: string | null; stand: string | null }): string | null {
  if (!KATEGORIEN.includes(f.kategorie as Kategorie)) {
    return 'kategorie muss "argumentationshilfe", "sprachregelung" oder "zahl" sein.'
  }
  if (!f.titel) return 'titel ist erforderlich.'
  if (f.kategorie === 'zahl' && !f.kennzahl) return 'Für eine Zahl ist kennzahl erforderlich (z. B. "rund 1.200").'
  if (f.kategorie !== 'zahl' && !f.inhalt) return 'inhalt ist erforderlich.'
  if (f.stand && !DATUM_PATTERN.test(f.stand)) return 'stand muss im Format YYYY-MM-DD angegeben werden.'
  return null
}

export async function listFakten(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const caller = await loadCallerProfile(supabase, userId)
  if (!caller) return toolTextResult('Fehler: Profil nicht gefunden.', true)
  const limit = parseLimit(args.limit)
  const kategorie = text(args.kategorie)
  const ebene = text(args.ebene)
  const tag = text(args.tag)
  const suche = text(args.suche)?.toLowerCase() ?? null
  if (kategorie && !KATEGORIEN.includes(kategorie as Kategorie)) {
    return toolTextResult('Fehler: kategorie muss "argumentationshilfe", "sprachregelung" oder "zahl" sein.', true)
  }

  // Grob in der DB vorfiltern (nur Ebenen des Aufrufers oder eigene), fein im
  // Code. Seitenweise, weil PostgREST höchstens 1.000 Zeilen liefert.
  const zeilen: FaktZeile[] = []
  for (let von = 0; ; von += 1000) {
    let q = supabase.from('fakten').select(SPALTEN).order('geaendert_am', { ascending: false }).order('id')
    if (kategorie) q = q.eq('kategorie', kategorie)
    if (ebene) q = q.eq('ebene', ebene)
    if (tag) q = q.contains('tags', [tag])
    const { data, error } = await q.range(von, von + 999)
    if (error) return toolTextResult(`Fehler beim Laden der Fakten: ${error.message}`, true)
    zeilen.push(...((data ?? []) as FaktZeile[]))
    if ((data ?? []).length < 1000) break
  }

  const erstellerIds = Array.from(new Set(zeilen.map((f) => f.user_id)))
  const { data: profile } = erstellerIds.length
    ? await supabase.from('profiles').select('id, name, partei').in('id', erstellerIds)
    : { data: [] }
  const profilJeId = new Map(((profile ?? []) as { id: string; name: string; partei: string | null }[]).map((p) => [p.id, p]))

  const sichtbar = zeilen.filter((f) => {
    if (!darfFaktSehen(caller, userId, f, profilJeId.get(f.user_id)?.partei ?? null)) return false
    if (!suche) return true
    return [f.titel, f.inhalt ?? '', f.kennzahl ?? '', f.einheit ?? '', f.quelle ?? '', ...f.tags]
      .join(' ')
      .toLowerCase()
      .includes(suche)
  })
  if (sichtbar.length === 0) return toolTextResult('Keine Fakten gefunden.')

  const zeilenText = sichtbar.slice(0, limit).map((f) => {
    const kopf = [`- [${KATEGORIE_LABEL[f.kategorie]}] ${f.titel}`]
    if (f.kategorie === 'zahl' && f.kennzahl) kopf.push(`  Wert: ${f.kennzahl}${f.einheit ? ` ${f.einheit}` : ''}`)
    if (f.inhalt) kopf.push(`  ${truncate(f.inhalt.replace(/\s+/g, ' '), 600)}`)
    kopf.push(
      `  Beleg: ${f.quelle ?? 'keine Quelle hinterlegt'}${f.stand ? `, Stand ${formatDate(f.stand)}` : ', ohne Stand'}`,
    )
    const von = f.user_id === userId ? 'eigener Fakt' : `von ${profilJeId.get(f.user_id)?.name ?? 'unbekannt'}`
    kopf.push(`  Ebene: ${f.ebene}${f.tags.length ? ` · Tags: ${f.tags.join(', ')}` : ''} · ${von} · id: ${f.id}`)
    return kopf.join('\n')
  })
  const rest = sichtbar.length > limit ? `\n\n${sichtbar.length} Treffer insgesamt, gezeigt ${limit} - limit erhöhen oder filtern.` : ''
  return toolTextResult(zeilenText.join('\n\n') + rest)
}

export async function createFakt(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const caller = await loadCallerProfile(supabase, userId)
  if (!caller) return toolTextResult('Fehler: Profil nicht gefunden.', true)

  const kategorie = text(args.kategorie) ?? ''
  const ebene = text(args.ebene)
  const werte = {
    kategorie,
    titel: text(args.titel),
    inhalt: text(args.inhalt),
    kennzahl: kategorie === 'zahl' ? text(args.kennzahl) : null,
    einheit: kategorie === 'zahl' ? text(args.einheit) : null,
    quelle: text(args.quelle),
    stand: text(args.stand),
    tags: tagsAus(args.tags) ?? [],
  }
  const fehler = pruefeFakt(werte)
  if (fehler) return toolTextResult(`Fehler: ${fehler}`, true)
  if (!ebene || !EBENEN.includes(ebene)) {
    return toolTextResult('Fehler: ebene ist erforderlich ("kommune", "kreis", "land" oder "bund") - ein Fakt gilt immer für eine Ebene.', true)
  }
  if (!caller.ebenen.includes(ebene)) {
    return toolTextResult(`Fehler: Die Ebene "${ebene}" gehört nicht zu deinen Ebenen (${caller.ebenen.join(', ') || 'keine'}).`, true)
  }

  // gliederung kommt IMMER aus dem eigenen Profil, nie aus einem Parameter -
  // gleiche Regel wie in der Web-Oberfläche und im Dokumenten-Hub.
  const gliederung = gliederungVonProfil(caller, ebene)
  const { data, error } = await supabase
    .from('fakten')
    .insert({ ...werte, user_id: userId, sichtbarkeit: 'geteilt', ebene, gliederung })
    .select('id')
    .single()
  if (error || !data) return toolTextResult(`Fehler beim Anlegen: ${error?.message}`, true)

  const hinweise: string[] = []
  if (ebene !== 'bund' && !gliederung) {
    hinweise.push('Achtung: In deinem Profil fehlt die Gliederung für diese Ebene - der Fakt ist so nur für dich sichtbar.')
  }
  if (!werte.quelle || !werte.stand) hinweise.push('Hinweis: Ohne Quelle und Stand zeigt die Web-Oberfläche "Keine Quelle hinterlegt".')
  return toolTextResult([`Fakt angelegt (id: ${data.id}).`, ...hinweise].join('\n'))
}

export async function updateFakt(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const id = text(args.fakt_id)
  if (!id) return toolTextResult('Fehler: fakt_id ist erforderlich.', true)
  const { data: alt } = await supabase.from('fakten').select(SPALTEN).eq('id', id).maybeSingle()
  const bisher = alt as FaktZeile | null
  // Ein fremder Fakt meldet dasselbe wie ein nicht vorhandener.
  if (!bisher || bisher.user_id !== userId) {
    return toolTextResult('Fehler: Fakt nicht gefunden oder nicht von dir angelegt - ändern darf nur, wer ihn angelegt hat.', true)
  }

  const feld = (name: string, vorher: string | null) => (name in args ? text(args[name]) : vorher)
  const kategorie = feld('kategorie', bisher.kategorie) ?? bisher.kategorie
  const neu = {
    kategorie,
    titel: feld('titel', bisher.titel),
    inhalt: feld('inhalt', bisher.inhalt),
    kennzahl: kategorie === 'zahl' ? feld('kennzahl', bisher.kennzahl) : null,
    einheit: kategorie === 'zahl' ? feld('einheit', bisher.einheit) : null,
    quelle: feld('quelle', bisher.quelle),
    stand: feld('stand', bisher.stand),
    tags: tagsAus(args.tags) ?? bisher.tags,
  }
  const fehler = pruefeFakt(neu)
  if (fehler) return toolTextResult(`Fehler: ${fehler}`, true)

  const { error } = await supabase
    .from('fakten')
    .update({ ...neu, geaendert_am: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) return toolTextResult(`Fehler beim Speichern: ${error.message}`, true)
  return toolTextResult(`Fakt aktualisiert (id: ${id}).`)
}
