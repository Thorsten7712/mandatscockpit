import { describe, expect, it } from 'vitest'
import { istDokumentUngelesen, istNotizUngelesen } from '../dokumenteGelesen'

describe('istDokumentUngelesen', () => {
  const dok = { erstellt_am: '2026-10-01T10:00:00+00:00' }

  it('nie geöffnet heißt ungelesen', () => {
    expect(istDokumentUngelesen(dok, [], undefined)).toBe(true)
  })

  it('nach dem Öffnen gelesen, solange keine neue Notiz dazukommt', () => {
    expect(istDokumentUngelesen(dok, [], '2026-10-02T00:00:00Z')).toBe(false)
  })

  it('eine Notiz nach dem letzten Öffnen macht es wieder ungelesen', () => {
    expect(istDokumentUngelesen(dok, [{ erstellt_am: '2026-10-03T08:00:00+00:00' }], '2026-10-02T00:00:00Z')).toBe(true)
  })

  it('archiviert gilt als gelesen, auch wenn nie geöffnet', () => {
    expect(istDokumentUngelesen(dok, [], undefined, true)).toBe(false)
  })

  it('zurück aus dem Archiv zählt wieder der echte Lesestand', () => {
    expect(istDokumentUngelesen(dok, [], undefined, false)).toBe(true)
  })
})

describe('istNotizUngelesen', () => {
  it('ungelesen, wenn nach dem Gelesen-Zeitpunkt erstellt', () => {
    expect(istNotizUngelesen({ erstellt_am: '2026-10-03T00:00:00Z' }, '2026-10-02T00:00:00Z')).toBe(true)
    expect(istNotizUngelesen({ erstellt_am: '2026-10-01T00:00:00Z' }, '2026-10-02T00:00:00Z')).toBe(false)
  })
})
