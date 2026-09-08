// Archiv-Regel für den Dokumenten-Hub, gemeinsam genutzt von Dokumente.tsx
// (blendet Archiviertes aus der Arbeitsliste aus), Archiv.tsx (zeigt es im
// Dokumente-Reiter) und DokumentDetailModal.tsx (Archivieren/Zurückholen).
//
// Ein Dokument ist archiviert, wenn ES ENTWEDER
//   1. mit einer Sitzung verknüpft ist, die vorbei ist - es stand dort auf der
//      Agenda und ist damit abgearbeitet (automatisch, nichts zu pflegen), ODER
//   2. von Hand archiviert wurde (dokumente.archiviert_am, 0038_dokumente_archiv.sql).
//
// Regel 1 wird bewusst hier abgeleitet statt in der DB materialisiert: sie
// hängt allein an sessions.datum und würde sonst einen täglichen Job brauchen,
// nur um eine Spalte nachzuziehen (siehe 0038_dokumente_archiv.sql).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DokumentRow } from './types'
import { startOfTodayIso } from './format'

export type ArchivGrund = 'manuell' | 'sitzung'

/** datum + gremium der verknüpften Sitzungen, in Dokumente.tsx/Archiv.tsx
 *  einmal für alle vorkommenden session_ids nachgeladen. */
export interface SessionInfo {
  datum: string
  gremium: string | null
  titel: string
}

export function archivGrund(
  dokument: Pick<DokumentRow, 'session_id' | 'archiviert_am'>,
  sessionById: Map<string, SessionInfo>,
  stichtagIso: string = startOfTodayIso(),
): ArchivGrund | null {
  if (dokument.archiviert_am) return 'manuell'
  if (!dokument.session_id) return null
  const session = sessionById.get(dokument.session_id)
  // Sitzung nicht sichtbar/nicht gefunden -> nicht archivieren. Lieber ein
  // Dokument zu viel in der Arbeitsliste als eines, das unauffindbar wird.
  if (!session) return null
  // Numerisch statt lexikografisch vergleichen: PostgREST liefert timestamptz
  // als "...+00:00", startOfTodayIso() erzeugt "...Z" - als Strings wären
  // beide Schreibweisen desselben Zeitpunkts nicht gleich.
  return Date.parse(session.datum) < Date.parse(stichtagIso) ? 'sitzung' : null
}

export function istArchiviert(
  dokument: Pick<DokumentRow, 'session_id' | 'archiviert_am'>,
  sessionById: Map<string, SessionInfo>,
  stichtagIso: string = startOfTodayIso(),
): boolean {
  return archivGrund(dokument, sessionById, stichtagIso) !== null
}

/**
 * Lädt datum/gremium/titel aller Sitzungen, auf die die übergebenen Dokumente
 * zeigen. Bewusst nur die tatsächlich referenzierten Ids statt der ganzen
 * sessions-Tabelle (gleiches Muster wie loadDocuments() in Archiv.tsx).
 */
export async function ladeSessionInfos(
  supabase: SupabaseClient,
  dokumente: Pick<DokumentRow, 'session_id'>[],
): Promise<Map<string, SessionInfo>> {
  const ids = Array.from(new Set(dokumente.map((d) => d.session_id).filter((id): id is string => Boolean(id))))
  if (ids.length === 0) return new Map()
  const { data } = await supabase.from('sessions').select('id, datum, gremium, titel').in('id', ids)
  const rows = (data ?? []) as { id: string; datum: string; gremium: string | null; titel: string }[]
  return new Map(rows.map((s) => [s.id, { datum: s.datum, gremium: s.gremium, titel: s.titel }]))
}
