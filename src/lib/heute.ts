import { supabase } from './supabaseClient'
import { inStuecken } from './alleZeilen'
import { ladeTermine, type KalenderEintrag } from './termine'
import { startOfTodayIso } from './format'
import type { TodoColumn } from './types'

// Daten der Startseite „Heute" (UI-Umbau 18.10.2026): die Woche (Sitzungen
// meiner Gremien, Einträge aus Terminkalender-Quellen, eigene Termine) und
// meine offenen Aufgaben samt Spaltenzählern. Alles mit den Rechten des
// Nutzers, RLS liefert nur, was er sehen darf. „Neu für dich" kommt
// unverändert aus src/lib/neuigkeiten.ts.

const TAGE_WOCHE = 7

/** Ein Eintrag in „Diese Woche“ – derselbe Typ wie im Kalender. */
export type WochenEintrag = KalenderEintrag

export interface MeineAufgabe {
  id: string
  titel: string
  faellig_am: string | null
  ueberfaellig: boolean
  /** Fällig innerhalb der nächsten 7 Tage (überfällige eingeschlossen). */
  dieseWoche: boolean
  spalte: string
  /** Spalte, in der die Karte gerade liegt – für „Rückgängig" nach dem Abhaken. */
  spalteId: string
}

export interface AufgabenStand {
  offen: MeineAufgabe[]
  /** Kartenzahl je fester Spalte, in Board-Reihenfolge. */
  spalten: { titel: string; anzahl: number }[]
  fertigSpalteId: string | null
}

function faelligMs(faellig: string): number {
  // faellig_am ist ein reines Datum: als Tagesende lesen, sonst wäre eine
  // heute fällige Karte ab Mitternacht „überfällig" (wie in neuigkeiten.ts).
  return Date.parse(`${faellig}T23:59:59`)
}

export async function ladeWoche(userId: string): Promise<WochenEintrag[]> {
  const von = startOfTodayIso()
  const bis = new Date(Date.parse(von) + TAGE_WOCHE * 24 * 60 * 60 * 1000).toISOString()
  return ladeTermine(userId, von, bis)
}

export async function ladeMeineAufgaben(userId: string): Promise<AufgabenStand> {
  const [platzErgebnis, spaltenErgebnis] = await Promise.all([
    supabase.from('todo_placements').select('todo_id, column_id').eq('user_id', userId),
    supabase.from('todo_columns').select('id, titel, reihenfolge').eq('user_id', userId).order('reihenfolge'),
  ])
  const platzierungen = platzErgebnis.data ?? []
  const spalten = (spaltenErgebnis.data ?? []) as Pick<TodoColumn, 'id' | 'titel' | 'reihenfolge'>[]
  const fertig = spalten.find((c) => c.titel.trim().toLowerCase() === 'fertig') ?? null
  const spalteById = new Map(spalten.map((c) => [c.id, c.titel]))

  const karten: { id: string; titel: string; faellig_am: string | null; erledigt: boolean }[] = []
  for (const ids of inStuecken(platzierungen.map((p) => p.todo_id))) {
    const { data } = await supabase.from('todos').select('id, titel, faellig_am, erledigt').in('id', ids)
    karten.push(...(data ?? []))
  }
  const karteById = new Map(karten.map((k) => [k.id, k]))

  const anzahl = new Map<string, number>()
  const offen: MeineAufgabe[] = []
  const jetzt = Date.now()
  for (const p of platzierungen) {
    const k = karteById.get(p.todo_id)
    if (!k) continue
    // Wie im Board: erledigt zählt für jeden Betrachter in seiner Fertig-Spalte.
    const spalteId = k.erledigt && fertig ? fertig.id : p.column_id
    anzahl.set(spalteId, (anzahl.get(spalteId) ?? 0) + 1)
    if (k.erledigt || spalteId === fertig?.id) continue
    offen.push({
      id: k.id,
      titel: k.titel,
      faellig_am: k.faellig_am,
      ueberfaellig: k.faellig_am ? faelligMs(k.faellig_am) < jetzt : false,
      dieseWoche: k.faellig_am ? faelligMs(k.faellig_am) <= jetzt + TAGE_WOCHE * 24 * 60 * 60 * 1000 : false,
      spalte: spalteById.get(spalteId) ?? '',
      spalteId,
    })
  }
  // Mit Termin zuerst (früheste oben), ohne Termin danach.
  offen.sort((a, b) => {
    if (a.faellig_am && b.faellig_am) return faelligMs(a.faellig_am) - faelligMs(b.faellig_am)
    if (a.faellig_am) return -1
    if (b.faellig_am) return 1
    return 0
  })

  return {
    offen,
    spalten: spalten.map((c) => ({ titel: c.titel, anzahl: anzahl.get(c.id) ?? 0 })),
    fertigSpalteId: fertig?.id ?? null,
  }
}

/** Haken auf der Startseite = Karte nach „Fertig", wie Ziehen im Board. */
export async function aufgabeErledigen(userId: string, todoId: string, fertigSpalteId: string | null): Promise<string | null> {
  if (fertigSpalteId) {
    const { error } = await supabase
      .from('todo_placements')
      .update({ column_id: fertigSpalteId })
      .eq('todo_id', todoId)
      .eq('user_id', userId)
    if (error) return error.message
  }
  const { error } = await supabase
    .from('todos')
    .update({ erledigt: true, erledigt_am: new Date().toISOString() })
    .eq('id', todoId)
  return error?.message ?? null
}

/** „Rückgängig" nach dem Haken: Karte zurück in ihre Spalte, nicht mehr erledigt. */
export async function aufgabeWiederOeffnen(userId: string, todoId: string, spalteId: string): Promise<string | null> {
  const { error: platzFehler } = await supabase
    .from('todo_placements')
    .update({ column_id: spalteId })
    .eq('todo_id', todoId)
    .eq('user_id', userId)
  if (platzFehler) return platzFehler.message
  const { error } = await supabase.from('todos').update({ erledigt: false, erledigt_am: null }).eq('id', todoId)
  return error?.message ?? null
}

export interface VorbereitungsPunkt {
  dokumentId: string
  nummer: string | null
  titel: string
  analysen: number
  gelesen: boolean
}

export interface Vorbereitung {
  /** Punkte mit Drucksache. */
  gesamt: number
  gelesen: number
  /** Bis zu drei Punkte, die noch Aufmerksamkeit brauchen: ungelesen, mit Notizen zuerst. */
  hinweise: VorbereitungsPunkt[]
}

/**
 * Lesestand der nächsten Sitzung für die Startseite (Richtung A, 08.11.2026):
 * wie viele Vorlagen der Tagesordnung schon geöffnet wurden und welche Punkte
 * offen sind – bevorzugt die mit Analyse oder eigener Notiz. Gelesen heißt hier
 * schlicht „einmal geöffnet" (dokument_gelesen), ohne die Notiz-Feinheiten aus
 * src/lib/dokumenteGelesen.ts – für den Fortschrittsbalken genügt das.
 */
export async function ladeVorbereitung(userId: string, sessionId: string): Promise<Vorbereitung> {
  const { data: links } = await supabase
    .from('sitzung_dokumente')
    .select('dokument_id, top_nummer, top_titel, reihenfolge')
    .eq('session_id', sessionId)
    .not('dokument_id', 'is', null)
    .order('reihenfolge')
  const punkte = (links ?? []).filter((l): l is typeof l & { dokument_id: string } => l.dokument_id !== null)
  const ids = punkte.map((p) => p.dokument_id)
  const titel = new Map<string, string>()
  const gelesen = new Set<string>()
  const analysen = new Map<string, number>()
  for (const stueck of inStuecken(ids)) {
    const [doks, lese, kinder] = await Promise.all([
      supabase.from('dokumente').select('id, titel').in('id', stueck),
      supabase.from('dokument_gelesen').select('dokument_id').eq('user_id', userId).in('dokument_id', stueck),
      supabase.from('dokumente').select('parent_id').in('parent_id', stueck),
    ])
    for (const d of doks.data ?? []) titel.set(d.id, d.titel)
    for (const g of lese.data ?? []) gelesen.add(g.dokument_id)
    for (const k of kinder.data ?? []) if (k.parent_id) analysen.set(k.parent_id, (analysen.get(k.parent_id) ?? 0) + 1)
  }
  const alle: VorbereitungsPunkt[] = punkte.map((p) => ({
    dokumentId: p.dokument_id,
    nummer: p.top_nummer,
    titel: p.top_titel || titel.get(p.dokument_id) || '',
    analysen: analysen.get(p.dokument_id) ?? 0,
    gelesen: gelesen.has(p.dokument_id),
  }))
  const hinweise = alle
    .filter((p) => !p.gelesen)
    .sort((a, b) => Number(b.analysen > 0) - Number(a.analysen > 0))
    .slice(0, 3)
  return { gesamt: alle.length, gelesen: alle.filter((p) => p.gelesen).length, hinweise }
}
