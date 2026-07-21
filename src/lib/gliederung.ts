import type { Ebene, Profile } from './types'

type GliederungFeld = 'gliederung_kommune' | 'gliederung_kreis' | 'gliederung_land'

/** Bund braucht keine weitere Angabe - es gibt nur einen Bundestag. */
export function gliederungFeld(ebene: Ebene): GliederungFeld | null {
  if (ebene === 'kommune') return 'gliederung_kommune'
  if (ebene === 'kreis') return 'gliederung_kreis'
  if (ebene === 'land') return 'gliederung_land'
  return null
}

/**
 * Verhindert falsche Teilen-Vorschläge zwischen Mitgliedern derselben Partei
 * und Ebene, aber unterschiedlicher Kommune/unterschiedlichem Kreis/Land
 * (z. B. zwei Ratsmitglieder derselben Partei aus verschiedenen Städten).
 * Eine leere Gliederung zählt bewusst nie als Treffer.
 */
export function gleicheGliederung(a: Profile, b: Profile, ebene: Ebene): boolean {
  const feld = gliederungFeld(ebene)
  if (!feld) return true
  const va = (a[feld] ?? '').trim().toLowerCase()
  const vb = (b[feld] ?? '').trim().toLowerCase()
  return va !== '' && va === vb
}
