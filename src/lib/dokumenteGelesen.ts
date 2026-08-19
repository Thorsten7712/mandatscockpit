// Gelesen/Ungelesen-Berechnung für den Dokumenten-Hub (Dashboard-Badge,
// fett/nicht-fett auf Dokumente.tsx und in DokumentDetailModal.tsx). Nur EIN
// Zeitstempel pro (Top-Level-Dokument, Nutzer) wird gespeichert (siehe
// 0035_dokument_gelesen.sql) - eine Notiz gilt als ungelesen, wenn sie NACH
// diesem Zeitstempel erstellt wurde, ein Top-Level-Dokument als ungelesen,
// wenn es entweder nie geöffnet wurde oder eine seiner Notizen ungelesen ist.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DokumentRow } from './types'

export function istDokumentUngelesen(
  dokument: Pick<DokumentRow, 'erstellt_am'>,
  kinder: Pick<DokumentRow, 'erstellt_am'>[],
  gelesenAm: string | undefined,
): boolean {
  if (!gelesenAm) return true
  const letzteAktivitaetMs = kinder.reduce(
    (max, k) => Math.max(max, new Date(k.erstellt_am).getTime()),
    new Date(dokument.erstellt_am).getTime(),
  )
  return new Date(gelesenAm).getTime() < letzteAktivitaetMs
}

export function istNotizUngelesen(notiz: Pick<DokumentRow, 'erstellt_am'>, gelesenAm: string | undefined): boolean {
  if (!gelesenAm) return true
  return new Date(notiz.erstellt_am).getTime() > new Date(gelesenAm).getTime()
}

/**
 * Manuelles Markieren (zusätzlich zum automatischen Markieren beim Öffnen,
 * siehe DokumentDetailModal.tsx) - für jede*n Betrachter*in verfügbar, nicht
 * nur den Eigentümer, da "gelesen" ein reines Betrachter-Konzept ist.
 */
export async function markiereGelesen(supabase: SupabaseClient, dokumentId: string, userId: string) {
  await supabase
    .from('dokument_gelesen')
    .upsert({ dokument_id: dokumentId, user_id: userId, gelesen_am: new Date().toISOString() }, { onConflict: 'dokument_id,user_id' })
}

/** Löscht die Gelesen-Zeile - reproduziert exakt den "nie geöffnet"-Zustand. */
export async function markiereUngelesen(supabase: SupabaseClient, dokumentId: string, userId: string) {
  await supabase.from('dokument_gelesen').delete().eq('dokument_id', dokumentId).eq('user_id', userId)
}
