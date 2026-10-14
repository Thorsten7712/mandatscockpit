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
 * Entfernt Mehrfach-Leerzeichen aus Fließtext und Listenzeilen. Überschriften,
 * Tabellen und Formularblöcke bleiben unangetastet.
 *
 * **Absätze werden ausdrücklich NICHT mehr zusammengeführt.** Eine frühere
 * Fassung hing einen Absatz an den vorigen an, wenn der nicht auf einem
 * Satzzeichen endete - gedacht für die harten Umbrüche aus dem PDF-Auszug.
 * Seit dailyallris die Prosa schon bei der Extraktion normalisiert, rät diese
 * Heuristik mehr falsch als richtig: Feldwerte wie "AfD-Fraktion, AfD
 * Fraktionsgeschäftsstelle" unter "## Verfasser" enden naturgemäß ohne Punkt
 * und wurden mit dem folgenden Absatz verklebt. Gemessen am Bestand hätte das
 * 98 von 244 Dokumenten betroffen.
 *
 * Das Zusammenziehen von Zeilen *innerhalb* eines Blocks bleibt, ist für die
 * Darstellung aber ohnehin folgenlos - Markdown behandelt einfache
 * Zeilenumbrüche innerhalb eines Absatzes bereits als Leerzeichen.
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
    raus.push(block.replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ').trim())
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

/** Entfernt Markdown-Auszeichnung für eine einzeilige Vorschau. */
function auszeichnungEntfernen(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Kurzfassung für die Listenansicht (Dokumente.tsx). Bevorzugt den
 * Beschlussvorschlag - das ist bei einer Vorlage die Aussage, die beim
 * Überfliegen zählt -, sonst den ersten echten Absatz.
 *
 * Nötig, seit dailyallris den vollen Vorlagentext in `inhalt` schreibt: die
 * Liste hat das Feld vorher ungekürzt angezeigt, was bei 9.000 Zeichen pro
 * Dokument die ganze Seite sprengt. Die Vorschau bleibt bewusst reiner Text,
 * das gerenderte Markdown gehört ins Detail-Modal.
 */
export function vorschau(markdown: string | null, maxZeichen = 220): string | null {
  if (!markdown || !markdown.trim()) return null
  const { koerper, beschlussvorschlag } = vorlageAufbereiten(markdown)

  // Gestaffelt, weil nicht jede Vorlage einen Beschlussvorschlag hat (Anträge
  // der Fraktionen zum Beispiel nicht): dann ist der Sachverhalt die Substanz.
  // Die Längenschwelle hält Formularreste wie "Gesehen Bm:" oder
  // "Mitzeichnungen:" aus der Vorschau, die sonst als erster Absatz durchgehen.
  const MINDESTLAENGE = 60
  const erstenAbsatzNehmen = (text: string, mindestens: number) =>
    text
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .find((b) => b.length >= mindestens && !b.startsWith('#') && !b.startsWith('```') && !b.includes('|'))

  const quelle =
    beschlussvorschlag ||
    erstenAbsatzNehmen(abschnittHerausloesen(koerper, 'Sachverhalt').inhalt ?? '', MINDESTLAENGE) ||
    erstenAbsatzNehmen(koerper, MINDESTLAENGE) ||
    erstenAbsatzNehmen(koerper, 1) ||
    ''

  const text = auszeichnungEntfernen(quelle)
  if (!text) return null
  if (text.length <= maxZeichen) return text
  // An der Wortgrenze kürzen, damit kein halbes Wort stehen bleibt.
  const gekuerzt = text.slice(0, maxZeichen)
  const letzteLuecke = gekuerzt.lastIndexOf(' ')
  return `${(letzteLuecke > maxZeichen * 0.6 ? gekuerzt.slice(0, letzteLuecke) : gekuerzt).trimEnd()}…`
}
