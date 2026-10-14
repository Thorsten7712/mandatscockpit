// Aufbereitung der Markdown-Fassungen, die dailyallris aus den ALLRIS-Vorlagen
// erzeugt. Reine Funktionen ohne React, damit sie prüfbar bleiben.
//
// Die Vorlagen kommen aus Verwaltungs-Templates und haben deshalb eine stabile
// Form: eine `#`-Überschrift, darunter eine Aufzählung mit den Kopfdaten
// (Drucksache, Datum, Federführend, ALLRIS-Link), dann `##`-Abschnitte wie
// "Beratungsfolge", "Beschlussvorschlag", "Sachverhalt".

/** Ein `##`-Abschnitt des Dokuments, für die Sprungleiste. */
export interface Abschnitt {
  /** Ankername, stabil aus der Reihenfolge gebildet (Überschriften wiederholen sich nicht). */
  id: string
  titel: string
}

export interface AufbereiteteVorlage {
  /** Markdown ohne Kopfdaten und ohne den Beschlussvorschlag-Abschnitt. */
  koerper: string
  /** Text des Beschlussvorschlags, falls vorhanden - wird herausgehoben dargestellt. */
  beschlussvorschlag: string | null
  abschnitte: Abschnitt[]
}

/** Erkennt die Kopfdaten-Aufzählung direkt unter der `#`-Überschrift. */
const KOPF_MUSTER = /^#[^\n]*\n+(?:[ \t]*[-*][^\n]*\n?)*/

/**
 * Mindestlänge eines Leerzeichen-Laufs, ab der ein Block als Formular gilt.
 *
 * Gemessen an einer echten Vorlage (DS11/1113): die Formularteile
 * ("Finanzielle Auswirkungen", "Prüfung von Beteiligungsrechten") haben Läufe
 * von 6 bis 49 Leerzeichen, der Blocksatz-Fließtext im Sachverhalt dagegen nie
 * mehr als 5. Dazwischen liegt die Grenze mit sauberem Abstand.
 *
 * Die Unterscheidung ist nötig, weil beides beim PDF-Auszug Mehrfach-
 * Leerzeichen erzeugt, aber ganz unterschiedlich behandelt werden muss: beim
 * Formular trägt die Ausrichtung Bedeutung, beim Fließtext ist sie Müll.
 */
const FORMULAR_LUECKE = 6

function istFormularblock(block: string): boolean {
  if (block.startsWith('#') || block.includes('|')) return false
  return new RegExp(`\\S {${FORMULAR_LUECKE},}\\S`).test(block)
}

/** Listen und Zitate behalten ihre Zeilenstruktur, sonst zerfällt die Gliederung. */
function istStrukturblock(block: string): boolean {
  return /^\s*([-*•]|\d+[.)])\s/m.test(block) || block.startsWith('>')
}

/**
 * Glättet die Blocksatz-Reste aus dem PDF-Auszug: Mehrfach-Leerzeichen
 * innerhalb eines Satzes und Absätze, die mitten im Satz umbrechen.
 *
 * Gemessen an DS11/1113 betrifft das 33 % der Zeilen und 18 von 32 Absätzen -
 * ungeglättet liest sich der Sachverhalt wie zerhackt. Überschriften,
 * Tabellen, Listen und Formularblöcke bleiben ausdrücklich unangetastet.
 *
 * Das ist eine Notmaßnahme der Anzeige. Dauerhaft gehört die Normalisierung in
 * die Extraktion (dailyallris): nur dort nützt sie auch der Volltextsuche, die
 * sonst weiter Wortfragmente statt Wörter findet.
 */
export function prosaGlaetten(markdown: string): string {
  const bloecke = markdown.split(/\n{2,}/)
  const raus: string[] = []
  for (const roh of bloecke) {
    const block = roh.replace(/\s+$/, '')
    if (!block.trim()) continue
    if (block.startsWith('#') || block.includes('|') || istFormularblock(block)) {
      raus.push(block)
      continue
    }
    if (istStrukturblock(block)) {
      // Zeilenstruktur erhalten (sonst zerfällt die Gliederung), aber die
      // Blocksatz-Lücken innerhalb einer Zeile entfernen.
      raus.push(
        block
          .split('\n')
          .map((zeile) => zeile.replace(/(\S) {2,}(?=\S)/g, '$1 ').trimEnd())
          .join('\n'),
      )
      continue
    }
    const sauber = block.replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ').trim()
    const vorher = raus.length > 0 ? raus[raus.length - 1] : null
    // An den vorigen Absatz anhängen, wenn der mitten im Satz endet - genau so
    // sieht ein harter Seitenumbruch aus dem PDF aus.
    const haengtInDerLuft =
      vorher !== null &&
      !vorher.startsWith('#') &&
      !vorher.includes('|') &&
      !istFormularblock(vorher) &&
      !istStrukturblock(vorher) &&
      !/[.:!?»"')\]]$/.test(vorher.trim())
    if (haengtInDerLuft) {
      raus[raus.length - 1] = `${vorher!.trim()} ${sauber}`
    } else {
      raus.push(sauber)
    }
  }
  return raus.join('\n\n')
}

/** Wandelt Formularblöcke in Code-Blöcke um, damit die Ausrichtung erhalten bleibt. */
export function formularbloeckeSchuetzen(markdown: string): string {
  return markdown
    .split(/\n{2,}/)
    .map((block) => {
      if (!istFormularblock(block)) return block
      // Eigene Backticks im Block würden die Umrandung sprengen.
      return '```\n' + block.replace(/`/g, "'") + '\n```'
    })
    .join('\n\n')
}

/**
 * Schneidet einen `##`-Abschnitt samt Inhalt heraus und liefert beides zurück.
 * Der Vergleich läuft case-insensitiv, weil die Verwaltung die Schreibweise
 * gelegentlich wechselt.
 */
function abschnittHerausloesen(markdown: string, name: string): { rest: string; inhalt: string | null } {
  const zeilen = markdown.split('\n')
  const start = zeilen.findIndex((z) => /^##\s+/.test(z) && z.replace(/^##\s+/, '').trim().toLowerCase() === name.toLowerCase())
  if (start === -1) return { rest: markdown, inhalt: null }
  let ende = zeilen.length
  for (let i = start + 1; i < zeilen.length; i++) {
    if (/^##\s+/.test(zeilen[i])) {
      ende = i
      break
    }
  }
  const inhalt = zeilen.slice(start + 1, ende).join('\n').trim()
  const rest = [...zeilen.slice(0, start), ...zeilen.slice(ende)].join('\n')
  return { rest, inhalt: inhalt || null }
}

export function abschnitteSammeln(markdown: string): Abschnitt[] {
  const treffer: Abschnitt[] = []
  markdown.split('\n').forEach((zeile) => {
    if (!/^##\s+/.test(zeile)) return
    const titel = zeile.replace(/^##\s+/, '').trim()
    if (titel) treffer.push({ id: `abschnitt-${treffer.length}`, titel })
  })
  return treffer
}

/**
 * Bereitet eine Vorlage für die Leseansicht auf. Die Kopfdaten fliegen raus,
 * weil das Metadatenband im Modal dieselben Angaben besser zeigt; der
 * Beschlussvorschlag wird herausgehoben, weil er der Satz ist, über den
 * abgestimmt wird - im Original steht er zwischen zwei Formularblöcken.
 *
 * Alles andere bleibt unangetastet: lieber ein Abschnitt zu viel im Fließtext
 * als ein verschluckter.
 */
export function vorlageAufbereiten(markdown: string | null): AufbereiteteVorlage {
  if (!markdown || !markdown.trim()) {
    return { koerper: '', beschlussvorschlag: null, abschnitte: [] }
  }
  const ohneKopf = markdown.replace(KOPF_MUSTER, '').trimStart()
  const { rest, inhalt } = abschnittHerausloesen(ohneKopf, 'Beschlussvorschlag')
  const koerper = formularbloeckeSchuetzen(prosaGlaetten(rest.trim()))
  return {
    koerper,
    beschlussvorschlag: inhalt ? prosaGlaetten(inhalt) : null,
    abschnitte: abschnitteSammeln(koerper),
  }
}

/** Trägt eine Markdown-Fassung überhaupt Struktur, oder ist es nur Fließtext? */
export function istStrukturiert(markdown: string | null): boolean {
  return Boolean(markdown && /^##\s+/m.test(markdown))
}
