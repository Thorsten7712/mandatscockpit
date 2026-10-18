import { supabase } from './supabaseClient'
import { inStuecken } from './alleZeilen'
import { startOfTodayIso } from './format'
import type { TodoColumn } from './types'

// Daten der Startseite „Heute" (UI-Umbau 18.10.2026): die Woche (Sitzungen
// meiner Gremien, Einträge aus Terminkalender-Quellen, eigene Termine) und
// meine offenen Aufgaben samt Spaltenzählern. Alles mit den Rechten des
// Nutzers, RLS liefert nur, was er sehen darf. „Neu für dich" kommt
// unverändert aus src/lib/neuigkeiten.ts.

const TAGE_WOCHE = 7

export interface WochenEintrag {
  kind: 'session' | 'event'
  id: string
  titel: string
  start: string
  ort: string | null
  abgesagt: boolean
  /** Beginn liegt beim Laden schon zurück (heute früher). */
  vorbei: boolean
  /** Nur bei Sitzungen: Anzahl der Tagesordnungspunkte (0 = noch keine). */
  tops: number | null
}

export interface MeineAufgabe {
  id: string
  titel: string
  faellig_am: string | null
  ueberfaellig: boolean
  /** Fällig innerhalb der nächsten 7 Tage (überfällige eingeschlossen). */
  dieseWoche: boolean
  spalte: string
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

  const [gremienErgebnis, quellenErgebnis, eventsErgebnis] = await Promise.all([
    supabase.from('user_gremien').select('gremium').eq('user_id', userId),
    supabase.from('calendar_sources').select('id, art'),
    supabase.from('events').select('id, titel, start, ort, status').gte('start', von).lt('start', bis).order('start'),
  ])
  const gremien = (gremienErgebnis.data ?? []).map((g) => g.gremium as string)
  const terminQuellen = (quellenErgebnis.data ?? []).filter((q) => q.art === 'termin').map((q) => q.id as string)

  // Zwei .in()-Abfragen statt eines .or()-Strings, wie in CalendarView: Gremien-
  // namen mit Kommas oder Klammern würden das PostgREST-Filterformat brechen.
  const spalten = 'id, titel, gremium, datum, ort, status'
  const [nachGremium, nachQuelle] = await Promise.all([
    gremien.length > 0
      ? supabase.from('sessions').select(spalten).in('gremium', gremien).gte('datum', von).lt('datum', bis)
      : Promise.resolve({ data: [] }),
    terminQuellen.length > 0
      ? supabase.from('sessions').select(spalten).in('source_id', terminQuellen).gte('datum', von).lt('datum', bis)
      : Promise.resolve({ data: [] }),
  ])
  const sitzungen = new Map<string, { id: string; titel: string; gremium: string | null; datum: string; ort: string | null; status: string }>()
  for (const s of [...(nachGremium.data ?? []), ...(nachQuelle.data ?? [])]) sitzungen.set(s.id, s)

  const topsJeSitzung = new Map<string, number>()
  for (const ids of inStuecken([...sitzungen.keys()])) {
    const { data } = await supabase.from('sitzung_dokumente').select('session_id').in('session_id', ids)
    for (const z of data ?? []) topsJeSitzung.set(z.session_id, (topsJeSitzung.get(z.session_id) ?? 0) + 1)
  }

  const jetzt = Date.now()
  const eintraege: WochenEintrag[] = [
    ...[...sitzungen.values()].map((s) => ({
      kind: 'session' as const,
      id: s.id,
      titel: s.gremium ?? s.titel,
      start: s.datum,
      ort: s.ort,
      abgesagt: s.status === 'abgesagt',
      vorbei: Date.parse(s.datum) < jetzt,
      tops: topsJeSitzung.get(s.id) ?? 0,
    })),
    ...(eventsErgebnis.data ?? []).map((e) => ({
      kind: 'event' as const,
      id: e.id,
      titel: e.titel,
      start: e.start,
      ort: e.ort,
      abgesagt: e.status === 'abgesagt',
      vorbei: Date.parse(e.start) < jetzt,
      tops: null,
    })),
  ]
  return eintraege.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
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
