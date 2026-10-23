// Vorgänge im Dokumenten-Hub (Umgestaltung 23.10.2026, Entwurf A): Drucksachen
// mit derselben Grundnummer gehören zusammen – DS11/1013 ist die Anfrage,
// DS11/1013-1 die Antwort der Verwaltung, weitere Ergänzungen zählen hoch
// (bis zu 13 Teile, Stand 23.10.). Die Liste zeigt je Vorgang eine Zeile, wie
// ein Mailprogramm eine Konversation.

/** Grundnummer einer Drucksache aus ihrem Titel („DS11/1013-1 – …" → „DS11/1013"). */
export function grundnummer(titel: string): string | null {
  return titel.match(/^(DS\d+\/\d+)/)?.[1] ?? null
}

/** Vollständige Nummer samt Folgenummer („DS11/1013-1"), sonst null. */
export function drucksachennummer(titel: string): string | null {
  return titel.match(/^(DS\d+\/\d+(?:-\d+)*)/)?.[1] ?? null
}

/** Titel ohne vorangestellte Nummer und Gedankenstrich. */
export function titelOhneNummer(titel: string): string {
  return titel.replace(/^DS[\w/.-]+\s*[–-]\s*/, '')
}

/** Folgenummern als Zahlen zum Sortieren: „DS11/1013" → [], „DS11/1013-1-2" → [1, 2]. */
function folge(titel: string): number[] {
  const nr = drucksachennummer(titel)
  if (!nr) return []
  return nr
    .split('-')
    .slice(1)
    .map((n) => Number(n))
}

export interface Vorgang<T> {
  /** Grundnummer, bei Dokumenten ohne Drucksachennummer die Id. */
  schluessel: string
  /** In Reihenfolge der Nummer: erst die Grunddrucksache, dann -1, -2 … */
  teile: T[]
}

/**
 * Fasst Dokumente zu Vorgängen zusammen. Die Reihenfolge der Vorgänge folgt
 * dem neuesten Teil (`erstellt_am`), damit eine frische Antwort ihren Vorgang
 * nach oben holt.
 */
export function gruppiereVorgaenge<T extends { id: string; titel: string; erstellt_am: string }>(
  dokumente: T[],
): Vorgang<T>[] {
  const nachSchluessel = new Map<string, T[]>()
  for (const d of dokumente) {
    const schluessel = grundnummer(d.titel) ?? d.id
    const liste = nachSchluessel.get(schluessel) ?? []
    liste.push(d)
    nachSchluessel.set(schluessel, liste)
  }
  const vorgaenge = [...nachSchluessel.entries()].map(([schluessel, teile]) => ({
    schluessel,
    teile: teile.sort((a, b) => {
      const fa = folge(a.titel)
      const fb = folge(b.titel)
      for (let i = 0; i < Math.max(fa.length, fb.length); i++) {
        const unterschied = (fa[i] ?? -1) - (fb[i] ?? -1)
        if (unterschied !== 0) return unterschied
      }
      return Date.parse(a.erstellt_am) - Date.parse(b.erstellt_am)
    }),
  }))
  const neuester = (v: Vorgang<T>) => Math.max(...v.teile.map((t) => Date.parse(t.erstellt_am)))
  return vorgaenge.sort((a, b) => neuester(b) - neuester(a))
}

export type TagGruppe = 'gremien' | 'antragsteller' | 'themen'

/**
 * Ordnet einen Tag einer Gruppe im Filterfenster zu. Die Tags vergibt
 * dailyallris frei; die Zuordnung ist deshalb eine Heuristik über die
 * Bezeichnung, nicht über eine Liste.
 */
export function tagGruppe(tag: string): TagGruppe {
  const t = tag.toLowerCase()
  if (/ausschuss|^rat\b|rat iserlohn|aufsichtsrat|kommission|beirat|ratssitzung/.test(t)) return 'gremien'
  if (/fraktion|ratsgruppe|verwaltung|die linke|anlieger/.test(t)) return 'antragsteller'
  return 'themen'
}
