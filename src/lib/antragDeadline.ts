import type { Ebene, SessionRow } from './types'

/**
 * Einreichungsfrist für einen Antrag: Sitzungsdatum minus die für die Ebene
 * konfigurierte Vorlaufzeit (antrag_deadline_settings). Ohne verknüpfte
 * Sitzung, ohne gewählte Ebene oder ohne konfigurierte Frist für diese Ebene
 * gibt es keine berechenbare Deadline.
 */
export function computeAntragDeadline(
  session: SessionRow | null | undefined,
  ebene: Ebene | null,
  tageByEbene: Map<Ebene, number>,
): Date | null {
  if (!session || !ebene) return null
  const tage = tageByEbene.get(ebene)
  if (tage === undefined) return null
  const d = new Date(session.datum)
  d.setDate(d.getDate() - tage)
  return d
}
