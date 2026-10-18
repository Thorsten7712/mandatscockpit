import { describe, expect, it } from 'vitest'
import { inStuecken } from '../alleZeilen'
import { fileNameFromPath } from '../dateien'
import { gleicheGliederung } from '../gliederung'
import type { Profile } from '../types'

describe('inStuecken', () => {
  it('teilt in gleich große Stücke, das letzte darf kürzer sein', () => {
    expect(inStuecken([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(inStuecken([], 2)).toEqual([])
  })
})

describe('fileNameFromPath', () => {
  it('blendet Ordner und Zeitstempel-Präfix aus', () => {
    expect(fileNameFromPath('d842/1789228677617-Redebeitrag.md')).toBe('Redebeitrag.md')
    expect(fileNameFromPath('ohne-praefix.pdf')).toBe('ohne-praefix.pdf')
  })
})

describe('gleicheGliederung', () => {
  const profil = (kommune: string | null) => ({ gliederung_kommune: kommune, gliederung_kreis: null, gliederung_land: null }) as Profile

  it('vergleicht ohne Groß-/Kleinschreibung und Leerraum', () => {
    expect(gleicheGliederung(profil('Iserlohn'), profil(' iserlohn '), 'kommune')).toBe(true)
    expect(gleicheGliederung(profil('Iserlohn'), profil('Hemer'), 'kommune')).toBe(false)
  })

  it('eine leere Gliederung ist nie ein Treffer', () => {
    expect(gleicheGliederung(profil(null), profil(null), 'kommune')).toBe(false)
  })

  it('auf Bundesebene gibt es keine Gliederung', () => {
    expect(gleicheGliederung(profil(null), profil(null), 'bund')).toBe(true)
  })
})
