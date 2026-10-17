// Archiv-Regel für den Dokumenten-Hub, gemeinsam genutzt von Dokumente.tsx
// (blendet Archiviertes aus der Arbeitsliste aus), Archiv.tsx (zeigt es im
// Dokumente-Reiter) und DokumentDetailModal.tsx (Archivieren/Zurückholen).
//
// Ein Dokument ist archiviert, wenn ES ENTWEDER
//   1. mit mindestens einer Sitzung verknüpft ist und die LETZTE davon vorbei
//      ist - es stand dort auf der Agenda und ist damit abgearbeitet, ODER
//   2. von Hand archiviert wurde (dokumente.archiviert_am, 0038_dokumente_archiv.sql).
//
// Regel 1 wird bewusst hier abgeleitet statt in der DB materialisiert: sie
// hängt allein an sessions.datum und würde sonst einen täglichen Job brauchen,
// nur um eine Spalte nachzuziehen (siehe 0038_dokumente_archiv.sql).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DokumentRow } from './types'
import { startOfTodayIso } from './format'
import { alleZeilen, inStuecken } from './alleZeilen'

export type ArchivGrund = 'manuell' | 'sitzung'

/** Eine mit einem Dokument verknüpfte Sitzung (n:m über sitzung_dokumente,
 *  0042_sitzung_dokumente.sql). */
export interface SessionInfo {
  id: string
  datum: string
  gremium: string | null
  titel: string
}

/** Je Dokument-Id alle verknüpften Sitzungen, nach Datum aufsteigend. */
export type SitzungenJeDokument = Map<string, SessionInfo[]>

export function archivGrund(
  dokument: Pick<DokumentRow, 'id' | 'archiviert_am'>,
  sitzungen: SitzungenJeDokument,
  stichtagIso: string = startOfTodayIso(),
): ArchivGrund | null {
  if (dokument.archiviert_am) return 'manuell'
  const verknuepft = sitzungen.get(dokument.id) ?? []
  // Keine (sichtbare) Sitzung -> nicht archivieren. Lieber ein Dokument zu
  // viel in der Arbeitsliste als eines, das unauffindbar wird.
  if (verknuepft.length === 0) return null
  // Maßgeblich ist die LETZTE Sitzung, nicht irgendeine: Eine Vorlage läuft
  // meist erst durch den Fachausschuss und danach durch den Rat. Würde schon
  // die erste vergangene Sitzung archivieren, verschwände sie aus der Liste,
  // während der Rat noch über sie entscheidet.
  //
  // Numerisch statt lexikografisch: PostgREST liefert timestamptz als
  // "...+00:00", startOfTodayIso() erzeugt "...Z".
  const letzte = Math.max(...verknuepft.map((s) => Date.parse(s.datum)))
  return letzte < Date.parse(stichtagIso) ? 'sitzung' : null
}

export function istArchiviert(
  dokument: Pick<DokumentRow, 'id' | 'archiviert_am'>,
  sitzungen: SitzungenJeDokument,
  stichtagIso: string = startOfTodayIso(),
): boolean {
  return archivGrund(dokument, sitzungen, stichtagIso) !== null
}

/**
 * Meldet Fehler ausdrücklich zurück, statt sie zu verschlucken: ohne
 * Sitzungsdaten hält archivGrund() JEDES Dokument für nicht archiviert - das
 * sieht aus wie ein kaputter Archiv-Filter statt wie ein Ladefehler.
 */
export interface SitzungsErgebnis {
  sitzungen: SitzungenJeDokument
  fehler: string | null
}

/**
 * Lädt zu den übergebenen Dokumenten alle verknüpften Sitzungen über
 * sitzung_dokumente. Bewusst nur die tatsächlich betroffenen Dokument-Ids
 * statt der ganzen Tabelle.
 */
export async function ladeSitzungenJeDokument(
  supabase: SupabaseClient,
  dokumentIds: string[],
): Promise<SitzungsErgebnis> {
  if (dokumentIds.length === 0) return { sitzungen: new Map(), fehler: null }

  // In Stücken und seitenweise: Für den ganzen Hub sind das über 1.000 Ids und
  // mehr als 1.000 Verknüpfungen - beides schnitt vorher stillschweigend ab
  // (siehe src/lib/alleZeilen.ts).
  const paare: { dokument_id: string; session_id: string }[] = []
  for (const stueck of inStuecken(dokumentIds)) {
    const { zeilen, fehler } = await alleZeilen<{ dokument_id: string; session_id: string }>((von, bis) =>
      supabase.from('sitzung_dokumente').select('dokument_id, session_id').in('dokument_id', stueck).order('id').range(von, bis),
    )
    if (fehler) return { sitzungen: new Map(), fehler }
    paare.push(...zeilen)
  }
  const sessionIds = Array.from(new Set(paare.map((l) => l.session_id)))
  if (sessionIds.length === 0) return { sitzungen: new Map(), fehler: null }

  const sessionById = new Map<string, SessionInfo>()
  for (const stueck of inStuecken(sessionIds)) {
    const { data, error } = await supabase.from('sessions').select('id, datum, gremium, titel').in('id', stueck)
    if (error) return { sitzungen: new Map(), fehler: error.message }
    for (const s of (data ?? []) as SessionInfo[]) sessionById.set(s.id, s)
  }

  const ergebnis: SitzungenJeDokument = new Map()
  for (const l of paare) {
    const session = sessionById.get(l.session_id)
    // Nicht sichtbare oder gelöschte Sitzung überspringen.
    if (!session) continue
    const liste = ergebnis.get(l.dokument_id) ?? []
    liste.push(session)
    ergebnis.set(l.dokument_id, liste)
  }
  for (const liste of ergebnis.values()) liste.sort((a, b) => a.datum.localeCompare(b.datum))
  return { sitzungen: ergebnis, fehler: null }
}
