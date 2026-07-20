import type { AntragErgebnis, AntragStatus } from './types'

// Zentrales Vokabular für den Antrags-Workflow, gleiches Muster wie
// EBENE_LABEL/SOURCE_COLORS in sourceColors.ts - Klassen ausgeschrieben,
// weil Tailwind nur statisch auffindbare Klassennamen in den Build nimmt.
//
// "abgestimmt" hat kein festes Badge: die Farbe hängt vom Ergebnis ab (rot
// für negativ, grün für positiv) - dafür antragBadgeClasses/antragStatusLabel
// statt direktem Map-Zugriff verwenden.

export const ANTRAG_STATUS_ORDER: AntragStatus[] = [
  'entwurf',
  'gestellt',
  'in_beratung',
  'vertagt',
  'abgestimmt',
  'zurueckgezogen',
]

export const ANTRAG_STATUS_LABEL: Record<AntragStatus, string> = {
  entwurf: 'Entwurf',
  gestellt: 'Gestellt',
  in_beratung: 'In Beratung',
  vertagt: 'Vertagt',
  abgestimmt: 'Abgestimmt',
  zurueckgezogen: 'Zurückgezogen',
}

const ANTRAG_STATUS_BADGE: Record<AntragStatus, string> = {
  entwurf: 'bg-slate-100 text-slate-600',
  gestellt: 'bg-sky-100 text-sky-700',
  in_beratung: 'bg-amber-100 text-amber-700',
  vertagt: 'bg-violet-100 text-violet-700',
  abgestimmt: 'bg-slate-100 text-slate-500',
  zurueckgezogen: 'bg-slate-100 text-slate-400',
}

export function antragBadgeClasses(status: AntragStatus, ergebnis: AntragErgebnis | null): string {
  if (status === 'abgestimmt') {
    if (ergebnis === 'positiv') return 'bg-emerald-100 text-emerald-700'
    if (ergebnis === 'negativ') return 'bg-rose-100 text-rose-700'
  }
  return ANTRAG_STATUS_BADGE[status]
}

export function antragStatusLabel(status: AntragStatus, ergebnis: AntragErgebnis | null): string {
  if (status === 'abgestimmt' && ergebnis) {
    return ergebnis === 'positiv' ? 'Abgestimmt · Positiv' : 'Abgestimmt · Negativ'
  }
  return ANTRAG_STATUS_LABEL[status]
}

/** Statuswerte, die auf dem Dashboard als "noch offen/aktiv" gelten. */
export const ANTRAG_STATUS_AKTIV: AntragStatus[] = ['entwurf', 'gestellt', 'in_beratung', 'vertagt']

/** Statuswerte, die als final entschieden gelten und ins Archiv wandern. */
export const ANTRAG_STATUS_ABGESCHLOSSEN: AntragStatus[] = ['abgestimmt', 'zurueckgezogen']
