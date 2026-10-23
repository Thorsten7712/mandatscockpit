import { describe, expect, it } from 'vitest'
import { drucksachennummer, grundnummer, gruppiereVorgaenge, tagGruppe, titelOhneNummer } from '../vorgaenge'

const dok = (id: string, titel: string, erstellt_am: string) => ({ id, titel, erstellt_am })

describe('Nummern', () => {
  it('liest Grund- und volle Nummer', () => {
    expect(grundnummer('DS11/1013-1 – Hitzeschutz')).toBe('DS11/1013')
    expect(drucksachennummer('DS10/3885-1-1 – Schulsozialarbeit')).toBe('DS10/3885-1-1')
    expect(grundnummer('Notizen zur Klausur')).toBeNull()
  })

  it('schneidet die Nummer vom Titel ab', () => {
    expect(titelOhneNummer('DS11/1013-1 – Hitzeschutz im SWI')).toBe('Hitzeschutz im SWI')
    expect(titelOhneNummer('Freier Titel')).toBe('Freier Titel')
  })
})

describe('gruppiereVorgaenge', () => {
  it('fasst Anfrage und Antwort zusammen und sortiert die Teile nach Nummer', () => {
    const v = gruppiereVorgaenge([
      dok('b', 'DS11/1013-1 – Antwort', '2026-10-22T10:00:00Z'),
      dok('a', 'DS11/1013 – Anfrage', '2026-09-10T10:00:00Z'),
      dok('c', 'DS11/1013-1-2 – Nachtrag', '2026-10-23T10:00:00Z'),
      dok('d', 'DS11/1013-2 – Zweite Antwort', '2026-10-21T10:00:00Z'),
    ])
    expect(v).toHaveLength(1)
    expect(v[0].teile.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('der Vorgang mit dem neuesten Teil steht oben, Dokumente ohne Nummer allein', () => {
    const v = gruppiereVorgaenge([
      dok('a', 'DS11/0001 – Alt', '2026-01-01T00:00:00Z'),
      dok('x', 'Freie Notiz', '2026-05-01T00:00:00Z'),
      dok('b', 'DS11/0001-1 – Antwort', '2026-10-01T00:00:00Z'),
    ])
    expect(v.map((g) => g.schluessel)).toEqual(['DS11/0001', 'x'])
  })
})

describe('tagGruppe', () => {
  it('ordnet Gremien, Antragsteller und Themen zu', () => {
    expect(tagGruppe('Verkehrsausschuss')).toBe('gremien')
    expect(tagGruppe('Rat')).toBe('gremien')
    expect(tagGruppe('Seniorenbeirat')).toBe('gremien')
    expect(tagGruppe('Stadtwerke-Aufsichtsrat')).toBe('gremien')
    expect(tagGruppe('CDU-Fraktion und SPD-Fraktion')).toBe('antragsteller')
    expect(tagGruppe('Ratsgruppe der FDP Iserlohn')).toBe('antragsteller')
    expect(tagGruppe('Verwaltung')).toBe('antragsteller')
    expect(tagGruppe('Klimaanpassung')).toBe('themen')
  })
})
