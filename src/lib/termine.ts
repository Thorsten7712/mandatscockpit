import { supabase } from './supabaseClient'
import { inStuecken } from './alleZeilen'
import type { Ebene } from './types'

// Termine eines Zeitraums für Kalender und Startseite (UI-Umbau 18.10.2026):
// Sitzungen meiner Gremien, alle Einträge aus Terminkalender-Quellen
// (art = 'termin', ungefiltert) und eigene Termine. Alles mit den Rechten des
// Nutzers, RLS liefert nur, was er sehen darf.

export interface KalenderEintrag {
  kind: 'session' | 'event'
  id: string
  titel: string
  start: string
  ort: string | null
  abgesagt: boolean
  /** Beginn liegt beim Laden schon zurück. */
  vorbei: boolean
  /** Nur bei Sitzungen: Anzahl der Tagesordnungspunkte (0 = noch keine). */
  tops: number | null
  /** Nur bei Sitzungen, für die Filter im Kalender. */
  gremium: string | null
  ebene: Ebene | null
}

export async function ladeTermine(userId: string, von: string, bis: string): Promise<KalenderEintrag[]> {
  const [gremienErgebnis, quellenErgebnis, eventsErgebnis] = await Promise.all([
    supabase.from('user_gremien').select('gremium').eq('user_id', userId),
    supabase.from('calendar_sources').select('id, art, ebene'),
    supabase.from('events').select('id, titel, start, ort, status').gte('start', von).lt('start', bis).order('start'),
  ])
  const gremien = (gremienErgebnis.data ?? []).map((g) => g.gremium as string)
  const quellen = quellenErgebnis.data ?? []
  const ebeneJeQuelle = new Map(quellen.map((q) => [q.id as string, q.ebene as Ebene]))
  const terminQuellen = quellen.filter((q) => q.art === 'termin').map((q) => q.id as string)

  // Zwei .in()-Abfragen statt eines .or()-Strings: Gremiennamen mit Kommas
  // oder Klammern würden das PostgREST-Filterformat brechen.
  const spalten = 'id, titel, gremium, datum, ort, status, ebene, source_id'
  const [nachGremium, nachQuelle] = await Promise.all([
    gremien.length > 0
      ? supabase.from('sessions').select(spalten).in('gremium', gremien).gte('datum', von).lt('datum', bis)
      : Promise.resolve({ data: [] }),
    terminQuellen.length > 0
      ? supabase.from('sessions').select(spalten).in('source_id', terminQuellen).gte('datum', von).lt('datum', bis)
      : Promise.resolve({ data: [] }),
  ])
  const sitzungen = new Map<
    string,
    { id: string; titel: string; gremium: string | null; datum: string; ort: string | null; status: string; ebene: Ebene | null; source_id: string | null }
  >()
  for (const s of [...(nachGremium.data ?? []), ...(nachQuelle.data ?? [])]) sitzungen.set(s.id, s)

  const topsJeSitzung = new Map<string, number>()
  for (const ids of inStuecken([...sitzungen.keys()])) {
    const { data } = await supabase.from('sitzung_dokumente').select('session_id').in('session_id', ids)
    for (const z of data ?? []) topsJeSitzung.set(z.session_id, (topsJeSitzung.get(z.session_id) ?? 0) + 1)
  }

  const jetzt = Date.now()
  const eintraege: KalenderEintrag[] = [
    ...[...sitzungen.values()].map((s) => ({
      kind: 'session' as const,
      id: s.id,
      titel: s.gremium ?? s.titel,
      start: s.datum,
      ort: s.ort,
      abgesagt: s.status === 'abgesagt',
      vorbei: Date.parse(s.datum) < jetzt,
      tops: topsJeSitzung.get(s.id) ?? 0,
      gremium: s.gremium,
      ebene: (s.source_id ? ebeneJeQuelle.get(s.source_id) : undefined) ?? s.ebene,
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
      gremium: null,
      ebene: null,
    })),
  ]
  return eintraege.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}
