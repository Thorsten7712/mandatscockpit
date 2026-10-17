import { describe, expect, it } from 'vitest'
import { formularbloeckeSchuetzen, prosaGlaetten, vorlageAufbereiten, vorschau } from '../vorlageMarkdown'

const VORLAGE = `# DS11/0971 – Monatsticket Tarifzone B

- Drucksache: DS11/0971
- Datum: 01.09.2026

## Beratungsfolge

Verkehrsausschuss, Rat

## Beschlussvorschlag

Der Rat beschließt die Einführung eines Monatstickets für 100 Euro im Monat in der Tarifzone B.

## Sachverhalt

Gesehen Bm:

Die Verwaltung wurde am 24.03.2026 beauftragt, ein Monatsticket und den Wegfall der Höchstparkdauer zu prüfen.`

describe('vorschau', () => {
  it('nimmt bevorzugt den Beschlussvorschlag', () => {
    expect(vorschau(VORLAGE)).toBe('Der Rat beschließt die Einführung eines Monatstickets für 100 Euro im Monat in der Tarifzone B.')
  })

  it('ohne Beschlussvorschlag den ersten echten Absatz des Sachverhalts, nicht Formularreste', () => {
    const ohne = VORLAGE.replace(/## Beschlussvorschlag\n\n[^\n]+\n\n/, '')
    expect(vorschau(ohne)).toMatch(/^Die Verwaltung wurde am 24\.03\.2026 beauftragt/)
  })

  it('kürzt an der Wortgrenze mit Auslassungszeichen', () => {
    const text = vorschau(VORLAGE, 40)!
    expect(text.endsWith('…')).toBe(true)
    expect(text.length).toBeLessThanOrEqual(41)
    // Kein halbes Wort: im Original folgt auf den gekürzten Text ein Leerzeichen.
    expect(vorschau(VORLAGE)!.startsWith(`${text.slice(0, -1)} `)).toBe(true)
  })

  it('leerer Text hat keine Vorschau', () => {
    expect(vorschau(null)).toBeNull()
    expect(vorschau('   ')).toBeNull()
  })
})

describe('vorlageAufbereiten', () => {
  it('trennt Kopfdaten und Beschlussvorschlag vom Körper', () => {
    const v = vorlageAufbereiten(VORLAGE)
    expect(v.beschlussvorschlag).toMatch(/^Der Rat beschließt/)
    expect(v.koerper).not.toContain('Drucksache: DS11/0971')
    expect(v.koerper).not.toContain('## Beschlussvorschlag')
    expect(v.abschnitte.map((a) => a.titel)).toContain('Sachverhalt')
  })
})

describe('prosaGlaetten', () => {
  it('zieht Blocksatz-Lücken im Fließtext zusammen', () => {
    expect(prosaGlaetten('Jugendhilfe   an  Schule')).toBe('Jugendhilfe an Schule')
  })

  it('führt Absätze nicht mehr zusammen (sonst klebt "## Verfasser" am Folgetext)', () => {
    const md = '## Verfasser\n\nFraktionsgeschäftsstelle\n\nDer nächste Absatz.'
    expect(prosaGlaetten(md)).toBe(md)
  })
})

describe('formularbloeckeSchuetzen', () => {
  it('ab 6 Leerzeichen ist es ein Formular und wird zum Code-Block', () => {
    expect(formularbloeckeSchuetzen('Haushalt:      nein')).toBe('```\nHaushalt:      nein\n```')
  })

  it('Blocksatz mit bis zu 5 Leerzeichen bleibt Fließtext (DS11/1113)', () => {
    expect(formularbloeckeSchuetzen('Die Stadt     beschließt')).toBe('Die Stadt     beschließt')
  })
})
