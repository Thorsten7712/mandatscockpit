// Kuratierte Farbpalette für Kalenderquellen (calendar_sources.farbe).
// Bewusst gedeckte Tailwind-Töne, die mit jedem Partei-Theme harmonieren -
// deshalb Token-Ids statt freier Hex-Werte. 'null'/unbekannt = Theme-
// Primärfarbe (bg-primary/10 text-primary), damit Quellen ohne explizite
// Farbe automatisch ins jeweilige Partei-CI passen.
//
// Alle Klassen stehen hier ausgeschrieben, weil Tailwind nur statisch
// auffindbare Klassennamen in den Build aufnimmt.

export interface SourceColor {
  id: string
  label: string
  /** Datums-Chip / Badges: getönter Hintergrund + kräftiger Text */
  chip: string
  /** kleiner Farbpunkt/Swatch */
  dot: string
  /** Swatch-Auswahlring im Picker */
  ring: string
}

export const SOURCE_COLORS: SourceColor[] = [
  { id: 'blau', label: 'Blau', chip: 'bg-sky-100 text-sky-700', dot: 'bg-sky-500', ring: 'ring-sky-500' },
  { id: 'gruen', label: 'Grün', chip: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', ring: 'ring-emerald-500' },
  { id: 'amber', label: 'Amber', chip: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500', ring: 'ring-amber-500' },
  { id: 'violett', label: 'Violett', chip: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500', ring: 'ring-violet-500' },
  { id: 'rose', label: 'Rosé', chip: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500', ring: 'ring-rose-500' },
  { id: 'teal', label: 'Türkis', chip: 'bg-teal-100 text-teal-700', dot: 'bg-teal-500', ring: 'ring-teal-500' },
]

/** Theme-Default für Quellen ohne Farbe und für eigene Termine. */
export const THEME_COLOR: SourceColor = {
  id: '',
  label: 'Theme-Farbe',
  chip: 'bg-primary/10 text-primary',
  dot: 'bg-primary',
  ring: 'ring-primary',
}

export function sourceColorById(farbe: string | null | undefined): SourceColor {
  return SOURCE_COLORS.find((c) => c.id === farbe) ?? THEME_COLOR
}

export const EBENE_LABEL: Record<string, string> = {
  kommune: 'Kommune',
  kreis: 'Kreis',
  land: 'Land',
  bund: 'Bund',
}

/** Feste Farbzuordnung pro Ebene (Dokumenten-Hub, Dokumente.tsx) - anders als
 *  Kalenderquellen (freie Farbwahl je Quelle) soll dieselbe Ebene im gesamten
 *  Dokumenten-Hub immer dieselbe Farbe tragen, unabhängig vom Dokument. */
export const EBENE_COLOR: Record<string, SourceColor> = {
  kommune: SOURCE_COLORS[0], // Blau
  kreis: SOURCE_COLORS[1], // Grün
  land: SOURCE_COLORS[2], // Amber
  bund: SOURCE_COLORS[3], // Violett
}

/** Deterministisches Hashing des Tag-Texts auf einen Palette-Eintrag
 *  (Dokumenten-Hub) - derselbe Tag hat dadurch immer dieselbe Farbe, ohne
 *  dass Nutzer Tag-Farben manuell pflegen müssten. */
export function tagColor(tag: string): SourceColor {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) | 0
  const index = Math.abs(hash) % SOURCE_COLORS.length
  return SOURCE_COLORS[index]
}
