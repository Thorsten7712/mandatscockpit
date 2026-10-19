import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ChevronDown, ChevronUp, ListChecks, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type { CalendarSource, DokumentRow, Ebene, EventRow, SessionRow, TagesordnungsEintrag, TodoRow } from '../lib/types'
import { TodoDetailModal } from './TodoDetailModal'
import { DokumentDetailModal } from './DokumentDetailModal'
import { useLoeschDialog } from './LoeschDialog'
import { formatDateTime } from '../lib/format'
import { inStuecken } from '../lib/alleZeilen'
import { DOKUMENT_SPALTEN } from '../lib/dokumentSpalten'
import { istDokumentUngelesen } from '../lib/dokumenteGelesen'
import { archivGrund, ladeSitzungenJeDokument } from '../lib/dokumenteArchiv'

// Gleiche Liste wie in Settings.tsx/Archiv.tsx (Kalenderquellen- bzw.
// Sitzung-nachtragen-Formular) - bewusst dupliziert, siehe CLAUDE.md.
const EBENEN: { value: Ebene; label: string }[] = [
  { value: 'kommune', label: 'Kommune' },
  { value: 'kreis', label: 'Kreis' },
  { value: 'land', label: 'Land' },
  { value: 'bund', label: 'Bund' },
]

/** Eine Notiz, die an einer verknüpften Aufgabe oder einem verknüpften
 *  Dokument hängt. Sitzungen und Termine haben seit 0055 keine eigenen
 *  Notizen mehr - was zu ihnen gehört, steht dort und wird hier nur gezeigt. */
interface IndirekteNotiz {
  id: string
  quelle: 'todo' | 'dokument'
  bezugId: string
  bezugTitel: string
  user_id: string
  inhalt: string
  erstellt_am: string
}

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TerminDetailPanel({
  kind,
  id,
  onDeleted,
  onCloseAll,
  layout = 'stacked',
}: {
  kind: 'event' | 'session'
  id: string
  onDeleted?: () => void
  /** Schließt das Fenster (layout="modal"). Auf der eigenen Seite
   *  (/termin/:kind/:id) gibt es nichts zu schließen, dort bleibt es leer. */
  onCloseAll?: () => void
  /** 'modal' bringt das eigene Overlay samt Kopfzeile mit (TerminDetailModal),
   *  'stacked' rendert nur den Inhalt für die eigene Seite. 'eingebettet' ist
   *  die Sitzungsansicht auf /sitzungen (UI-Umbau 18.10.2026): eine Karte mit
   *  der Tagesordnung links und rechts der Übersicht oder dem gewählten
   *  Tagesordnungspunkt – ohne Fenster darüber. Nur für Sitzungen. */
  layout?: 'stacked' | 'modal' | 'eingebettet'
}) {
  const [userId, setUserId] = useState<string | null>(null)
  const [event, setEvent] = useState<EventRow | null>(null)
  const [session, setSession] = useState<SessionRow | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [editTitel, setEditTitel] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnde, setEditEnde] = useState('')
  const [editOrt, setEditOrt] = useState('')
  const [editGremium, setEditGremium] = useState('')
  const [editEbene, setEditEbene] = useState<Ebene>('kommune')
  const [editSourceId, setEditSourceId] = useState('')
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const { fragen: loeschRueckfrage, dialog: loeschDialog } = useLoeschDialog()

  const [notizen, setNotizen] = useState<IndirekteNotiz[]>([])
  const [autorNamen, setAutorNamen] = useState<Map<string, string>>(new Map())

  const [linkedTodos, setLinkedTodos] = useState<TodoRow[]>([])
  const [openTodoId, setOpenTodoId] = useState<string | null>(null)


  const [linkedDokumente, setLinkedDokumente] = useState<DokumentRow[]>([])
  const [openDokument, setOpenDokument] = useState<DokumentRow | null>(null)
  const [tagesordnung, setTagesordnung] = useState<TagesordnungsEintrag[]>([])
  // Solange die Verknüpfungen nicht geladen sind, ist noch nicht entschieden,
  // ob diese Sitzung im Leser oder in der Liste aufgeht. Bis dahin gar nichts
  // zeigen - sonst blitzt die Liste auf und der Leser legt sich darüber.
  const [dokumenteGeladen, setDokumenteGeladen] = useState(false)

  // Nur für layout="eingebettet": Kennzeichen an den Tagesordnungspunkten.
  const [kartenJeDokument, setKartenJeDokument] = useState<Map<string, number>>(new Map())
  const [gelesenJeDokument, setGelesenJeDokument] = useState<Map<string, string>>(new Map())
  // Archiviertes gilt als gelesen – eine Vorlage aus einer vergangenen Sitzung
  // ist nur dann „neu", wenn sie noch auf einer kommenden Tagesordnung steht.
  const [archiviertIds, setArchiviertIds] = useState<Set<string>>(new Set())
  const [nurMitDrucksache, setNurMitDrucksache] = useState(false)
  const [nurUngelesen, setNurUngelesen] = useState(false)
  // Auf dem Handy steht entweder die Tagesordnung oder der gewählte Punkt da.
  const [mobilDetail, setMobilDetail] = useState(false)
  const [neueKarte, setNeueKarte] = useState('')
  const [karteFehler, setKarteFehler] = useState<string | null>(null)
  const karteRef = useRef<HTMLElement | null>(null)

  async function loadTermin() {
    setEvent(null)
    setSession(null)
    setLoadError(null)
    if (kind === 'event') {
      const { data, error } = await supabase.from('events').select('*').eq('id', id).single()
      if (error || !data) {
        setLoadError('Termin nicht gefunden.')
        return
      }
      setEvent(data)
    } else {
      const { data, error } = await supabase.from('sessions').select('*').eq('id', id).single()
      if (error || !data) {
        setLoadError('Sitzung nicht gefunden.')
        return
      }
      setSession(data)
    }
  }

  async function loadLinkedTodos() {
    const column = kind === 'event' ? 'event_id' : 'session_id'
    // "position" lebt seit dem Teilen-Ausbau in todo_placements statt direkt
    // auf todos (siehe 0021_todo_erledigt_sharing.sql) - hier reicht die
    // Erstellungsreihenfolge.
    const { data } = await supabase.from('todos').select('*').eq(column, id).order('created_at')
    setLinkedTodos(data ?? [])
  }

  async function loadLinkedDokumente() {
    if (kind !== 'session') {
      setLinkedDokumente([])
      setTagesordnung([])
      setDokumenteGeladen(true)
      return
    }
    // Die Tagesordnung IST die Verknüpfungstabelle (0042-0044): jede Zeile ist
    // ein Tagesordnungspunkt, der ein Dokument tragen KANN. Punkte ohne
    // Drucksache ("Eröffnung der Sitzung", "Einwohnerfragestunde") machen rund
    // ein Viertel einer Ratstagesordnung aus und gehören dazu - ohne sie
    // springt die Nummerierung.
    const { data: links } = await supabase
      .from('sitzung_dokumente')
      .select('dokument_id, top_nummer, top_titel, reihenfolge, ergebnis')
      .eq('session_id', id)
    const eintraege = (links ?? []) as Omit<TagesordnungsEintrag, 'titel'>[]
    const ids = eintraege.map((l) => l.dokument_id).filter((d): d is string => d !== null)
    const { data } =
      ids.length > 0
        ? await supabase.from('dokumente').select(DOKUMENT_SPALTEN).in('id', ids).order('erstellt_am')
        : { data: [] as DokumentRow[] }
    const dokumente = data ?? []
    const titelById = new Map(dokumente.map((d) => [d.id, d.titel]))

    // Beide States nach demselben await setzen, damit React einmal rendert -
    // sonst stünde für einen Moment eine Tagesordnung ohne Dokumente da
    // (siehe CLAUDE.md).
    setLinkedDokumente(dokumente)
    // Nach der Tagesordnung sortieren, wo sie bekannt ist - top_nummer taugt
    // als Text nicht ("3.10" käme vor "3.2"). Einträge ohne Reihenfolge landen
    // hinten, alphabetisch nach Titel.
    const sortiert = eintraege
      .map((e) => ({ ...e, titel: (e.dokument_id ? titelById.get(e.dokument_id) : '') ?? '' }))
      .sort((a, b) => {
        if (a.reihenfolge !== null && b.reihenfolge !== null) return a.reihenfolge - b.reihenfolge
        if (a.reihenfolge !== null) return -1
        if (b.reihenfolge !== null) return 1
        return (a.top_titel || a.titel).localeCompare(b.top_titel || b.titel, 'de')
      })
    setTagesordnung(sortiert)
    setDokumenteGeladen(true)
  }

  useEffect(() => {
    setEditing(false)
    setOpenTodoId(null)
    setOpenDokument(null)
    setDokumenteGeladen(false)
    setMobilDetail(false)
    loadTermin()
    loadLinkedTodos()
    loadLinkedDokumente()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
    })
    if (kind === 'session') {
      supabase
        .from('calendar_sources')
        .select('*')
        .then(({ data }) => setSources(data ?? []))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id])

  // Sitzungen sind nur bearbeitbar/löschbar, wenn sie vom aktuellen Nutzer
  // selbst manuell nachgetragen wurden (sessions_update_own_manuell/
  // sessions_delete_own_manuell, supabase/migrations/0028+0029) - importierte
  // Sitzungen (erstellt_von = null) bleiben read-only.
  const canManageSession = kind === 'session' && session?.erstellt_von === userId

  // Eine echte Tagesordnung liegt vor, sobald mindestens ein Punkt eine
  // TOP-Nummer trägt (die setzt nur der Import, siehe set_session_agenda im
  // MCP-Server). Ohne das sind es von Hand gesetzte Verknüpfungen, für die
  // "Tagesordnung" als Überschrift zu viel behauptet.
  const hatTagesordnung = tagesordnung.some((t) => t.top_nummer !== null)


  function startEdit() {
    if (kind === 'event' && event) {
      setEditTitel(event.titel)
      setEditStart(toDatetimeLocalValue(event.start))
      setEditEnde(event.ende ? toDatetimeLocalValue(event.ende) : '')
      setEditOrt(event.ort ?? '')
    } else if (kind === 'session' && session) {
      setEditTitel(session.titel)
      setEditStart(toDatetimeLocalValue(session.datum))
      setEditEnde('')
      setEditOrt(session.ort ?? '')
      setEditGremium(session.gremium ?? '')
      setEditEbene(session.ebene ?? 'kommune')
      setEditSourceId(session.source_id ?? '')
    } else {
      return
    }
    setEditError(null)
    setEditing(true)
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    setEditSaving(true)
    setEditError(null)
    const { error } =
      kind === 'event' && event
        ? await supabase
            .from('events')
            .update({
              titel: editTitel,
              start: new Date(editStart).toISOString(),
              ende: editEnde ? new Date(editEnde).toISOString() : null,
              ort: editOrt || null,
            })
            .eq('id', event.id)
        : await supabase
            .from('sessions')
            .update({
              titel: editTitel,
              datum: new Date(editStart).toISOString(),
              ort: editOrt || null,
              gremium: editGremium || null,
              ebene: sources.find((s) => s.id === editSourceId)?.ebene ?? editEbene,
              source_id: editSourceId || null,
            })
            .eq('id', session!.id)
    if (error) {
      setEditError(error.message)
    } else {
      setEditing(false)
      await loadTermin()
    }
    setEditSaving(false)
  }

  async function handleDelete() {
    const { error } =
      kind === 'event' && event
        ? await supabase.from('events').delete().eq('id', event.id)
        : await supabase.from('sessions').delete().eq('id', session!.id)
    if (error) throw new Error(error.message)
    onDeleted?.()
  }

  async function handleToggleAbsage() {
    if (!event) return
    setDeleteError(null)
    const nextStatus = event.status === 'abgesagt' ? 'geplant' : 'abgesagt'
    const { error } = await supabase.from('events').update({ status: nextStatus }).eq('id', event.id)
    if (error) {
      setDeleteError(error.message)
      return
    }
    await loadTermin()
  }

  // Notizen der verknüpften Aufgaben (summaries.todo_id) und Dokumente
  // (dokumente.parent_id). RLS liefert nur, was der Nutzer ohnehin sehen darf.
  // Eine Ratssitzung hat gut 80 Dokumente - die Ids deshalb in Stücken.
  useEffect(() => {
    let abgebrochen = false
    async function ladeNotizen() {
      const todoTitel = new Map(linkedTodos.map((t) => [t.id, t.titel]))
      const dokTitel = new Map(linkedDokumente.map((d) => [d.id, d.titel]))
      const gesammelt: IndirekteNotiz[] = []
      for (const ids of inStuecken([...todoTitel.keys()])) {
        const { data } = await supabase
          .from('summaries')
          .select('id, todo_id, user_id, inhalt, erstellt_am')
          .in('todo_id', ids)
          .not('inhalt', 'is', null)
        for (const n of data ?? []) {
          gesammelt.push({
            id: n.id,
            quelle: 'todo',
            bezugId: n.todo_id,
            bezugTitel: todoTitel.get(n.todo_id) ?? '',
            user_id: n.user_id,
            inhalt: n.inhalt,
            erstellt_am: n.erstellt_am,
          })
        }
      }
      for (const ids of inStuecken([...dokTitel.keys()])) {
        const { data } = await supabase
          .from('dokumente')
          .select('id, parent_id, user_id, titel, inhalt, erstellt_am')
          .in('parent_id', ids)
        for (const n of data ?? []) {
          gesammelt.push({
            id: n.id,
            quelle: 'dokument',
            bezugId: n.parent_id,
            bezugTitel: dokTitel.get(n.parent_id) ?? '',
            user_id: n.user_id,
            inhalt: [n.titel, n.inhalt].filter(Boolean).join('\n'),
            erstellt_am: n.erstellt_am,
          })
        }
      }
      gesammelt.sort((a, b) => Date.parse(b.erstellt_am) - Date.parse(a.erstellt_am))
      const autoren = [...new Set(gesammelt.map((n) => n.user_id))]
      const { data: profs } =
        autoren.length > 0
          ? await supabase.from('profiles').select('id, name').in('id', autoren)
          : { data: [] as { id: string; name: string }[] }
      if (abgebrochen) return
      // Beide nach demselben await setzen (siehe CLAUDE.md).
      setAutorNamen(new Map((profs ?? []).map((p) => [p.id, p.name])))
      setNotizen(gesammelt)
    }
    ladeNotizen()
    return () => {
      abgebrochen = true
    }
  }, [linkedTodos, linkedDokumente])

  // Kennzeichen der Tagesordnungspunkte in der eingebetteten Ansicht: an wie
  // vielen (für mich sichtbaren) Karten das Dokument hängt und wann ich es
  // zuletzt gelesen habe. RLS liefert nur, was ich sehen darf.
  useEffect(() => {
    if (layout !== 'eingebettet' || !userId) return
    let abgebrochen = false
    async function ladeKennzeichen() {
      const karten = new Map<string, number>()
      const gelesen = new Map<string, string>()
      for (const ids of inStuecken(linkedDokumente.map((d) => d.id))) {
        const [verknuepft, lesestand] = await Promise.all([
          supabase.from('todo_dokumente').select('dokument_id').in('dokument_id', ids),
          supabase.from('dokument_gelesen').select('dokument_id, gelesen_am').eq('user_id', userId!).in('dokument_id', ids),
        ])
        for (const z of verknuepft.data ?? []) karten.set(z.dokument_id, (karten.get(z.dokument_id) ?? 0) + 1)
        for (const z of lesestand.data ?? []) gelesen.set(z.dokument_id, z.gelesen_am)
      }
      const { sitzungen } = await ladeSitzungenJeDokument(
        supabase,
        linkedDokumente.map((d) => d.id),
      )
      if (abgebrochen) return
      setKartenJeDokument(karten)
      setGelesenJeDokument(gelesen)
      setArchiviertIds(new Set(linkedDokumente.filter((d) => archivGrund(d, sitzungen)).map((d) => d.id)))
    }
    ladeKennzeichen()
    return () => {
      abgebrochen = true
    }
  }, [layout, userId, linkedDokumente])

  /** Neue Karte zu dieser Sitzung, in die eigene Spalte „Neu". */
  async function karteAnlegen(e: FormEvent) {
    e.preventDefault()
    const titel = neueKarte.trim()
    if (!titel || !userId) return
    setKarteFehler(null)
    const { data: spalten } = await supabase.from('todo_columns').select('id, titel').eq('user_id', userId)
    const neu = (spalten ?? []).find((c) => c.titel.trim().toLowerCase() === 'neu')
    if (!neu) {
      setKarteFehler('Spalte „Neu" nicht gefunden.')
      return
    }
    const { data: todo, error } = await supabase
      .from('todos')
      .insert({ user_id: userId, titel, session_id: id })
      .select('id')
      .single()
    if (error || !todo) {
      setKarteFehler(error?.message ?? 'Karte konnte nicht angelegt werden.')
      return
    }
    const { error: platzFehler } = await supabase
      .from('todo_placements')
      .insert({ todo_id: todo.id, user_id: userId, column_id: neu.id, position: 0 })
    if (platzFehler) setKarteFehler(platzFehler.message)
    setNeueKarte('')
    await loadLinkedTodos()
  }

  function oeffneBezug(n: IndirekteNotiz) {
    if (n.quelle === 'todo') {
      setOpenTodoId(n.bezugId)
      return
    }
    const dok = linkedDokumente.find((d) => d.id === n.bezugId)
    if (dok) setOpenDokument(dok)
  }

  const titel = event?.titel ?? session?.titel
  const start = event?.start ?? session?.datum
  const ort = event?.ort ?? session?.ort
  const abgesagt = event?.status === 'abgesagt' || session?.status === 'abgesagt'

  const detailsBlock = (
    <>
      <h2 className="mb-3 text-lg font-bold text-slate-900">{titel ?? 'Termin'}</h2>

      {loadError && <p className="text-red-600 mb-4">{loadError}</p>}

      {(event || session) && (
        <div className="mb-6 space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-4">
          {!editing && (
            <>
              {abgesagt && <p className="text-sm font-semibold text-red-600">Abgesagt</p>}
              {start && <p className="text-sm text-slate-600">{formatDateTime(start)}</p>}
              {event?.ende && (
                <p className="text-sm text-slate-600">bis {formatDateTime(event.ende)}</p>
              )}
              {ort && <p className="text-sm text-slate-600">Ort: {ort}</p>}
              {session?.gremium && <p className="text-sm text-slate-600">Gremium: {session.gremium}</p>}
              {event?.herkunft === 'fraktionsbuero' && (
                <p className="text-sm text-slate-600">Angelegt vom Fraktionsbüro</p>
              )}
              {(event || canManageSession) && (
                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={startEdit} className="mc-btn-ghost px-2! py-1! text-xs!">
                    Bearbeiten
                  </button>
                  {event && (
                    <button
                      type="button"
                      onClick={handleToggleAbsage}
                      className="mc-btn-ghost px-2! py-1! text-xs!"
                    >
                      {event.status === 'abgesagt' ? 'Reaktivieren' : 'Absagen'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      loeschRueckfrage({
                        titel: titel ?? '',
                        was: kind === 'event' ? 'Der Termin' : 'Die Sitzung',
                        // Ein eigener Termin gehört nur mir. Eine nachgetragene
                        // Sitzung sehen dagegen alle, die dieselbe Kalenderquelle
                        // abonniert haben - und daran hängende Notizen/Dokumente
                        // anderer verlieren ihren Bezugspunkt.
                        folgen:
                          kind === 'session'
                            ? [
                                'Die Sitzung ist für alle sichtbar, die dieselbe Kalenderquelle abonniert haben, und verschwindet dort ebenfalls.',
                                'Daran hängende Notizen und Dokumente verlieren ihren Bezug.',
                                'Das lässt sich nicht rückgängig machen.',
                              ]
                            : undefined,
                        bestaetigungsText: 'Ja, ich möchte diese Sitzung für alle löschen.',
                        ausfuehren: handleDelete,
                      })
                    }
                    className="mc-btn-danger px-2! py-1! text-xs!"
                  >
                    Löschen
                  </button>
                </div>
              )}
              {deleteError && <p className="text-red-600 text-sm">{deleteError}</p>}
            </>
          )}
          {editing && (
            <form onSubmit={handleSaveEdit} className="space-y-2">
              <input
                type="text"
                value={editTitel}
                onChange={(e) => setEditTitel(e.target.value)}
                className="mc-input w-full"
                required
              />
              <div className="flex gap-2">
                <input
                  type="datetime-local"
                  value={editStart}
                  onChange={(e) => setEditStart(e.target.value)}
                  className="mc-input flex-1"
                  required
                />
                {kind === 'event' && (
                  <input
                    type="datetime-local"
                    value={editEnde}
                    onChange={(e) => setEditEnde(e.target.value)}
                    className="mc-input flex-1"
                  />
                )}
              </div>
              <input
                type="text"
                placeholder="Ort (optional)"
                value={editOrt}
                onChange={(e) => setEditOrt(e.target.value)}
                className="mc-input w-full"
              />
              {kind === 'session' && (
                <>
                  <select
                    value={editSourceId}
                    onChange={(e) => {
                      const sid = e.target.value
                      setEditSourceId(sid)
                      const source = sources.find((s) => s.id === sid)
                      if (source) setEditEbene(source.ebene)
                    }}
                    className="mc-input w-full"
                  >
                    <option value="">Keine Kalenderquelle – eigenständige Sitzung</option>
                    {sources
                      .filter((s) => s.art === 'sitzung')
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Gremium"
                      value={editGremium}
                      onChange={(e) => setEditGremium(e.target.value)}
                      className="mc-input flex-1"
                    />
                    <select
                      value={editEbene}
                      onChange={(e) => setEditEbene(e.target.value as Ebene)}
                      disabled={!!editSourceId}
                      className="mc-input flex-1 disabled:opacity-60"
                    >
                      {EBENEN.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              {editError && <p className="text-red-600 text-sm">{editError}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={editSaving}
                  className="mc-btn-primary"
                >
                  {editSaving ? 'Speichern...' : 'Speichern'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="mc-btn-ghost"
                >
                  Abbrechen
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  )

  const linkedBlock = (
    <>
      <h3 className="mb-2 text-sm font-semibold text-slate-900">Verknüpfte Aufgaben</h3>
      <ul className="mb-6 space-y-2">
        {linkedTodos.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setOpenTodoId(t.id)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-800 shadow-xs transition-shadow duration-150 hover:shadow-md"
            >
              {t.titel}
            </button>
          </li>
        ))}
        {linkedTodos.length === 0 && (
          <li className="text-slate-400 text-sm">Keine verknüpften Aufgaben.</li>
        )}
      </ul>

    </>
  )

  const notesBlock = (
    <>
      <h3 className="mb-1 text-sm font-semibold text-slate-900">Notizen</h3>
      <p className="mb-2 text-xs text-slate-500">
        Aus den verknüpften Aufgaben und Dokumenten – Notizen schreibst du dort.
      </p>
      <ul className="mb-3 space-y-2">
        {notizen.map((n) => (
          <li key={`${n.quelle}-${n.id}`}>
            <button
              type="button"
              onClick={() => oeffneBezug(n)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left shadow-xs transition-shadow duration-150 hover:shadow-md"
            >
              <span className="block truncate text-xs font-medium text-slate-500">
                {n.quelle === 'todo' ? 'Aufgabe' : 'Dokument'}: {n.bezugTitel}
              </span>
              <span className="mt-0.5 line-clamp-3 text-sm whitespace-pre-wrap text-slate-800">{n.inhalt}</span>
              <span className="mt-1 block text-xs text-slate-400">
                {n.user_id === userId ? 'Du' : autorNamen.get(n.user_id) ?? 'Unbekannt'} · {formatDateTime(n.erstellt_am)}
              </span>
            </button>
          </li>
        ))}
        {notizen.length === 0 && (
          <li className="text-slate-400 text-sm">Noch keine Notizen an verknüpften Aufgaben oder Dokumenten.</li>
        )}
      </ul>
    </>
  )

  /** Sitzungsansicht für /sitzungen: Kopf, links die Tagesordnung, rechts
   *  Übersicht oder gewählter Punkt – alles in einer Karte. */
  function eingebetteteAnsicht() {
    if (loadError) return <p className="text-red-600">{loadError}</p>
    if (!session || !dokumenteGeladen) {
      return <div className="mc-card p-6 text-sm text-slate-400">Lade Sitzung …</div>
    }
    const notizenJeDokument = new Map<string, IndirekteNotiz[]>()
    for (const n of notizen) {
      if (n.quelle !== 'dokument') continue
      notizenJeDokument.set(n.bezugId, [...(notizenJeDokument.get(n.bezugId) ?? []), n])
    }
    const dokById = new Map(linkedDokumente.map((d) => [d.id, d]))
    const ungelesen = (dokId: string) => {
      const d = dokById.get(dokId)
      return d
        ? istDokumentUngelesen(d, notizenJeDokument.get(dokId) ?? [], gelesenJeDokument.get(dokId), archiviertIds.has(dokId))
        : false
    }
    const sichtbar = tagesordnung.filter((t) => {
      if (nurMitDrucksache && !t.dokument_id) return false
      if (nurUngelesen && !(t.dokument_id && ungelesen(t.dokument_id))) return false
      return true
    })
    const mitDokument = sichtbar.filter((t) => t.dokument_id !== null)
    const aktivIndex = openDokument ? mitDokument.findIndex((t) => t.dokument_id === openDokument.id) : -1
    const aktiverPunkt = aktivIndex >= 0 ? mitDokument[aktivIndex] : null
    const waehle = (dokId: string | null) => {
      setOpenDokument(dokId ? dokById.get(dokId) ?? null : null)
      // Das Dokument markiert sich beim Öffnen selbst als gelesen; hier nur
      // das Kennzeichen sofort nachziehen, statt alles neu zu laden.
      if (dokId) setGelesenJeDokument((vorher) => new Map(vorher).set(dokId, new Date().toISOString()))
      setMobilDetail(true)
      // Auf dem Handy ersetzt der Punkt die Liste – an den Kartenanfang
      // springen, sonst steht man mitten in einem Text, der weiter oben beginnt.
      if (window.matchMedia('(max-width: 767px)').matches) karteRef.current?.scrollIntoView({ block: 'start' })
    }
    const erledigt = linkedTodos.filter((t) => t.erledigt).length
    const datum = new Date(session.datum)

    const filterKnopf = (aktiv: boolean, umschalten: () => void, text: string) => (
      <button
        type="button"
        aria-pressed={aktiv}
        onClick={umschalten}
        className={`min-h-10 rounded-lg border px-3 text-sm transition-colors ${
          aktiv ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white hover:bg-slate-50'
        }`}
      >
        {text}
      </button>
    )

    const uebersichtFlaeche = (
      <div className="flex flex-wrap items-start gap-4 p-5">
        <section className="flex min-w-0 flex-[1_1_280px] flex-col gap-3 rounded-xl border border-slate-100 p-4">
          <h2 className="text-base font-semibold">Meine Vorbereitung</h2>
          {linkedTodos.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[13px] text-slate-600">
                <span>
                  {erledigt} von {linkedTodos.length} {linkedTodos.length === 1 ? 'Karte' : 'Karten'} erledigt
                </span>
                <span>{Math.round((erledigt / linkedTodos.length) * 100)} %</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${Math.round((erledigt / linkedTodos.length) * 100)}%` }}
                />
              </div>
            </div>
          )}
          <ul className="flex flex-col">
            {linkedTodos.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setOpenTodoId(t.id)}
                  className="flex w-full items-start gap-2.5 py-1.5 text-left text-[15px] hover:underline"
                >
                  <ListChecks size={18} className={`mt-0.5 shrink-0 ${t.erledigt ? 'text-slate-300' : 'text-primary'}`} />
                  <span className={t.erledigt ? 'text-slate-400 line-through' : ''}>{t.titel}</span>
                </button>
              </li>
            ))}
            {linkedTodos.length === 0 && <li className="text-sm text-slate-500">Noch keine Karte zu dieser Sitzung.</li>}
          </ul>
          <form onSubmit={karteAnlegen} className="flex gap-2">
            <input
              type="text"
              value={neueKarte}
              onChange={(e) => setNeueKarte(e.target.value)}
              placeholder="Karte zu dieser Sitzung …"
              className="mc-input min-w-0 flex-1"
            />
            <button type="submit" disabled={!neueKarte.trim()} className="mc-btn-primary">
              Anlegen
            </button>
          </form>
          {karteFehler && <p className="text-sm text-red-600">{karteFehler}</p>}
        </section>
        <section className="flex min-w-0 flex-[1_1_280px] flex-col rounded-xl border border-slate-100 p-4">
          {detailsBlock}
        </section>
        <section className="min-w-0 flex-[1_1_100%] rounded-xl border border-slate-100 p-4">{notesBlock}</section>
      </div>
    )

    return (
      <section ref={karteRef} aria-labelledby="sitzung-titel" className="mc-card scroll-mt-2 overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 id="sitzung-titel" className="text-[22px] font-bold tracking-tight">
              {session.gremium ?? session.titel}
            </h1>
            <span className="text-sm text-slate-500">
              {datum.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} ·{' '}
              {datum.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
              {session.ort ? ` · ${session.ort}` : ''}
              {tagesordnung.length > 0 ? ` · ${tagesordnung.length} Punkte` : ''}
              {session.status === 'abgesagt' ? ' · abgesagt' : ''}
            </span>
          </div>
          {tagesordnung.length > 0 && (
            <div className="flex gap-1.5">
              {filterKnopf(nurMitDrucksache, () => setNurMitDrucksache((v) => !v), 'Nur mit Drucksache')}
              {filterKnopf(nurUngelesen, () => setNurUngelesen((v) => !v), 'Ungelesen')}
            </div>
          )}
        </div>

        <div className="flex md:h-[calc(100vh-15rem)] md:min-h-[560px]">
          <nav
            aria-label="Tagesordnung"
            className={`min-w-0 overflow-y-auto border-slate-100 md:block md:w-[320px] md:shrink-0 md:border-r lg:w-[360px] ${
              mobilDetail ? 'hidden' : 'block w-full'
            }`}
          >
            <button
              type="button"
              onClick={() => waehle(null)}
              aria-pressed={!openDokument}
              className={`flex min-h-13 w-full items-center gap-3 border-b border-slate-100 px-5 text-left text-[15px] font-semibold ${
                openDokument ? 'hover:bg-slate-50' : 'bg-primary/10 text-primary'
              }`}
            >
              <ListChecks size={18} />
              Übersicht &amp; Vorbereitung
            </button>
            {tagesordnung.length === 0 && (
              <p className="px-5 py-4 text-sm text-slate-500">Noch keine Tagesordnung veröffentlicht.</p>
            )}
            {tagesordnung.length > 0 && !hatTagesordnung && (
              <p className="px-5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Verknüpfte Dokumente
              </p>
            )}
            <ol>
              {sichtbar.map((t) => {
                const beschriftung = t.top_titel || t.titel || '(ohne Titel)'
                const nummer = (
                  <span className="w-9 shrink-0 pt-0.5 font-mono text-[13px] text-slate-400">{t.top_nummer ?? ''}</span>
                )
                if (!t.dokument_id) {
                  return (
                    <li key={`${t.top_nummer ?? ''}|`} className="flex gap-2 border-b border-slate-100 px-5 py-3">
                      {nummer}
                      <span className="text-[15px] italic text-slate-500">{beschriftung}</span>
                    </li>
                  )
                }
                const dok = dokById.get(t.dokument_id)
                const aktiv = openDokument?.id === t.dokument_id
                const anzahlNotizen = notizenJeDokument.get(t.dokument_id)?.length ?? 0
                const anzahlKarten = kartenJeDokument.get(t.dokument_id) ?? 0
                const neu = ungelesen(t.dokument_id)
                const ds = dok?.titel.match(/^DS[\w/.-]+/)?.[0]
                return (
                  <li key={`${t.top_nummer ?? ''}|${t.dokument_id}`} className="border-b border-slate-100">
                    <button
                      type="button"
                      onClick={() => waehle(t.dokument_id)}
                      aria-pressed={aktiv}
                      className={`flex w-full gap-2 px-5 py-3 text-left ${aktiv ? 'bg-primary/10' : 'hover:bg-slate-50'}`}
                    >
                      {nummer}
                      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span className={`line-clamp-3 text-[15px] leading-snug ${neu ? 'font-semibold' : 'font-medium'}`}>
                          {beschriftung}
                        </span>
                        <span className="flex flex-wrap gap-1.5">
                          {ds && <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs">{ds}</span>}
                          {neu && <span className="rounded-md bg-primary px-2 py-0.5 text-xs text-white">neu</span>}
                          {anzahlKarten > 0 && (
                            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                              {anzahlKarten === 1 ? 'Karte' : `${anzahlKarten} Karten`}
                            </span>
                          )}
                          {dok?.tags.includes('Enthält Bilder') && (
                            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Enthält Bilder</span>
                          )}
                          {anzahlNotizen > 0 && (
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs">
                              {anzahlNotizen} {anzahlNotizen === 1 ? 'Notiz' : 'Notizen'}
                            </span>
                          )}
                          {t.ergebnis && <span className="px-0.5 text-xs text-slate-500">{t.ergebnis}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
              {tagesordnung.length > 0 && sichtbar.length === 0 && (
                <li className="px-5 py-4 text-sm text-slate-500">Kein Punkt passt zum Filter.</li>
              )}
            </ol>
          </nav>

          <div className={`min-w-0 flex-1 flex-col md:flex ${mobilDetail ? 'flex' : 'hidden'}`}>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-5 py-2">
              <button type="button" onClick={() => setMobilDetail(false)} className="mc-btn-ghost md:hidden">
                <ArrowLeft size={16} />
                Tagesordnung
              </button>
              <span className="hidden font-mono text-[13px] text-slate-500 md:inline">
                {aktiverPunkt
                  ? `${aktiverPunkt.top_nummer ? `TOP ${aktiverPunkt.top_nummer}` : 'Dokument'} · ${aktivIndex + 1} von ${mitDokument.length}`
                  : 'Übersicht'}
              </span>
              {aktiverPunkt && (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    aria-label="Vorheriger Punkt"
                    disabled={aktivIndex <= 0}
                    onClick={() => waehle(mitDokument[aktivIndex - 1].dokument_id)}
                    className="mc-btn h-9 w-9 border border-slate-300 bg-white"
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Nächster Punkt"
                    disabled={aktivIndex >= mitDokument.length - 1}
                    onClick={() => waehle(mitDokument[aktivIndex + 1].dokument_id)}
                    className="mc-btn h-9 w-9 border border-slate-300 bg-white"
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {openDokument ? (
                <DokumentDetailModal
                  key={openDokument.id}
                  document={openDokument}
                  eingebettet
                  onClose={() => setOpenDokument(null)}
                  onDeleted={() => {
                    setOpenDokument(null)
                    loadLinkedDokumente()
                  }}
                />
              ) : (
                uebersichtFlaeche
              )}
            </div>
          </div>
        </div>
      </section>
    )
  }

  const nestedModals = (
    <>
      {openTodoId && (
        <TodoDetailModal id={openTodoId} onClose={() => setOpenTodoId(null)} onChanged={loadLinkedTodos} />
      )}
    </>
  )

  if (layout === 'eingebettet') {
    return (
      <>
        {eingebetteteAnsicht()}
        {nestedModals}
        {loeschDialog}
      </>
    )
  }

  if (layout === 'modal') {
    return (
      <div
        className="mc-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]"
        onClick={onCloseAll}
      >
        <div
          className="mc-animate-pop flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
            <h1 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {kind === 'session' ? 'Sitzung' : 'Termin'}
            </h1>
            <button
              type="button"
              onClick={onCloseAll}
              aria-label="Schließen"
              title="Schließen"
              className="mc-btn-ghost shrink-0 p-2!"
            >
              <X size={18} />
            </button>
          </header>
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="min-h-0 overflow-y-auto border-b border-slate-200 p-6 md:border-b-0 md:border-r">
              {detailsBlock}
              {linkedBlock}
            </div>
            <div className="min-h-0 overflow-y-auto p-6">{notesBlock}</div>
          </div>
          {/* Innerhalb der Karte, damit Klicks in einem verschachtelten Modal
              nicht bis zum schließenden Hintergrund durchschlagen. */}
          {nestedModals}
          {loeschDialog}
        </div>
      </div>
    )
  }

  return (
    <div>
      {detailsBlock}
      {linkedBlock}
      {notesBlock}
      {nestedModals}
      {loeschDialog}
    </div>
  )
}
