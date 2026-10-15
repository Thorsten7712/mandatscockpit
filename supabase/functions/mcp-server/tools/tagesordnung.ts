// Tagesordnung einer Sitzung setzen (0043/0044).
//
// Gedacht für dailyallris: Das Skript liest die Tagesordnung einer Sitzung aus
// ALLRIS und schreibt sie hier in einem Aufruf ein - samt Verknüpfung auf die
// Drucksachen, die es an anderer Stelle schon als Dokumente hochgeladen hat.
// Die Punkte ohne Drucksache gehören dazu: sie strukturieren den Ablauf
// ("Eröffnung der Sitzung", "Einwohnerfragestunde") und machen rund ein
// Viertel einer Ratstagesordnung aus.
//
// Bewusst ein eigenes Tool und nicht n x link_document_session: Eine
// Ratstagesordnung hat ~84 Punkte, die Reihenfolge ist nur als Ganzes bekannt,
// und entfallene Punkte müssen verschwinden. Außerdem kennt der Importeur die
// Drucksachennummer, nicht die UUID des Dokuments - das Auflösen gehört
// hierher, zusammen mit der Rückmeldung, welche Drucksachen im Hub fehlen
// (die lädt dailyallris dann nach und ruft erneut auf).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { formatDate, toolTextResult } from '../shared.ts'

/** Ein eingelesener Tagesordnungspunkt, nach der Prüfung der Eingabe. */
interface Punkt {
  top_nummer: string
  top_titel: string | null
  ergebnis: string | null
  reihenfolge: number
  /** Drucksachennummer aus der Tagesordnung, z. B. "DS11/0108". */
  drucksache: string | null
  /** Direkt übergebene Dokument-UUID (Alternative zur Drucksachennummer). */
  dokument_id: string | null
}

/**
 * Maskiert die ILIKE-Platzhalter für eine Präfix-Suche. Anders als
 * ilikeMuster() in dokumente.ts ohne führendes `%`: Die Drucksachennummer
 * steht am Anfang des Dokumenttitels ("DS11/0524 - ..."), und ein Treffer
 * mitten im Titel wäre falsch. PostgREST ersetzt in Mustern zusätzlich `*`
 * durch `%`, deshalb wird auch das maskiert.
 */
function praefixMuster(begriff: string): string {
  return `${begriff.replace(/[\\%_*]/g, (zeichen) => `\\${zeichen}`)}%`
}

/**
 * Prüft, ob ein Dokumenttitel wirklich zu DIESER Drucksachennummer gehört.
 * Reines Präfix genügt nicht: "DS11/0470" wäre sonst auch ein Treffer für
 * "DS11/0470-1 - Anfrage ..." (die Ergänzungsvorlage ist ein anderes
 * Dokument). Nach der Nummer muss also ein Trenner folgen - alles außer
 * Ziffer, Bindestrich und Schrägstrich.
 */
function passtZurNummer(titel: string, nummer: string): boolean {
  const t = titel.toLowerCase()
  const n = nummer.toLowerCase()
  if (!t.startsWith(n)) return false
  const rest = titel.slice(nummer.length)
  return rest === '' || !/^[0-9/-]/.test(rest)
}

/**
 * Findet die Sitzung über session_id, ics_uid oder gremium+datum.
 *
 * ics_uid ist der verlässlichste Weg für einen Importeur: ALLRIS legt im
 * ICS-Feed "ALLRIS-Sitzung-<SILFDNR>" ab, und dieselbe SILFDNR steht im Kopf
 * der Tagesordnung ("...to010?SILFDNR=2001745"). Eine nackte Nummer wird
 * deshalb zum vollen UID ergänzt.
 *
 * gremium+datum gibt es für die von Hand nachgetragenen Sitzungen
 * (0045_sitzungen_nachtragen.sql): Der ICS-Feed reicht nicht in die
 * Vergangenheit, diese Zeilen haben deshalb keine ics_uid. Wird eine solche
 * Sitzung so gefunden und kommt eine ics_uid mit, wird sie nachgetragen -
 * danach greift wieder der direkte Weg. Das Datum wird auf den Tag genau
 * verglichen, nicht auf die Minute: ALLRIS meldet im Kalender gern 17:03,
 * wo die Tagesordnung 17:00 sagt.
 */
async function findeSitzung(supabase: SupabaseClient, args: Record<string, unknown>) {
  const sessionId = typeof args.session_id === 'string' ? args.session_id.trim() : ''
  const rohUid = typeof args.ics_uid === 'string' ? args.ics_uid.trim() : ''
  const uid = rohUid ? (/^\d+$/.test(rohUid) ? `ALLRIS-Sitzung-${rohUid}` : rohUid) : ''
  const gremium = typeof args.gremium === 'string' ? args.gremium.trim() : ''
  const datum = typeof args.datum === 'string' ? args.datum.trim().slice(0, 10) : ''

  if (sessionId) {
    const { data } = await supabase
      .from('sessions')
      .select('id, titel, datum, ics_uid')
      .eq('id', sessionId)
      .maybeSingle()
    return { session: data, hinweis: `Sitzung ${sessionId} wurde nicht gefunden.` }
  }

  if (uid) {
    const { data } = await supabase.from('sessions').select('id, titel, datum, ics_uid').eq('ics_uid', uid).maybeSingle()
    if (data) return { session: data, hinweis: '' }
    if (!gremium || !datum) {
      return {
        session: null,
        hinweis: `Keine Sitzung mit ics_uid "${uid}". Sie ist entweder nie aus dem Kalender importiert worden (der ALLRIS-Feed hat ein gleitendes Fenster und reicht nicht in die Vergangenheit) oder gehört zu einer anderen Quelle. Mit gremium und datum lässt sie sich auch ohne Kennung finden.`,
      }
    }
  }

  if (gremium && datum) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
      return { session: null, hinweis: `datum muss als ISO-Datum kommen (2025-12-04), nicht "${datum}".` }
    }
    const tagEnde = new Date(`${datum}T00:00:00Z`)
    tagEnde.setUTCDate(tagEnde.getUTCDate() + 1)
    const { data } = await supabase
      .from('sessions')
      .select('id, titel, datum, ics_uid')
      .eq('gremium', gremium)
      .gte('datum', `${datum}T00:00:00Z`)
      .lt('datum', tagEnde.toISOString())
    const treffer = (data ?? []) as { id: string; titel: string; datum: string; ics_uid: string | null }[]
    if (treffer.length === 1) {
      const session = treffer[0]
      // Kennung nachtragen, wenn sie fehlt - beim nächsten Mal reicht dann
      // wieder ics_uid allein.
      if (uid && !session.ics_uid) {
        await supabase.from('sessions').update({ ics_uid: uid }).eq('id', session.id)
      }
      return { session, hinweis: '' }
    }
    if (treffer.length > 1) {
      return {
        session: null,
        hinweis: `Mehrere Sitzungen von "${gremium}" am ${datum} gefunden (${treffer.length}) - bitte session_id angeben.`,
      }
    }
    return { session: null, hinweis: `Keine Sitzung von "${gremium}" am ${datum} gefunden.` }
  }

  return { session: null, hinweis: 'session_id, ics_uid oder gremium+datum ist erforderlich.' }
}

export async function setSessionAgenda(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const modus = args.modus === 'anhaengen' ? 'anhaengen' : 'ersetzen'
  if (args.modus !== undefined && args.modus !== 'ersetzen' && args.modus !== 'anhaengen') {
    return toolTextResult('Fehler: modus muss "ersetzen" oder "anhaengen" sein.', true)
  }

  if (!Array.isArray(args.punkte) || args.punkte.length === 0) {
    return toolTextResult('Fehler: punkte ist erforderlich (Liste der Tagesordnungspunkte, mindestens einer).', true)
  }

  const { session, hinweis } = await findeSitzung(supabase, args)
  if (!session) return toolTextResult(`Fehler: ${hinweis}`, true)
  const sessionId = session.id as string

  // Eingabe prüfen, bevor irgendetwas geschrieben wird: Eine halb
  // eingelesene Tagesordnung wäre schlimmer als keine.
  const punkte: Punkt[] = []
  for (const [index, roh] of (args.punkte as unknown[]).entries()) {
    if (typeof roh !== 'object' || roh === null) {
      return toolTextResult(`Fehler: punkte[${index}] ist kein Objekt.`, true)
    }
    const eintrag = roh as Record<string, unknown>
    const topNummer = typeof eintrag.top_nummer === 'string' ? eintrag.top_nummer.trim() : ''
    if (!topNummer) {
      return toolTextResult(
        `Fehler: punkte[${index}].top_nummer ist erforderlich - die TOP-Nummer ist der Schlüssel, über den ein erneuter Lauf denselben Punkt wiedererkennt.`,
        true,
      )
    }
    const reihenfolge =
      typeof eintrag.reihenfolge === 'number' && Number.isFinite(eintrag.reihenfolge)
        ? Math.trunc(eintrag.reihenfolge)
        : index
    punkte.push({
      top_nummer: topNummer,
      top_titel: typeof eintrag.top_titel === 'string' && eintrag.top_titel.trim() ? eintrag.top_titel.trim() : null,
      ergebnis: typeof eintrag.ergebnis === 'string' && eintrag.ergebnis.trim() ? eintrag.ergebnis.trim() : null,
      reihenfolge,
      drucksache:
        typeof eintrag.drucksache === 'string' && eintrag.drucksache.trim() ? eintrag.drucksache.trim() : null,
      dokument_id:
        typeof eintrag.dokument_id === 'string' && eintrag.dokument_id.trim() ? eintrag.dokument_id.trim() : null,
    })
  }

  const doppelteNummern = punkte
    .map((p) => p.top_nummer)
    .filter((nummer, i, alle) => alle.indexOf(nummer) !== i)
  if (doppelteNummern.length > 0) {
    return toolTextResult(
      `Fehler: TOP-Nummer mehrfach in der Liste: ${[...new Set(doppelteNummern)].join(', ')}. Innerhalb einer Sitzung muss sie eindeutig sein.`,
      true,
    )
  }

  // --- Drucksachen auflösen -------------------------------------------------
  // In einem Rutsch: ein ilike-Oder über alle Nummern statt 84 Einzelabfragen.
  const nummern = [...new Set(punkte.map((p) => p.drucksache).filter((n): n is string => n !== null))]
  const dokumentIdJeNummer = new Map<string, string>()
  const fehlendeNummern: string[] = []
  const fremdeNummern: string[] = []
  const mehrdeutig: string[] = []

  if (nummern.length > 0) {
    const oder = nummern.map((n) => `titel.ilike.${praefixMuster(n)}`).join(',')
    const { data: treffer, error: trefferFehler } = await supabase
      .from('dokumente')
      .select('id, titel, user_id')
      .is('parent_id', null)
      .or(oder)
    if (trefferFehler) {
      return toolTextResult(`Fehler beim Suchen der Drucksachen: ${trefferFehler.message}`, true)
    }
    const kandidaten = (treffer ?? []) as { id: string; titel: string; user_id: string }[]
    for (const nummer of nummern) {
      const passend = kandidaten.filter((k) => passtZurNummer(k.titel, nummer))
      if (passend.length === 0) {
        fehlendeNummern.push(nummer)
        continue
      }
      // Nur eigene Dokumente verknüpfen - gleiche Grenze wie bei
      // link_document_session. Der Hub-Bestand gehört dem Import-Konto.
      const eigene = passend.filter((k) => k.user_id === userId)
      if (eigene.length === 0) {
        fremdeNummern.push(nummer)
        continue
      }
      if (eigene.length > 1) mehrdeutig.push(nummer)
      dokumentIdJeNummer.set(nummer, eigene[0].id)
    }
  }

  // Direkt übergebene UUIDs prüfen (Eigentum, Existenz).
  const direkteIds = [...new Set(punkte.map((p) => p.dokument_id).filter((i): i is string => i !== null))]
  const unbekannteIds: string[] = []
  if (direkteIds.length > 0) {
    const { data: dokumente } = await supabase.from('dokumente').select('id, user_id').in('id', direkteIds)
    const eigene = new Set(((dokumente ?? []) as { id: string; user_id: string }[])
      .filter((d) => d.user_id === userId)
      .map((d) => d.id))
    for (const id of direkteIds) if (!eigene.has(id)) unbekannteIds.push(id)
    if (unbekannteIds.length > 0) {
      return toolTextResult(
        `Fehler: diese dokument_id gehören nicht dem Nutzer oder existieren nicht: ${unbekannteIds.join(', ')}.`,
        true,
      )
    }
  }

  // --- Zeilen zusammenstellen ----------------------------------------------
  // Ein Dokument darf in derselben Sitzung nur einmal vorkommen
  // (unique (session_id, dokument_id) aus 0042). Steht dieselbe Drucksache
  // zweimal auf der Tagesordnung, behält der erste Punkt die Verknüpfung; der
  // zweite bleibt als Punkt bestehen, aber ohne Dokument - besser als ein
  // Abbruch des ganzen Imports.
  const schonVerwendet = new Set<string>()
  const doppelteDokumente: string[] = []
  const zeilen = punkte.map((p) => {
    let dokumentId = p.dokument_id ?? (p.drucksache ? dokumentIdJeNummer.get(p.drucksache) ?? null : null)
    if (dokumentId && schonVerwendet.has(dokumentId)) {
      doppelteDokumente.push(`${p.top_nummer} (${p.drucksache ?? dokumentId})`)
      dokumentId = null
    }
    if (dokumentId) schonVerwendet.add(dokumentId)
    return {
      session_id: sessionId,
      dokument_id: dokumentId,
      top_nummer: p.top_nummer,
      top_titel: p.top_titel,
      reihenfolge: p.reihenfolge,
      ergebnis: p.ergebnis,
    }
  })

  // --- Schreiben ------------------------------------------------------------
  // Erst löschen, dann einfügen, statt Upsert: Wandert ein Dokument zwischen
  // zwei Läufen von TOP 3.1 auf TOP 3.2, würde das Einfügen der neuen Zeile an
  // unique (session_id, dokument_id) scheitern, solange die alte noch steht.
  //
  // "ersetzen" räumt die ganze importierte Tagesordnung dieser Sitzung weg -
  // nur die, denn Verknüpfungen ohne TOP-Nummer stammen aus der Web-UI und
  // gehören dem Nutzer, nicht dem Import.
  const neueDokumentIds = zeilen.map((z) => z.dokument_id).filter((i): i is string => i !== null)

  if (modus === 'ersetzen') {
    const { error } = await supabase
      .from('sitzung_dokumente')
      .delete()
      .eq('session_id', sessionId)
      .not('top_nummer', 'is', null)
    if (error) return toolTextResult(`Fehler beim Leeren der alten Tagesordnung: ${error.message}`, true)
    // Zusätzlich die blanken Verknüpfungen zu genau den Dokumenten, die jetzt
    // auf der Tagesordnung stehen: unique (session_id, dokument_id) aus 0042
    // lässt dasselbe Dokument kein zweites Mal zu, und die Zeile mit
    // Tagesordnungspunkt ist die reichere. Verknüpfungen zu Dokumenten, die
    // nicht auf der Tagesordnung stehen, bleiben unangetastet.
    if (neueDokumentIds.length > 0) {
      const { error: blankFehler } = await supabase
        .from('sitzung_dokumente')
        .delete()
        .eq('session_id', sessionId)
        .in('dokument_id', neueDokumentIds)
      if (blankFehler) {
        return toolTextResult(`Fehler beim Ersetzen bestehender Verknüpfungen: ${blankFehler.message}`, true)
      }
    }
  } else {
    // "anhaengen": nur die Punkte dieses Teilstücks und die Zeilen der darin
    // verknüpften Dokumente, damit beides kollisionsfrei neu eingefügt werden
    // kann.
    const { error } = await supabase
      .from('sitzung_dokumente')
      .delete()
      .eq('session_id', sessionId)
      .in('top_nummer', punkte.map((p) => p.top_nummer))
    if (error) return toolTextResult(`Fehler beim Ersetzen der Teil-Tagesordnung: ${error.message}`, true)
    if (neueDokumentIds.length > 0) {
      const { error: docFehler } = await supabase
        .from('sitzung_dokumente')
        .delete()
        .eq('session_id', sessionId)
        .in('dokument_id', neueDokumentIds)
      if (docFehler) return toolTextResult(`Fehler beim Ersetzen der Verknüpfungen: ${docFehler.message}`, true)
    }
  }

  const { error: insertFehler } = await supabase.from('sitzung_dokumente').insert(zeilen)
  if (insertFehler) return toolTextResult(`Fehler beim Schreiben der Tagesordnung: ${insertFehler.message}`, true)

  // --- Rückmeldung ----------------------------------------------------------
  const mitDokument = zeilen.filter((z) => z.dokument_id !== null).length
  const mitErgebnis = zeilen.filter((z) => z.ergebnis !== null).length
  const zeilenAusgabe = [
    `${zeilen.length} Tagesordnungspunkte für "${session.titel}" (${formatDate(String(session.datum).slice(0, 10))}) ${
      modus === 'ersetzen' ? 'gesetzt' : 'ergänzt'
    }: ${mitDokument} mit Drucksache verknüpft, ${zeilen.length - mitDokument} ohne, ${mitErgebnis} mit Ergebnis.`,
  ]
  if (fehlendeNummern.length > 0) {
    zeilenAusgabe.push(
      `Nicht im Dokumenten-Hub und daher nicht verknüpft (${fehlendeNummern.length}): ${fehlendeNummern.join(', ')}. Diese Drucksachen herunterladen, mit create_document hochladen und dieses Tool erneut aufrufen.`,
    )
  }
  if (fremdeNummern.length > 0) {
    zeilenAusgabe.push(
      `Vorhanden, aber im Besitz eines anderen Kontos und deshalb nicht verknüpft: ${fremdeNummern.join(', ')}.`,
    )
  }
  if (mehrdeutig.length > 0) {
    zeilenAusgabe.push(
      `Mehrere eigene Dokumente passen zur Nummer, das erste wurde verknüpft: ${mehrdeutig.join(', ')} - auf Dubletten im Hub prüfen.`,
    )
  }
  if (doppelteDokumente.length > 0) {
    zeilenAusgabe.push(
      `Dieselbe Drucksache steht mehrfach auf der Tagesordnung; diese Punkte blieben ohne Verknüpfung: ${doppelteDokumente.join(', ')}.`,
    )
  }
  return toolTextResult(zeilenAusgabe.join('\n'))
}

/** Listet die Tagesordnung einer Sitzung - zum Prüfen nach dem Import und als
 *  Grundlage für Rückblicke ("was wurde in TOP 3.1 beschlossen"). */
export async function listSessionAgenda(supabase: SupabaseClient, _userId: string, args: Record<string, unknown>) {
  const { session, hinweis } = await findeSitzung(supabase, args)
  if (!session) return toolTextResult(`Fehler: ${hinweis}`, true)
  const sessionId = session.id as string

  const { data, error } = await supabase
    .from('sitzung_dokumente')
    .select('dokument_id, top_nummer, top_titel, reihenfolge, ergebnis')
    .eq('session_id', sessionId)
  if (error) return toolTextResult(`Fehler beim Laden der Tagesordnung: ${error.message}`, true)

  const eintraege = (data ?? []) as {
    dokument_id: string | null
    top_nummer: string | null
    top_titel: string | null
    reihenfolge: number | null
    ergebnis: string | null
  }[]
  if (eintraege.length === 0) {
    return toolTextResult(`Für "${session.titel}" ist keine Tagesordnung hinterlegt.`)
  }

  const ids = eintraege.map((e) => e.dokument_id).filter((i): i is string => i !== null)
  const titelJeId = new Map<string, string>()
  if (ids.length > 0) {
    const { data: dokumente } = await supabase.from('dokumente').select('id, titel').in('id', ids)
    for (const d of (dokumente ?? []) as { id: string; titel: string }[]) titelJeId.set(d.id, d.titel)
  }

  // Wie im Frontend: nach reihenfolge, Einträge ohne hinten - top_nummer
  // sortiert als Text falsch ("3.10" vor "3.2").
  eintraege.sort((a, b) => {
    if (a.reihenfolge !== null && b.reihenfolge !== null) return a.reihenfolge - b.reihenfolge
    if (a.reihenfolge !== null) return -1
    if (b.reihenfolge !== null) return 1
    return (a.top_nummer ?? '').localeCompare(b.top_nummer ?? '', 'de')
  })

  const zeilen = eintraege.map((e) => {
    const nummer = e.top_nummer ? `${e.top_nummer} ` : ''
    const titel = e.top_titel || (e.dokument_id ? titelJeId.get(e.dokument_id) ?? '(Dokument nicht sichtbar)' : '(ohne Titel)')
    const dok = e.dokument_id ? ` · Dokument: ${e.dokument_id}` : ' · ohne Drucksache'
    const ergebnis = e.ergebnis ? ` · ${e.ergebnis}` : ''
    return `- ${nummer}${titel}${dok}${ergebnis}`
  })
  return toolTextResult(
    `Tagesordnung "${session.titel}" (${formatDate(String(session.datum).slice(0, 10))}), ${eintraege.length} Punkte:\n${zeilen.join('\n')}`,
  )
}
