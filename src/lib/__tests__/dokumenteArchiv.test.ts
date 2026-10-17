import { describe, expect, it } from 'vitest'
import { archivGrund, type SitzungenJeDokument } from '../dokumenteArchiv'

const stichtag = '2026-10-17T00:00:00.000Z'
const sitzung = (datum: string) => ({ id: datum, datum, gremium: 'Rat', titel: 'Rat' })

describe('archivGrund', () => {
  it('von Hand archiviert geht allem anderen vor', () => {
    const sitzungen: SitzungenJeDokument = new Map([['d', [sitzung('2027-01-01T17:00:00+00:00')]]])
    expect(archivGrund({ id: 'd', archiviert_am: '2026-10-01T00:00:00Z' }, sitzungen, stichtag)).toBe('manuell')
  })

  it('ohne verknüpfte Sitzung bleibt ein Dokument in der Arbeitsliste', () => {
    expect(archivGrund({ id: 'd', archiviert_am: null }, new Map(), stichtag)).toBeNull()
  })

  it('maßgeblich ist die letzte Sitzung, nicht die erste', () => {
    // Fachausschuss vorbei, Rat steht noch aus: nicht archivieren.
    const sitzungen: SitzungenJeDokument = new Map([
      ['d', [sitzung('2026-09-15T15:00:00+00:00'), sitzung('2026-11-10T16:00:00+00:00')]],
    ])
    expect(archivGrund({ id: 'd', archiviert_am: null }, sitzungen, stichtag)).toBeNull()
  })

  it('sind alle Sitzungen vorbei, ist das Dokument archiviert', () => {
    const sitzungen: SitzungenJeDokument = new Map([
      ['d', [sitzung('2026-09-15T15:00:00+00:00'), sitzung('2026-10-13T16:00:00+00:00')]],
    ])
    expect(archivGrund({ id: 'd', archiviert_am: null }, sitzungen, stichtag)).toBe('sitzung')
  })

  it('vergleicht Zeitpunkte numerisch, nicht als Text (+00:00 gegen Z)', () => {
    // Als Text wäre "2026-10-17T00:00:00+00:00" < "2026-10-17T00:00:00.000Z"
    // - eine Sitzung genau zum Stichtag gälte dann fälschlich als vorbei.
    const sitzungen: SitzungenJeDokument = new Map([['d', [sitzung('2026-10-17T00:00:00+00:00')]]])
    expect(archivGrund({ id: 'd', archiviert_am: null }, sitzungen, stichtag)).toBeNull()
  })
})
