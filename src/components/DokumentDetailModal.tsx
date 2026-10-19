import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Archive, ArchiveRestore, Columns2, FileText, Link2, PanelLeft, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { DOKUMENT_SPALTEN } from '../lib/dokumentSpalten'
import type { DokumentRow, DokumentSichtbarkeit, Profile, SessionRow, TodoRow } from '../lib/types'
import { EBENE_COLOR, EBENE_LABEL, tagColor } from '../lib/sourceColors'
import { formatDate, formatDateTime, startOfTodayIso } from '../lib/format'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import { fileNameFromPath } from '../lib/dateien'
import { useLoeschDialog } from './LoeschDialog'
import { VorlageAnsicht } from './VorlageAnsicht'
import { TagEditor } from './TagEditor'
import { SichtbarkeitEditor } from './SichtbarkeitEditor'
import { istNotizUngelesen, markiereGelesen, markiereUngelesen } from '../lib/dokumenteGelesen'

const TAG_VORSCHLAEGE = ['Einschätzung', 'Analyse', 'Redebeitrag']

/**
 * Detailansicht eines Dokuments aus dem Dokumenten-Hub: zeigt das
 * Original-Dokument (Titel, Tags, Ebene, Link/Vorschau) und darunter alle
 * daran angehängten Notizen/Analysen ("Kinder", dokumente.parent_id = diese
 * id) - eigene UND für den Nutzer sichtbare fremde (Ebene-weit oder per
 * dokument_shares individuell geteilt). Ersetzt die frühere separate "Meine
 * Dokumente"-Ansicht: persönliche Analysen entstehen jetzt direkt hier,
 * verknüpft mit der Sitzungsvorlage, zu der sie gehören (siehe
 * docs/CHANGELOG.md). RLS (0033/0034_dokumente*.sql) filtert die
 * Kinder-Liste automatisch auf das für den Nutzer Sichtbare - anders als im
 * MCP-Server läuft die Web-UI mit der Session des Nutzers, RLS greift hier
 * also tatsächlich.
 */
/** Zwei Leselayouts: 'a' = Dokument und Notizen nebeneinander, 'c' =
 *  Lesemodus (Dokument breit, Notizen einklappbar). Das frühere 'b' mit der
 *  Tagesordnung links ist seit dem UI-Umbau (18.10.2026) die Sitzungsansicht
 *  auf /sitzungen selbst; ein gemerktes 'b' gilt als 'a'. */
export type LeseVariante = 'a' | 'c'

const VARIANTE_KEY_HUB = 'mc.dokument.variante'

function ladeVariante(schluessel: string, standard: LeseVariante): LeseVariante {
  try {
    const wert = window.localStorage.getItem(schluessel)
    return wert === 'a' || wert === 'c' ? wert : standard
  } catch {
    return standard
  }
}

function speichereVariante(schluessel: string, wert: LeseVariante) {
  try {
    window.localStorage.setItem(schluessel, wert)
  } catch {
    // Reine Anzeige-Vorliebe - ein gesperrter Storage ist kein Fehlerfall.
  }
}

export function DokumentDetailModal({
  document,
  onClose,
  onDeleted,
  eingebettet = false,
  onGelesenGeaendert,
}: {
  document: DokumentRow
  onClose: () => void
  onDeleted: () => void
  /** Ohne Overlay, ohne Schließen und ohne Layout-Umschalter direkt in eine
   *  umgebende Fläche gerendert – die Sitzungsansicht (TerminDetailPanel,
   *  layout="eingebettet") zeigt einen Tagesordnungspunkt so neben der
   *  Tagesordnung, statt ein Fenster darüberzulegen. Füllt die Höhe des
   *  Elternelements. */
  eingebettet?: boolean
  /** Nach dem Lesestand-Wechsel (beim Öffnen und von Hand) – damit eine
   *  danebenstehende Liste ihren Punkt „ungelesen" nachzieht. */
  onGelesenGeaendert?: () => void
}) {
  const [variante, setVariante] = useState<LeseVariante>(() => (eingebettet ? 'a' : ladeVariante(VARIANTE_KEY_HUB, 'a')))
  const [notizenOffen, setNotizenOffen] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [myProfile, setMyProfile] = useState<Profile | null>(null)
  const [children, setChildren] = useState<DokumentRow[]>([])
  const [authorNames, setAuthorNames] = useState<Map<string, string>>(new Map())
  const [shareNamesByChild, setShareNamesByChild] = useState<Map<string, string[]>>(new Map())
  const [shareIdsByChild, setShareIdsByChild] = useState<Map<string, string[]>>(new Map())
  const [candidates, setCandidates] = useState<Profile[]>([])

  const [previewDoc, setPreviewDoc] = useState<{ path: string; name: string } | null>(null)

  // Verknüpfte Sitzung (1:n, dokumente.session_id - 0036_dokumente_session.sql)
  // und verknüpfte ToDos (n:m über todo_dokumente - 0037_todo_dokumente.sql).
  // Mehrere Sitzungen je Dokument (0042_sitzung_dokumente.sql): eine Vorlage
  // läuft meist erst durch den Fachausschuss und dann durch den Rat.
  const [linkedSessions, setLinkedSessions] = useState<SessionRow[]>([])
  const [ownSessions, setOwnSessions] = useState<SessionRow[]>([])
  const [savingSession, setSavingSession] = useState(false)
  const [linkedTodos, setLinkedTodos] = useState<TodoRow[]>([])
  const [todoSearch, setTodoSearch] = useState('')
  const [todoSearchResults, setTodoSearchResults] = useState<TodoRow[]>([])
  const [todoDropdownOpen, setTodoDropdownOpen] = useState(false)
  const [linkTodoError, setLinkTodoError] = useState<string | null>(null)

  // Lokaler Spiegel der Top-Level-Tags: document ist eine unveränderliche
  // Prop (siehe Dokumente.tsx), Tag-Änderungen brauchen aber sofortiges
  // visuelles Feedback in dieser Sitzung - sicher, weil Dokumente.tsx diese
  // Komponente beim Wechsel auf ein anderes Dokument immer erst unmountet
  // (openDoc geht durch null), nie direkt mit neuer document-Prop remountet.
  const [docTags, setDocTags] = useState<string[]>(document.tags)
  // Manuelles Archivieren (0038_dokumente_archiv.sql), ebenfalls als lokaler
  // Spiegel. Die zweite, automatische Archiv-Regel (verknüpfte Sitzung ist
  // vorbei) steht nicht in der Spalte, sondern wird aus linkedSession
  // abgeleitet - siehe src/lib/dokumenteArchiv.ts.
  const [archiviertAm, setArchiviertAm] = useState<string | null>(document.archiviert_am)
  const [savingArchiv, setSavingArchiv] = useState(false)

  // Manuelles Gelesen/Ungelesen (zusätzlich zum automatischen Markieren beim
  // Öffnen, siehe useEffect unten) - initial true, weil das Öffnen ohnehin
  // sofort automatisch markiert.
  const [istGelesen, setIstGelesen] = useState(true)

  // Nachträgliches Bearbeiten der Sichtbarkeit/Freigabe einer eigenen Notiz.
  const [editingChildId, setEditingChildId] = useState<string | null>(null)
  const [editSichtbarkeit, setEditSichtbarkeit] = useState<DokumentSichtbarkeit>('persoenlich')
  const [editTeilenMit, setEditTeilenMit] = useState<string[]>([])
  const [editSaving, setEditSaving] = useState(false)
  const [editShareError, setEditShareError] = useState<string | null>(null)

  // Zeitstempel VOR dem Markieren-als-gelesen (siehe useEffect unten) - damit
  // Notizen, die seit dem letzten Öffnen neu dazugekommen sind, für die Dauer
  // dieser Modal-Sitzung noch fett bleiben (wie bei einem Mailprogramm),
  // obwohl im Hintergrund direkt der neue Gelesen-Zeitstempel gespeichert wird.
  const [gelesenAmVorDiesemOeffnen, setGelesenAmVorDiesemOeffnen] = useState<string | undefined>(undefined)

  const [newTitel, setNewTitel] = useState('')
  const [newInhalt, setNewInhalt] = useState('')
  const [newTags, setNewTags] = useState<string[]>([])
  const [newSichtbarkeit, setNewSichtbarkeit] = useState<DokumentSichtbarkeit>('persoenlich')
  const [teilenMit, setTeilenMit] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Löschen ist nur noch hier möglich (nicht mehr in der Listenansicht) und
  // läuft über einen ausdrücklichen Bestätigungsdialog. Bei einem Dokument,
  // das andere sehen, wird zusätzlich eine Checkbox verlangt: der Löschvorgang
  // trifft dann nicht nur den eigenen Bestand, und parent_id kaskadiert
  // (0034_dokumente_kommentare.sql) auch alle daran hängenden fremden Notizen.
  const { fragen: loeschRueckfrage, dialog: loeschDialog } = useLoeschDialog()
  // Tags, Sitzung und ToDo-Verknüpfungen sind im Lesebetrieb nur Chips im
  // Kopfband; die Eingabefelder dafür klappen bei Bedarf darunter auf. Sonst
  // nimmt die Verwaltung des Dokuments den Platz weg, den das Lesen braucht.
  const [verknuepfungenOffen, setVerknuepfungenOffen] = useState(false)
  /** Namen, mit denen DIESES Top-Level-Dokument per 'einzelpersonen' geteilt ist. */
  const [ownShareNames, setOwnShareNames] = useState<string[]>([])

  async function loadChildren() {
    const { data } = await supabase
      .from('dokumente')
      .select(DOKUMENT_SPALTEN)
      .eq('parent_id', document.id)
      .order('erstellt_am', { ascending: false })
    setChildren(data ?? [])
  }

  async function loadLinkedSessions() {
    const { data: links } = await supabase
      .from('sitzung_dokumente')
      .select('session_id')
      .eq('dokument_id', document.id)
    const ids = (links ?? []).map((l) => l.session_id as string)
    if (ids.length === 0) {
      setLinkedSessions([])
      return
    }
    const { data } = await supabase.from('sessions').select('*').in('id', ids).order('datum')
    setLinkedSessions(data ?? [])
  }

  // RLS auf todo_dokumente/todos filtert bereits auf das für den Nutzer
  // Sichtbare (siehe 0037_todo_dokumente.sql) - die Web-UI läuft mit der
  // echten Nutzer-Session.
  async function loadLinkedTodos() {
    const { data: links } = await supabase.from('todo_dokumente').select('todo_id').eq('dokument_id', document.id)
    const ids = (links ?? []).map((l) => l.todo_id as string)
    if (ids.length === 0) {
      setLinkedTodos([])
      return
    }
    const { data } = await supabase.from('todos').select('*').in('id', ids).order('created_at', { ascending: false })
    setLinkedTodos(data ?? [])
  }

  async function handleToggleArchiv() {
    setSavingArchiv(true)
    const neuerWert = archiviertAm ? null : new Date().toISOString()
    const { error } = await supabase.from('dokumente').update({ archiviert_am: neuerWert }).eq('id', document.id)
    setSavingArchiv(false)
    if (!error) setArchiviertAm(neuerWert)
  }

  async function handleLinkSession(sessionId: string) {
    if (!sessionId) return
    setSavingSession(true)
    // Idempotent: dieselbe Verknüpfung zweimal anzulegen ist kein Fehler.
    const { error } = await supabase
      .from('sitzung_dokumente')
      .upsert({ dokument_id: document.id, session_id: sessionId }, { onConflict: 'session_id,dokument_id', ignoreDuplicates: true })
    setSavingSession(false)
    if (!error) await loadLinkedSessions()
  }

  async function handleUnlinkSession(sessionId: string) {
    setSavingSession(true)
    const { error } = await supabase
      .from('sitzung_dokumente')
      .delete()
      .eq('dokument_id', document.id)
      .eq('session_id', sessionId)
    setSavingSession(false)
    if (!error) await loadLinkedSessions()
  }

  async function handleSearchTodos(query: string) {
    setTodoSearch(query)
    if (!query.trim() || !userId) {
      setTodoSearchResults([])
      return
    }
    // Eigene ToDos reichen hier aus (RLS todos_select_own_or_placed würde
    // ohnehin auch mit geteilten Karten antworten, aber Verknüpfen von hier
    // aus macht am ehesten für die eigenen Karten Sinn).
    const { data } = await supabase
      .from('todos')
      .select('*')
      .eq('user_id', userId)
      .ilike('titel', `%${query.trim()}%`)
      .limit(8)
    setTodoSearchResults((data ?? []).filter((t) => !linkedTodos.some((lt) => lt.id === t.id)))
  }

  async function handleLinkTodo(todoId: string) {
    setLinkTodoError(null)
    const { error } = await supabase.from('todo_dokumente').insert({ todo_id: todoId, dokument_id: document.id })
    if (error) {
      setLinkTodoError(error.message)
      return
    }
    setTodoSearch('')
    setTodoSearchResults([])
    await loadLinkedTodos()
  }

  async function handleUnlinkTodo(todoId: string) {
    await supabase.from('todo_dokumente').delete().eq('todo_id', todoId).eq('dokument_id', document.id)
    await loadLinkedTodos()
  }

  useEffect(() => {
    loadLinkedSessions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.id])

  useEffect(() => {
    loadChildren()
    loadLinkedTodos()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      const { data: profileRow } = await supabase.from('profiles').select('*').eq('id', data.user.id).single()
      setMyProfile(profileRow)

      const { data: mine } = await supabase.from('user_gremien').select('gremium').eq('user_id', data.user.id)
      const gremien = (mine ?? []).map((g) => g.gremium)
      if (gremien.length > 0) {
        const { data: sessions } = await supabase.from('sessions').select('*').in('gremium', gremien).order('datum')
        setOwnSessions(sessions ?? [])
      }

      const { data: gelesenRows } = await supabase
        .from('dokument_gelesen')
        .select('gelesen_am')
        .eq('dokument_id', document.id)
        .eq('user_id', data.user.id)
      setGelesenAmVorDiesemOeffnen(gelesenRows?.[0]?.gelesen_am)

      await markiereGelesen(supabase, document.id, data.user.id)
      onGelesenGeaendert?.()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.id])

  // Autor-Namen für fremde Kinder + Namen der Personen, mit denen die
  // eigenen "einzelpersonen"-Kinder konkret geteilt sind.
  useEffect(() => {
    const fremdeIds = Array.from(new Set(children.filter((c) => c.user_id !== userId).map((c) => c.user_id)))
    if (fremdeIds.length > 0) {
      supabase
        .from('profiles')
        .select('id, name')
        .in('id', fremdeIds)
        .then(({ data }) => setAuthorNames(new Map((data ?? []).map((p) => [p.id as string, p.name as string]))))
    } else {
      setAuthorNames(new Map())
    }

    // Für die Löschwarnung: mit wem genau dieses Dokument geteilt ist
    // (nur relevant bei sichtbarkeit='einzelpersonen', bei 'geteilt' ergibt
    // sich der Kreis aus Ebene/Gliederung).
    if (document.sichtbarkeit === 'einzelpersonen') {
      supabase
        .from('dokument_shares')
        .select('user_id')
        .eq('dokument_id', document.id)
        .then(async ({ data: shares }) => {
          const userIds = Array.from(new Set((shares ?? []).map((sh) => sh.user_id as string)))
          if (userIds.length === 0) {
            setOwnShareNames([])
            return
          }
          const { data: profs } = await supabase.from('profiles').select('id, name').in('id', userIds)
          const nameById = new Map((profs ?? []).map((pr) => [pr.id as string, pr.name as string]))
          setOwnShareNames(userIds.map((uid) => nameById.get(uid) ?? '…'))
        })
    } else {
      setOwnShareNames([])
    }

    const eigeneEinzelpersonenIds = children.filter((c) => c.user_id === userId && c.sichtbarkeit === 'einzelpersonen').map((c) => c.id)
    if (eigeneEinzelpersonenIds.length > 0) {
      supabase
        .from('dokument_shares')
        .select('dokument_id, user_id')
        .in('dokument_id', eigeneEinzelpersonenIds)
        .then(async ({ data: shares }) => {
          const userIds = Array.from(new Set((shares ?? []).map((s) => s.user_id as string)))
          const { data: profs } = userIds.length > 0 ? await supabase.from('profiles').select('id, name').in('id', userIds) : { data: [] }
          const nameById = new Map((profs ?? []).map((p) => [p.id as string, p.name as string]))
          const byChildNames = new Map<string, string[]>()
          const byChildIds = new Map<string, string[]>()
          for (const s of shares ?? []) {
            const namesList = byChildNames.get(s.dokument_id as string) ?? []
            namesList.push(nameById.get(s.user_id as string) ?? '…')
            byChildNames.set(s.dokument_id as string, namesList)
            const idsList = byChildIds.get(s.dokument_id as string) ?? []
            idsList.push(s.user_id as string)
            byChildIds.set(s.dokument_id as string, idsList)
          }
          setShareNamesByChild(byChildNames)
          setShareIdsByChild(byChildIds)
        })
    } else {
      setShareNamesByChild(new Map())
      setShareIdsByChild(new Map())
    }
  }, [children, userId, document.id, document.sichtbarkeit])

  // Kandidaten für "Einzelne Personen": gleiche Partei, mindestens eine
  // gemeinsame Ebene - profiles_select_same_partei_ebene (0020) begrenzt die
  // Treffer serverseitig ohnehin schon darauf.
  useEffect(() => {
    if (!myProfile?.partei || !userId) {
      setCandidates([])
      return
    }
    supabase
      .from('profiles')
      .select('*')
      .neq('id', userId)
      .then(({ data }) => {
        setCandidates(
          (data ?? []).filter(
            (p: Profile) =>
              !p.technisch &&
              p.partei === myProfile.partei &&
              (p.ebenen ?? []).some((e) => (myProfile.ebenen ?? []).includes(e)),
          ),
        )
      })
  }, [myProfile, userId])

  function resetForm() {
    setNewTitel('')
    setNewInhalt('')
    setNewTags([])
    setNewSichtbarkeit('persoenlich')
    setTeilenMit([])
    setFormError(null)
  }

  async function handleAddChild(e: FormEvent) {
    e.preventDefault()
    if (!userId) return
    if (!newTitel.trim()) {
      setFormError('Titel ist erforderlich.')
      return
    }
    // Seit 0052_uploads_sperren.sql nur noch Text - Dateien bringt allein der ALLRIS-Import.
    if (!newInhalt.trim()) {
      setFormError('Notiz ist erforderlich.')
      return
    }
    if (newSichtbarkeit === 'einzelpersonen' && teilenMit.length === 0) {
      setFormError('Mindestens eine Person auswählen.')
      return
    }

    setSaving(true)
    setFormError(null)

    const ebene = newSichtbarkeit === 'geteilt' ? document.ebene : null
    const gliederung = newSichtbarkeit === 'geteilt' ? document.gliederung : null

    const { data: child, error } = await supabase
      .from('dokumente')
      .insert({
        user_id: userId,
        parent_id: document.id,
        titel: newTitel.trim(),
        sichtbarkeit: newSichtbarkeit,
        ebene,
        gliederung,
        tags: newTags,
        inhalt: newInhalt.trim() || null,
      })
      .select('id')
      .single()
    if (error || !child) {
      setFormError(error?.message ?? 'Fehler beim Speichern.')
      setSaving(false)
      return
    }

    if (newSichtbarkeit === 'einzelpersonen' && teilenMit.length > 0) {
      await supabase.from('dokument_shares').insert(teilenMit.map((uid) => ({ dokument_id: child.id, user_id: uid })))
    }

    resetForm()
    setSaving(false)
    await loadChildren()
  }

  /** Folgen einer Notiz-Löschung für andere - undefined = betrifft nur mich. */
  function notizFolgen(c: DokumentRow): string[] | undefined {
    if (c.sichtbarkeit === 'geteilt') {
      return [
        `Sie ist für alle Mitglieder deiner Partei auf Ebene ${EBENE_LABEL[c.ebene ?? ''] ?? c.ebene}${
          c.gliederung ? ` (${c.gliederung})` : ''
        } sichtbar und verschwindet für alle.`,
        'Das lässt sich nicht rückgängig machen.',
      ]
    }
    const namen = shareNamesByChild.get(c.id) ?? []
    if (c.sichtbarkeit === 'einzelpersonen' && namen.length > 0) {
      return [`Sie ist geteilt mit ${namen.join(', ')} und verschwindet auch dort.`, 'Das lässt sich nicht rückgängig machen.']
    }
    return undefined
  }

  async function handleDeleteChild(c: DokumentRow) {
    if (c.datei_url) await supabase.storage.from('dokumente').remove([c.datei_url])
    await supabase.from('dokumente').delete().eq('id', c.id)
    await loadChildren()
  }

  async function handleDeleteDocument() {
    if (document.datei_url) await supabase.storage.from('dokumente').remove([document.datei_url])
    await supabase.from('dokumente').delete().eq('id', document.id)
    onDeleted()
  }

  async function toggleGelesen() {
    if (!userId) return
    if (istGelesen) {
      await markiereUngelesen(supabase, document.id, userId)
      setIstGelesen(false)
    } else {
      await markiereGelesen(supabase, document.id, userId)
      setIstGelesen(true)
    }
    onGelesenGeaendert?.()
  }

  async function handleUpdateTopLevelTags(tags: string[]) {
    setDocTags(tags)
    await supabase.from('dokumente').update({ tags }).eq('id', document.id)
  }

  async function handleUpdateChildTags(childId: string, tags: string[]) {
    setChildren((prev) => prev.map((c) => (c.id === childId ? { ...c, tags } : c)))
    await supabase.from('dokumente').update({ tags }).eq('id', childId)
  }

  function startEditSharing(c: DokumentRow) {
    setEditingChildId(c.id)
    setEditSichtbarkeit(c.sichtbarkeit)
    setEditTeilenMit(shareIdsByChild.get(c.id) ?? [])
    setEditShareError(null)
  }

  async function saveEditSharing(c: DokumentRow) {
    if (editSichtbarkeit === 'einzelpersonen' && editTeilenMit.length === 0) {
      setEditShareError('Mindestens eine Person auswählen.')
      return
    }
    setEditSaving(true)
    setEditShareError(null)

    const ebene = editSichtbarkeit === 'geteilt' ? document.ebene : null
    const gliederung = editSichtbarkeit === 'geteilt' ? document.gliederung : null

    await supabase.from('dokumente').update({ sichtbarkeit: editSichtbarkeit, ebene, gliederung }).eq('id', c.id)
    await supabase.from('dokument_shares').delete().eq('dokument_id', c.id)
    if (editSichtbarkeit === 'einzelpersonen' && editTeilenMit.length > 0) {
      await supabase.from('dokument_shares').insert(editTeilenMit.map((uid) => ({ dokument_id: c.id, user_id: uid })))
    }

    setEditSaving(false)
    setEditingChildId(null)
    await loadChildren()
  }

  function sichtbarkeitLabel(c: DokumentRow): string {
    if (c.sichtbarkeit === 'persoenlich') return 'Persönlich'
    if (c.sichtbarkeit === 'geteilt') return `Ganze Ebene${c.ebene ? ` (${EBENE_LABEL[c.ebene]}${c.gliederung ? ` ${c.gliederung}` : ''})` : ''}`
    const namen = shareNamesByChild.get(c.id) ?? []
    return namen.length > 0 ? `Geteilt mit ${namen.join(', ')}` : 'Einzelne Personen'
  }

  // Nur die automatische Regel, ohne archiviert_am - für den Hinweistext am
  // Archivieren-Knopf (dieselbe Bedingung wie archivGrund() === 'sitzung' in
  // src/lib/dokumenteArchiv.ts, hier auf der bereits geladenen Sitzung).
  // Erst archiviert, wenn die LETZTE verknüpfte Sitzung vorbei ist - solange
  // der Rat noch entscheidet, gehört die Vorlage in die Arbeitsliste
  // (gleiche Regel wie archivGrund() in src/lib/dokumenteArchiv.ts).
  const letzteSitzung = linkedSessions.length > 0
    ? Math.max(...linkedSessions.map((si) => Date.parse(si.datum)))
    : null
  const durchSitzungArchiviert = letzteSitzung !== null && letzteSitzung < Date.parse(startOfTodayIso())

  // Wen trifft das Löschen außer mir? 'geteilt' erreicht die ganze Ebene,
  // 'einzelpersonen' die namentlich Freigegebenen. Nur bei 'persoenlich'
  // (möglich bei Notizen) betrifft es niemanden sonst.
  const geteiltMitAnderen =
    document.sichtbarkeit === 'geteilt' || (document.sichtbarkeit === 'einzelpersonen' && ownShareNames.length > 0)
  // Fremde Notizen, die durch das ON-DELETE-CASCADE auf parent_id mitgehen
  // (0034_dokumente_kommentare.sql). RLS zeigt nur die für mich sichtbaren -
  // es können also mehr sein, deshalb "mindestens".
  const fremdeNotizen = children.filter((c) => c.user_id !== userId).length

  const varianten: { wert: LeseVariante; icon: typeof Columns2; titel: string }[] = [
    { wert: 'a', icon: Columns2, titel: 'Zwei Spalten: Dokument und Notizen' },
    { wert: 'c', icon: PanelLeft, titel: 'Lesemodus: Dokument breit, Notizen einklappbar' },
  ]

  function waehleVariante(wert: LeseVariante) {
    setVariante(wert)
    speichereVariante(VARIANTE_KEY_HUB, wert)
    if (wert !== 'c') setNotizenOffen(true)
  }

  // Eigene Variable, weil der Übersichts-Modus alle Dokument-Aktionen
  // ausblendet, das Schließen aber bleiben muss.
  const schliessenKnopf = eingebettet ? null : (
    <button type="button" onClick={onClose} aria-label="Schließen" title="Schließen" className="mc-btn-ghost p-2!">
      <X size={18} />
    </button>
  )

  const kopfAktionen = (
    <>
      <div className={`mr-1 hidden items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 ${eingebettet ? '' : 'sm:flex'}`}>
        {varianten.map(({ wert, icon: Icon, titel }) => (
          <button
            key={wert}
            type="button"
            onClick={() => waehleVariante(wert)}
            aria-pressed={variante === wert}
            title={titel}
            className={`rounded-md p-1.5 transition-colors ${
              variante === wert ? 'bg-white text-primary shadow-xs' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Icon size={15} />
          </button>
        ))}
      </div>
      {variante === 'c' && (
        <button
          type="button"
          onClick={() => setNotizenOffen((v) => !v)}
          className="mc-btn-ghost gap-1.5! px-2.5! py-1.5! text-xs!"
        >
          {notizenOffen ? 'Notizen ausblenden' : 'Notizen'}
        </button>
      )}
      {document.datei_url && (
        <button
          type="button"
          onClick={() => setPreviewDoc({ path: document.datei_url!, name: fileNameFromPath(document.datei_url!) })}
          title={`Original-PDF öffnen: ${fileNameFromPath(document.datei_url)}`}
          className="mc-btn-ghost gap-1.5! px-2.5! py-1.5! text-xs! text-primary!"
        >
          <FileText size={14} />
          <span className="hidden sm:inline">Original-PDF</span>
        </button>
      )}
      {document.user_id === userId && (
        <button
          type="button"
          onClick={handleToggleArchiv}
          disabled={savingArchiv}
          title={
            archiviertAm
              ? durchSitzungArchiviert
                ? 'Zurückholen - bleibt wegen der vergangenen Sitzung trotzdem im Archiv'
                : 'Zurück in die Dokumentenliste holen'
              : durchSitzungArchiviert
                ? 'Liegt wegen der vergangenen Sitzung bereits im Archiv - zusätzlich dauerhaft archivieren'
                : 'Ins Archiv legen'
          }
          className="mc-btn-ghost gap-1.5! px-2.5! py-1.5! text-xs!"
        >
          {archiviertAm ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          <span className="hidden sm:inline">{archiviertAm ? 'Im Archiv' : 'Archivieren'}</span>
        </button>
      )}
      {/* Im Archiv gilt das Dokument ohnehin als gelesen (dokumenteGelesen.ts). */}
      {!(durchSitzungArchiviert || archiviertAm) && (
      <button
        type="button"
        onClick={toggleGelesen}
        aria-label={istGelesen ? 'Als ungelesen markieren' : 'Als gelesen markieren'}
        title={istGelesen ? 'Als ungelesen markieren' : 'Als gelesen markieren'}
        className="mc-btn-ghost gap-1.5! px-2.5! py-1.5! text-xs!"
      >
        <span className={`h-2 w-2 rounded-full ${istGelesen ? 'bg-slate-300' : 'bg-primary'}`} />
        <span className="hidden sm:inline">{istGelesen ? 'Gelesen' : 'Ungelesen'}</span>
      </button>
      )}
      {document.user_id === userId && (
        <button
          type="button"
          onClick={() =>
            loeschRueckfrage({
              titel: document.titel,
              was: 'Das Dokument',
              folgen: geteiltMitAnderen
                ? [
                    document.sichtbarkeit === 'geteilt'
                      ? `Es ist für alle Mitglieder deiner Partei auf Ebene ${EBENE_LABEL[document.ebene ?? ''] ?? document.ebene}${
                          document.gliederung ? ` (${document.gliederung})` : ''
                        } freigegeben und verschwindet für alle.`
                      : `Es ist geteilt mit ${ownShareNames.join(', ')} und verschwindet auch dort.`,
                    ...(fremdeNotizen > 0
                      ? [
                          `Mitgelöscht werden alle daran hängenden Notizen, darunter mindestens ${fremdeNotizen} von anderen Personen.`,
                        ]
                      : []),
                    'Das lässt sich nicht rückgängig machen.',
                  ]
                : undefined,
              bestaetigungsText: 'Ja, ich möchte dieses Dokument für alle löschen.',
              ausfuehren: handleDeleteDocument,
            })
          }
          aria-label="Löschen"
          title="Löschen"
          className="mc-btn-ghost p-2! text-slate-500 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={17} />
        </button>
      )}
      {schliessenKnopf}
    </>
  )

  const notizenSpalte = (
    <>
      <h2 className="mb-2 font-semibold">Meine Notizen &amp; Dokumente</h2>
      <ul className="mb-4 space-y-2">
        {children.map((c) => (
              <li key={c.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xs">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  {c.user_id === userId ? (
                    <button
                      type="button"
                      onClick={() => (editingChildId === c.id ? setEditingChildId(null) : startEditSharing(c))}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-200"
                    >
                      {sichtbarkeitLabel(c)}
                    </button>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{sichtbarkeitLabel(c)}</span>
                  )}
                  {c.user_id !== userId &&
                    c.tags.map((t) => (
                      <span key={t} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tagColor(t).chip}`}>
                        {t}
                      </span>
                    ))}
                </div>
                {c.user_id === userId && editingChildId === c.id && (
                  <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                    <SichtbarkeitEditor
                      sichtbarkeit={editSichtbarkeit}
                      onSichtbarkeitChange={setEditSichtbarkeit}
                      ebeneOptionLabel={`Ganze Ebene${document.ebene ? ` (${EBENE_LABEL[document.ebene]}${document.gliederung ? ` ${document.gliederung}` : ''})` : ''}`}
                      teilenMit={editTeilenMit}
                      onTeilenMitChange={setEditTeilenMit}
                      candidates={candidates}
                    />
                    {editShareError && <p className="mt-1.5 text-xs text-red-600">{editShareError}</p>}
                    <div className="mt-2 flex gap-1.5">
                      <button type="button" onClick={() => saveEditSharing(c)} disabled={editSaving} className="mc-btn-primary px-2.5! py-1! text-xs!">
                        {editSaving ? 'Speichern...' : 'Speichern'}
                      </button>
                      <button type="button" onClick={() => setEditingChildId(null)} className="mc-btn-ghost px-2.5! py-1! text-xs!">
                        Abbrechen
                      </button>
                    </div>
                  </div>
                )}
                {c.user_id === userId && (
                  <div className="mb-1.5">
                    <TagEditor tags={c.tags} onChange={(tags) => handleUpdateChildTags(c.id, tags)} vorschlaege={TAG_VORSCHLAEGE} />
                  </div>
                )}
                <p className={`text-sm text-slate-900 ${istNotizUngelesen(c, gelesenAmVorDiesemOeffnen) ? 'font-bold' : 'font-normal'}`}>
                  {c.titel}
                </p>
                {c.inhalt && <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{c.inhalt}</p>}
                {c.datei_url && (
                  <button
                    type="button"
                    onClick={() => setPreviewDoc({ path: c.datei_url!, name: fileNameFromPath(c.datei_url!) })}
                    className="mc-btn-ghost mt-1! px-2! py-1! text-xs!"
                  >
                    📎 {fileNameFromPath(c.datei_url)}
                  </button>
                )}
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-slate-400">
                    {c.user_id !== userId && `${authorNames.get(c.user_id) ?? 'Unbekannt'} · `}
                    {formatDateTime(c.erstellt_am)}
                  </span>
                  {c.user_id === userId && (
                    <button
                      type="button"
                      onClick={() =>
                        loeschRueckfrage({
                          titel: c.titel,
                          was: 'Die Notiz',
                          folgen: notizFolgen(c),
                          bestaetigungsText: 'Ja, ich möchte diese Notiz für alle löschen.',
                          ausfuehren: () => handleDeleteChild(c),
                        })
                      }
                      className="mc-btn-danger px-2! py-1! text-xs!"
                    >
                      Löschen
                    </button>
                  )}
                </div>
              </li>
            ))}
            {children.length === 0 && <li className="text-sm text-slate-400">Noch keine eigenen Notizen/Dokumente.</li>}
          </ul>

          <form onSubmit={handleAddChild} className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <input
              type="text"
              placeholder="Titel (z. B. „Einschätzung SPD-Anfrage“)"
              value={newTitel}
              onChange={(e) => setNewTitel(e.target.value)}
              className="mc-input w-full"
              required
            />
            <textarea
              placeholder="Notiz"
              value={newInhalt}
              onChange={(e) => setNewInhalt(e.target.value)}
              className="mc-input w-full"
              rows={3}
            />

            <TagEditor tags={newTags} onChange={setNewTags} vorschlaege={TAG_VORSCHLAEGE} />

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Sichtbarkeit</label>
              <SichtbarkeitEditor
                sichtbarkeit={newSichtbarkeit}
                onSichtbarkeitChange={setNewSichtbarkeit}
                ebeneOptionLabel={`Ganze Ebene${document.ebene ? ` (${EBENE_LABEL[document.ebene]}${document.gliederung ? ` ${document.gliederung}` : ''})` : ''}`}
                teilenMit={teilenMit}
                onTeilenMitChange={setTeilenMit}
                candidates={candidates}
              />
            </div>

            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <button type="submit" disabled={saving} className="mc-btn-primary">
              {saving ? 'Speichern...' : 'Anhängen'}
            </button>
      </form>
    </>
  )

  const zeigeNotizen = variante !== 'c' || notizenOffen
  const spaltenKlasse =
    variante === 'c'
      ? zeigeNotizen
        ? 'md:grid-cols-[minmax(0,1fr)_320px]'
        : 'md:grid-cols-[minmax(0,1fr)]'
      : eingebettet
        ? // Neben der Tagesordnung ist weniger Platz: erst ab xl nebeneinander.
          'xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]'
        : 'md:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]'

  const inhalt = (
    <>
      {/* Metadatenband über die volle Breite: alles, was das Dokument
          einordnet, steht einmal oben - darunter bleiben beide Spalten für
          Lesen und Notieren frei. */}
      <header className="shrink-0 border-b border-slate-200 px-5 py-3">
        <div className="flex items-start gap-3">
          <h1 className="min-w-0 flex-1 text-base font-bold leading-snug text-slate-900">
            {document.titel}
          </h1>
          <div className="flex shrink-0 items-center gap-1.5">
            {kopfAktionen}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {document.ebene && (
            <span
              className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${EBENE_COLOR[document.ebene].chip}`}
            >
              {EBENE_LABEL[document.ebene]}
              {document.gliederung ? ` · ${document.gliederung}` : ''}
            </span>
          )}
          {docTags.map((t) => (
            <span key={t} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tagColor(t).chip}`}>
              {t}
            </span>
          ))}
          {linkedSessions.map((si) => (
            <Link
              key={si.id}
              to={`/sitzungen/${si.id}`}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:border-primary/40 hover:text-slate-900"
            >
              📅 {si.titel} ({formatDate(si.datum)})
            </Link>
          ))}
          {linkedTodos.map((t) => (
            <span
              key={t.id}
              className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600"
            >
              ✓ <span className="truncate">{t.titel}</span>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setVerknuepfungenOffen((v) => !v)}
            aria-expanded={verknuepfungenOffen}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
              verknuepfungenOffen
                ? 'border-primary bg-primary text-white'
                : 'border-dashed border-slate-300 text-slate-500 hover:border-primary/50 hover:text-slate-700'
            }`}
          >
            <Link2 size={11} />
            Verknüpfungen
          </button>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
          {document.user_id !== userId && <span>{authorNames.get(document.user_id) ?? 'Unbekannt'}</span>}
          {document.user_id !== userId && <span className="text-slate-300">·</span>}
          <span>{formatDateTime(document.erstellt_am)}</span>
          {document.datei_url && (
            <>
              <span className="text-slate-300">·</span>
              <span className="truncate">📎 {fileNameFromPath(document.datei_url)}</span>
            </>
          )}
          {(durchSitzungArchiviert || archiviertAm) && (
            <>
              <span className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1">
                <Archive className="h-3 w-3" />
                {durchSitzungArchiviert
                  ? 'Im Archiv – die verknüpfte Sitzung ist vorbei'
                  : `Im Archiv – von Hand archiviert am ${formatDate(archiviertAm as string)}`}
              </span>
            </>
          )}
        </div>
      </header>

      {verknuepfungenOffen && (
        <div className="mc-animate-slide shrink-0 border-b border-slate-200 bg-slate-50 px-5 py-3">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tags</h3>
              {document.user_id === userId ? (
                <TagEditor tags={docTags} onChange={handleUpdateTopLevelTags} vorschlaege={TAG_VORSCHLAEGE} />
              ) : (
                <p className="text-xs text-slate-500">Nur der/die Ersteller*in kann Tags ändern.</p>
              )}
            </div>

            <div>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sitzungen</h3>
              <ul className="mb-1.5 space-y-1">
                {linkedSessions.map((si) => (
                  <li
                    key={si.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
                  >
                    <span className="truncate text-xs font-medium text-slate-800">
                      {si.titel} ({formatDate(si.datum)})
                    </span>
                    {document.user_id === userId && (
                      <button
                        type="button"
                        onClick={() => handleUnlinkSession(si.id)}
                        disabled={savingSession}
                        className="mc-btn-ghost shrink-0! px-2! py-0.5! text-[11px]!"
                      >
                        Lösen
                      </button>
                    )}
                  </li>
                ))}
                {linkedSessions.length === 0 && <li className="text-xs text-slate-400">Keine verknüpfte Sitzung.</li>}
              </ul>
              {document.user_id === userId && (
                <select
                  value=""
                  onChange={(e) => handleLinkSession(e.target.value)}
                  disabled={savingSession}
                  className="mc-input w-full text-sm!"
                >
                  <option value="">Sitzung hinzufügen...</option>
                  {ownSessions
                    .filter((si) => !linkedSessions.some((l) => l.id === si.id))
                    .map((si) => (
                      <option key={si.id} value={si.id}>
                        {si.titel} ({formatDate(si.datum)})
                      </option>
                    ))}
                </select>
              )}
            </div>

            <div>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">ToDos</h3>
              <ul className="mb-1.5 space-y-1">
                {linkedTodos.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
                  >
                    <span className="truncate text-xs font-medium text-slate-800">{t.titel}</span>
                    <button
                      type="button"
                      onClick={() => handleUnlinkTodo(t.id)}
                      className="mc-btn-ghost shrink-0! px-2! py-0.5! text-[11px]!"
                    >
                      Lösen
                    </button>
                  </li>
                ))}
                {linkedTodos.length === 0 && <li className="text-xs text-slate-400">Keine verknüpften ToDos.</li>}
              </ul>
              <div className="relative">
                <input
                  type="text"
                  placeholder="ToDo suchen und verknüpfen..."
                  value={todoSearch}
                  onChange={(e) => handleSearchTodos(e.target.value)}
                  onFocus={() => setTodoDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setTodoDropdownOpen(false), 150)}
                  className="mc-input w-full text-sm!"
                />
                {todoDropdownOpen && todoSearch.trim() && (
                  <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                    {todoSearchResults.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onMouseDown={() => handleLinkTodo(t.id)}
                          className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                        >
                          {t.titel}
                        </button>
                      </li>
                    ))}
                    {todoSearchResults.length === 0 && (
                      <li className="px-3 py-1.5 text-sm text-slate-400">Keine Treffer.</li>
                    )}
                  </ul>
                )}
              </div>
              {linkTodoError && <p className="mt-1 text-xs text-red-600">{linkTodoError}</p>}
            </div>
          </div>
        </div>
      )}

      <div className={`grid min-h-0 flex-1 grid-cols-1 ${spaltenKlasse}`}>
        <div
          className={`min-h-0 border-b border-slate-200 ${
            eingebettet
              ? 'max-h-[60vh] xl:max-h-none xl:border-b-0 xl:border-r'
              : 'max-h-[46vh] md:max-h-none md:border-b-0 md:border-r'
          }`}
        >
          <VorlageAnsicht inhalt={document.inhalt} zentriert={variante === 'c'} />
        </div>
        {zeigeNotizen && (
          <div className="min-h-0 overflow-y-auto bg-slate-50/60 p-5">{notizenSpalte}</div>
        )}
      </div>
    </>
  )

  return (
    <>
      {eingebettet ? (
        <div className="flex h-full min-h-0 flex-col">{inhalt}</div>
      ) : (
        <div
          className="mc-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]"
          onClick={onClose}
        >
          <div
            className="mc-animate-pop flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {inhalt}
          </div>
        </div>
      )}
      {loeschDialog}
      {previewDoc && (
        <DocumentPreviewModal path={previewDoc.path} fileName={previewDoc.name} bucket="dokumente" onClose={() => setPreviewDoc(null)} />
      )}
    </>
  )
}
