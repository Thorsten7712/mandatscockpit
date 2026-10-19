import { supabase } from './supabaseClient'
import { inStuecken } from './alleZeilen'
import type { SessionRow } from './types'

// Neuigkeiten im Cockpit statt Mails (0057, docs/ARCHITEKTUR-PLAN.md). Zwei
// Teile: was seit dem letzten "Alles gesehen" neu ist, und was demnächst
// ansteht (das gilt unabhängig vom letzten Besuch). Alles läuft mit den
// Rechten des Nutzers, RLS liefert nur, was er sehen darf.

/** Wie weit "demnächst" reicht. */
const TAGE_SITZUNGEN = 7
const TAGE_AUFGABEN = 3

export type Ziel =
  | { art: 'todo'; id: string }
  | { art: 'sitzung'; id: string }
  | { art: 'dokument'; id: string }
  /** Zu viele neue Drucksachen für einzelne Zeilen – führt in den Hub. */
  | { art: 'dokumente' }

/** Bis zu so vielen neuen Drucksachen eine Zeile je Dokument, darüber eine Sammelzeile
 *  (der Erstimport brachte über 1.000 auf einmal). */
const EINZELN_BIS = 8
/** Obergrenze für die neuen Drucksachen, die überhaupt geprüft werden. */
const MAX_NEUE_DOKUMENTE = 500

export interface Neuigkeit {
  schluessel: string
  zeit: string
  /** Kurze Rubrik über der Zeile („Zuweisung", „Notiz", …). */
  art: string
  symbol: string
  text: string
  ziel: Ziel
}

export interface Termin {
  schluessel: string
  zeit: string
  symbol: string
  text: string
  /** true = überfällig oder heute, wird hervorgehoben. */
  dringend: boolean
  ziel: Ziel
}

export interface Neuigkeiten {
  /** null = erster Besuch, der Ausgangsstand wurde eben gesetzt. */
  seit: string | null
  neu: Neuigkeit[]
  demnaechst: Termin[]
}

interface KarteZeile {
  id: string
  titel: string
  user_id: string
  zustaendig_user_id: string | null
  zustaendig_seit: string | null
  faellig_am: string | null
  erledigt: boolean
}

function inTagen(tage: number): number {
  return Date.now() + tage * 24 * 60 * 60 * 1000
}

export async function ladeNeuigkeiten(userId: string): Promise<Neuigkeiten> {
  // Beim ersten Besuch gibt es keinen Stand: dann gilt jetzt als Ausgangspunkt
  // und nichts als neu - sonst stünde beim ersten Mal der ganze Bestand da.
  const { data: stand } = await supabase.from('neuigkeiten_stand').select('gesehen_am').eq('user_id', userId).maybeSingle()
  const seit = stand?.gesehen_am ?? null
  if (!seit) await supabase.from('neuigkeiten_stand').insert({ user_id: userId })
  const seitMs = seit ? Date.parse(seit) : Date.now()

  const [kartenErgebnis, platzierungErgebnis, gremienErgebnis] = await Promise.all([
    // RLS (todos_select_own_or_placed) liefert genau die eigenen und die
    // mit mir geteilten Karten.
    supabase.from('todos').select('id, titel, user_id, zustaendig_user_id, zustaendig_seit, faellig_am, erledigt'),
    supabase.from('todo_placements').select('todo_id, erstellt_am').eq('user_id', userId),
    supabase.from('user_gremien').select('gremium').eq('user_id', userId),
  ])
  const karten = (kartenErgebnis.data ?? []) as KarteZeile[]
  const karteById = new Map(karten.map((k) => [k.id, k]))
  const platzierungen = platzierungErgebnis.data ?? []
  const aufMeinemBoard = new Set(platzierungen.map((p) => p.todo_id as string))
  const gremien = (gremienErgebnis.data ?? []).map((g) => g.gremium as string)

  const neu: Neuigkeit[] = []
  const demnaechst: Termin[] = []
  const autorIds = new Set<string>()

  // --- Neu: Zuweisungen und geteilte Karten ---------------------------------
  const zugewiesen = new Set<string>()
  for (const k of karten) {
    if (k.zustaendig_user_id === userId && k.user_id !== userId && k.zustaendig_seit && Date.parse(k.zustaendig_seit) > seitMs) {
      zugewiesen.add(k.id)
      autorIds.add(k.user_id)
    }
  }
  const geteilt = platzierungen.filter((p) => {
    const k = karteById.get(p.todo_id as string)
    return k && k.user_id !== userId && !zugewiesen.has(k.id) && Date.parse(p.erstellt_am as string) > seitMs
  })
  for (const p of geteilt) autorIds.add(karteById.get(p.todo_id as string)!.user_id)

  // --- Neu: Notizen anderer an meinen Karten ---------------------------------
  const { data: notizen } = await supabase
    .from('summaries')
    .select('id, todo_id, user_id, erstellt_am')
    .not('todo_id', 'is', null)
    .neq('user_id', userId)
    .gt('erstellt_am', new Date(seitMs).toISOString())
  for (const n of notizen ?? []) autorIds.add(n.user_id as string)

  // --- Neu: Drucksachen im Hub und Notizen anderer an Dokumenten ---------------
  // RLS liefert nur, was ich sehen darf. Archiviertes (von Hand) zählt nicht.
  // Gemeldet werden nur Drucksachen meiner Gremien (Wunsch 19.10.2026), dafür
  // erst alle neuen laden und unten filtern – der Gremienbezug steht in Tags
  // und Sitzungen, nicht in einer filterbaren Spalte.
  const seitIso = new Date(seitMs).toISOString()
  const [neueDokumente, neueDokNotizen] = await Promise.all([
    supabase
      .from('dokumente')
      .select('id, titel, tags, erstellt_am')
      .is('parent_id', null)
      .is('archiviert_am', null)
      .neq('user_id', userId)
      .gt('erstellt_am', seitIso)
      .order('erstellt_am', { ascending: false })
      .limit(MAX_NEUE_DOKUMENTE),
    supabase
      .from('dokumente')
      .select('id, parent_id, user_id, titel, erstellt_am')
      .not('parent_id', 'is', null)
      .neq('user_id', userId)
      .gt('erstellt_am', seitIso),
  ])
  for (const n of neueDokNotizen.data ?? []) autorIds.add(n.user_id as string)

  // --- Sitzungen meiner Gremien: kommende, mit ihren Tagesordnungspunkten ------
  let kommende: Pick<SessionRow, 'id' | 'titel' | 'gremium' | 'datum'>[] = []
  if (gremien.length > 0) {
    const { data } = await supabase
      .from('sessions')
      .select('id, titel, gremium, datum')
      .in('gremium', gremien)
      .gte('datum', new Date().toISOString())
      .neq('status', 'abgesagt')
      .order('datum')
    kommende = data ?? []
  }
  // Drucksachen, die schon über „neue Tagesordnungspunkte" gemeldet werden.
  const schonAlsTop = new Set<string>()
  const neueTopsJeSitzung = new Map<string, number>()
  const letzterTopJeSitzung = new Map<string, string>()
  const topsJeSitzung = new Map<string, number>()
  for (const ids of inStuecken(kommende.map((s) => s.id))) {
    const { data } = await supabase.from('sitzung_dokumente').select('session_id, dokument_id, erstellt_am').in('session_id', ids)
    for (const z of data ?? []) {
      const sid = z.session_id as string
      topsJeSitzung.set(sid, (topsJeSitzung.get(sid) ?? 0) + 1)
      if (Date.parse(z.erstellt_am as string) > seitMs) {
        if (z.dokument_id) schonAlsTop.add(z.dokument_id as string)
        neueTopsJeSitzung.set(sid, (neueTopsJeSitzung.get(sid) ?? 0) + 1)
        const bisher = letzterTopJeSitzung.get(sid)
        if (!bisher || Date.parse(z.erstellt_am as string) > Date.parse(bisher)) letzterTopJeSitzung.set(sid, z.erstellt_am as string)
      }
    }
  }

  // --- Namen nachladen --------------------------------------------------------
  const { data: profile } =
    autorIds.size > 0
      ? await supabase.from('profiles').select('id, name').in('id', [...autorIds])
      : { data: [] as { id: string; name: string }[] }
  const name = new Map((profile ?? []).map((p) => [p.id, p.name]))
  const wer = (id: string) => name.get(id) ?? 'Jemand'

  for (const id of zugewiesen) {
    const k = karteById.get(id)!
    neu.push({
      schluessel: `zuweisung-${id}`,
      art: 'Zuweisung',
      zeit: k.zustaendig_seit!,
      symbol: '👤',
      text: `${wer(k.user_id)} hat dir „${k.titel}" zugewiesen`,
      ziel: { art: 'todo', id },
    })
  }
  for (const p of geteilt) {
    const k = karteById.get(p.todo_id as string)!
    neu.push({
      schluessel: `geteilt-${k.id}`,
      art: 'Geteilt',
      zeit: p.erstellt_am as string,
      symbol: '🔗',
      text: `${wer(k.user_id)} hat „${k.titel}" mit dir geteilt`,
      ziel: { art: 'todo', id: k.id },
    })
  }
  // Mehrere Notizen an derselben Karte zu einer Zeile zusammenfassen.
  const notizenJeKarte = new Map<string, { anzahl: number; zeit: string; autoren: Set<string> }>()
  for (const n of notizen ?? []) {
    const eintrag = notizenJeKarte.get(n.todo_id as string) ?? { anzahl: 0, zeit: n.erstellt_am as string, autoren: new Set() }
    eintrag.anzahl++
    if (Date.parse(n.erstellt_am as string) > Date.parse(eintrag.zeit)) eintrag.zeit = n.erstellt_am as string
    eintrag.autoren.add(wer(n.user_id as string))
    notizenJeKarte.set(n.todo_id as string, eintrag)
  }
  for (const [todoId, e] of notizenJeKarte) {
    const k = karteById.get(todoId)
    if (!k) continue
    neu.push({
      schluessel: `notiz-${todoId}`,
      art: 'Notiz',
      zeit: e.zeit,
      symbol: '📝',
      text: `${[...e.autoren].join(', ')}: ${e.anzahl === 1 ? 'neue Notiz' : `${e.anzahl} neue Notizen`} an „${k.titel}"`,
      ziel: { art: 'todo', id: todoId },
    })
  }
  for (const s of kommende) {
    const anzahl = neueTopsJeSitzung.get(s.id)
    if (!anzahl) continue
    const alle = topsJeSitzung.get(s.id) ?? anzahl
    neu.push({
      schluessel: `tagesordnung-${s.id}`,
      art: 'Tagesordnung',
      zeit: letzterTopJeSitzung.get(s.id)!,
      symbol: '📋',
      text:
        anzahl === alle
          ? `Tagesordnung für ${s.gremium} am ${new Date(s.datum).toLocaleDateString('de-DE')} ist da (${alle} Punkte)`
          : `${anzahl} neue Tagesordnungspunkte für ${s.gremium} am ${new Date(s.datum).toLocaleDateString('de-DE')}`,
      ziel: { art: 'sitzung', id: s.id },
    })
  }
  // Zu meinen Gremien gehört eine Drucksache, wenn sie einen Tag mit dem Namen
  // eines meiner Gremien trägt (so vergibt dailyallris die Gremien-Tags) oder
  // mit einer Sitzung eines meiner Gremien verknüpft ist.
  const meineGremien = new Set(gremien)
  const kandidaten = (neueDokumente.data ?? []).filter((d) => !schonAlsTop.has(d.id as string))
  const ueberSitzung = new Set<string>()
  const ohneTag = kandidaten.filter((d) => !(d.tags as string[]).some((t) => meineGremien.has(t))).map((d) => d.id as string)
  for (const ids of inStuecken(ohneTag)) {
    const { data } = await supabase.from('sitzung_dokumente').select('dokument_id, sessions(gremium)').in('dokument_id', ids)
    for (const z of (data ?? []) as unknown as { dokument_id: string; sessions: { gremium: string | null } | null }[]) {
      if (z.sessions?.gremium && meineGremien.has(z.sessions.gremium)) ueberSitzung.add(z.dokument_id)
    }
  }
  const dokumentZeilen = kandidaten.filter(
    (d) => (d.tags as string[]).some((t) => meineGremien.has(t)) || ueberSitzung.has(d.id as string),
  )
  const dokumentAnzahl = dokumentZeilen.length
  if (dokumentAnzahl > EINZELN_BIS) {
    neu.push({
      schluessel: 'dokumente-sammel',
      art: 'Drucksachen',
      zeit: dokumentZeilen[0].erstellt_am as string,
      symbol: '📄',
      text: `${dokumentAnzahl} neue Drucksachen zu deinen Gremien`,
      ziel: { art: 'dokumente' },
    })
  } else {
    for (const d of dokumentZeilen) {
      neu.push({
        schluessel: `dokument-${d.id}`,
        art: 'Drucksache',
        zeit: d.erstellt_am as string,
        symbol: '📄',
        text: d.titel as string,
        ziel: { art: 'dokument', id: d.id as string },
      })
    }
  }
  // Notizen anderer an Dokumenten, je Dokument eine Zeile. Den Titel des
  // Dokuments nachladen – die Notiz selbst trägt nur ihren eigenen.
  const notizenJeDokument = new Map<string, { anzahl: number; zeit: string; autoren: Set<string> }>()
  for (const n of neueDokNotizen.data ?? []) {
    const pid = n.parent_id as string
    const e = notizenJeDokument.get(pid) ?? { anzahl: 0, zeit: n.erstellt_am as string, autoren: new Set<string>() }
    e.anzahl++
    if (Date.parse(n.erstellt_am as string) > Date.parse(e.zeit)) e.zeit = n.erstellt_am as string
    e.autoren.add(wer(n.user_id as string))
    notizenJeDokument.set(pid, e)
  }
  const dokTitel = new Map<string, string>()
  for (const ids of inStuecken([...notizenJeDokument.keys()])) {
    const { data } = await supabase.from('dokumente').select('id, titel').in('id', ids)
    for (const d of data ?? []) dokTitel.set(d.id as string, d.titel as string)
  }
  for (const [pid, e] of notizenJeDokument) {
    neu.push({
      schluessel: `dokument-notiz-${pid}`,
      art: 'Notiz',
      zeit: e.zeit,
      symbol: '📝',
      text: `${[...e.autoren].join(', ')}: ${e.anzahl === 1 ? 'neue Notiz' : `${e.anzahl} neue Notizen`} an „${dokTitel.get(pid) ?? 'Dokument'}"`,
      ziel: { art: 'dokument', id: pid },
    })
  }

  neu.sort((a, b) => Date.parse(b.zeit) - Date.parse(a.zeit))

  // --- Demnächst: Sitzungen und fällige Aufgaben ------------------------------
  const heuteEnde = new Date()
  heuteEnde.setHours(23, 59, 59, 999)
  for (const s of kommende) {
    if (Date.parse(s.datum) > inTagen(TAGE_SITZUNGEN)) break
    const tops = topsJeSitzung.get(s.id)
    demnaechst.push({
      schluessel: `sitzung-${s.id}`,
      zeit: s.datum,
      symbol: '🗳️',
      text: `${s.gremium}${tops ? ` · ${tops} Tagesordnungspunkte` : ' · noch keine Tagesordnung'}`,
      dringend: Date.parse(s.datum) <= heuteEnde.getTime(),
      ziel: { art: 'sitzung', id: s.id },
    })
  }
  for (const k of karten) {
    if (k.erledigt || !k.faellig_am || !aufMeinemBoard.has(k.id)) continue
    // faellig_am ist ein reines Datum: als Tagesende lesen, sonst wäre eine
    // heute fällige Karte ab Mitternacht "überfällig".
    const faellig = Date.parse(`${k.faellig_am}T23:59:59`)
    if (faellig > inTagen(TAGE_AUFGABEN)) continue
    const ueberfaellig = faellig < Date.now()
    demnaechst.push({
      schluessel: `aufgabe-${k.id}`,
      zeit: `${k.faellig_am}T23:59:59`,
      symbol: ueberfaellig ? '⚠️' : '✅',
      text: `${ueberfaellig ? 'Überfällig' : 'Fällig'}: ${k.titel}`,
      dringend: faellig <= heuteEnde.getTime(),
      ziel: { art: 'todo', id: k.id },
    })
  }
  demnaechst.sort((a, b) => Date.parse(a.zeit) - Date.parse(b.zeit))

  return { seit, neu, demnaechst }
}

/** "Alles gesehen": ab jetzt gilt nur noch Späteres als neu. */
export async function neuigkeitenGesehen(userId: string): Promise<string | null> {
  const { error } = await supabase
    .from('neuigkeiten_stand')
    .upsert({ user_id: userId, gesehen_am: new Date().toISOString() })
  return error?.message ?? null
}
