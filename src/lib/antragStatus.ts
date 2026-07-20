import type { AntragStatus } from './types'

// Zentrales Vokabular für den Antrags-Workflow, gleiches Muster wie
// EBENE_LABEL/SOURCE_COLORS in sourceColors.ts - Klassen ausgeschrieben,
// weil Tailwind nur statisch auffindbare Klassennamen in den Build nimmt.

export const ANTRAG_STATUS_ORDER: AntragStatus[] = [
  'entwurf',
  'eingereicht',
  'in_beratung',
  'vertagt',
  'beschlossen',
  'abgelehnt',
  'zurueckgezogen',
]

export const ANTRAG_STATUS_LABEL: Record<AntragStatus, string> = {
  entwurf: 'Entwurf',
  eingereicht: 'Eingereicht',
  in_beratung: 'In Beratung',
  vertagt: 'Vertagt',
  beschlossen: 'Beschlossen',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Zurückgezogen',
}

export const ANTRAG_STATUS_BADGE: Record<AntragStatus, string> = {
  entwurf: 'bg-slate-100 text-slate-600',
  eingereicht: 'bg-sky-100 text-sky-700',
  in_beratung: 'bg-amber-100 text-amber-700',
  vertagt: 'bg-violet-100 text-violet-700',
  beschlossen: 'bg-emerald-100 text-emerald-700',
  abgelehnt: 'bg-rose-100 text-rose-700',
  zurueckgezogen: 'bg-slate-100 text-slate-400',
}

/** Statuswerte, die auf dem Dashboard als "noch offen/aktiv" gelten. */
export const ANTRAG_STATUS_AKTIV: AntragStatus[] = ['entwurf', 'eingereicht', 'in_beratung', 'vertagt']

/** Statuswerte, die als final entschieden gelten und ins Archiv wandern. */
export const ANTRAG_STATUS_ABGESCHLOSSEN: AntragStatus[] = ['beschlossen', 'abgelehnt', 'zurueckgezogen']
