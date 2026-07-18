// Registry der Partei-Themes. Die Farbwerte selbst leben als CSS-Variablen in
// src/index.css ([data-theme=...]); hier stehen nur Metadaten (Label fürs
// Settings-Dropdown, Logo-Pfad für den Dashboard-Header).
//
// Neues Theme ergänzen: 1. CSS-Block in index.css, 2. Eintrag hier,
// 3. Logo-SVG unter public/parteilogos/. profiles.partei speichert die id;
// unbekannte Werte fallen aufs neutrale Theme zurück.

export interface ParteiTheme {
  id: string
  label: string
  /** Dateiname unter public/parteilogos/, null = kein Logo (neutral) */
  logo: string | null
}

export const PARTEI_THEMES: ParteiTheme[] = [
  { id: '', label: 'Keine / neutral', logo: null },
  { id: 'cdu', label: 'CDU', logo: 'cdu.svg' },
  { id: 'spd', label: 'SPD', logo: 'spd.svg' },
  { id: 'fdp', label: 'FDP', logo: 'fdp.svg' },
  { id: 'gruene', label: 'Bündnis 90/Die Grünen', logo: 'gruene.svg' },
  { id: 'linke', label: 'Die Linke', logo: 'linke.svg' },
  { id: 'afd', label: 'AfD', logo: 'afd.svg' },
]

export function themeById(partei: string | null | undefined): ParteiTheme {
  return PARTEI_THEMES.find((t) => t.id === (partei ?? '')) ?? PARTEI_THEMES[0]
}

export function logoUrl(theme: ParteiTheme): string | null {
  if (!theme.logo) return null
  return `${import.meta.env.BASE_URL}parteilogos/${theme.logo}`
}

/**
 * Setzt das Theme global per data-Attribut auf <html>. Leerer/unbekannter
 * Wert entfernt das Attribut (= neutrales Theme aus :root).
 */
export function applyTheme(partei: string | null | undefined) {
  const theme = themeById(partei)
  if (theme.id) {
    document.documentElement.dataset.theme = theme.id
  } else {
    delete document.documentElement.dataset.theme
  }
}
