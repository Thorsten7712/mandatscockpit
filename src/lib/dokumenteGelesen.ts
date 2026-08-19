// Gelesen/Ungelesen-Berechnung für den Dokumenten-Hub (Dashboard-Badge,
// fett/nicht-fett auf Dokumente.tsx und in DokumentDetailModal.tsx). Nur EIN
// Zeitstempel pro (Top-Level-Dokument, Nutzer) wird gespeichert (siehe
// 0035_dokument_gelesen.sql) - eine Notiz gilt als ungelesen, wenn sie NACH
// diesem Zeitstempel erstellt wurde, ein Top-Level-Dokument als ungelesen,
// wenn es entweder nie geöffnet wurde oder eine seiner Notizen ungelesen ist.
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
