import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Archive, ChevronLeft, ChevronRight, FileText, List as ListIcon, Search, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type { DokumentListenZeile, DokumentRow, Ebene, Profile } from '../lib/types'
import { DOKUMENT_LISTEN_SPALTEN, ladeDokument, sucheDokumente } from '../lib/dokumentSpalten'
import { EBENE_LABEL } from '../lib/sourceColors'
import { formatDate } from '../lib/format'
import { DokumentDetailModal } from '../components/DokumentDetailModal'
import { TagEditor } from '../components/TagEditor'
import { FilterAuswahl } from '../components/FilterAuswahl'
import { drucksachennummer, grundnummer, gruppiereVorgaenge, tagGruppe, titelOhneNummer } from '../lib/vorgaenge'
import { istDokumentUngelesen, markiereGelesen, markiereUngelesen } from '../lib/dokumenteGelesen'
import { archivGrund, ladeSitzungenJeDokument, type SitzungenJeDokument } from '../lib/dokumenteArchiv'
import { vorschau } from '../lib/vorlageMarkdown'
import { alleZeilen } from '../lib/alleZeilen'

// Vorschläge, keine feste Liste - Nutzer können jederzeit eigene Tags
// eintragen (siehe Eingabefeld im Formular unten).
const TAG_VORSCHLAEGE = ['Antrag', 'Fact Sheet', 'Argumentationshilfe']

const EBENEN_ORDER: Ebene[] = ['kommune', 'kreis', 'land', 'bund']

/** 0 = "Alle" (keine Seitenaufteilung). */
const SEITENGROESSEN = [10, 25, 50, 100, 0]
const SEITENGROESSE_KEY = 'mc.dokumente.proSeite'
const SEITENGROESSE_STANDARD = 25

// Einzige Stelle im Projekt, die localStorage nutzt: eine reine Anzeige-
// Vorliebe pro Gerät, für die sich weder eine Tabelle noch eine RLS-Policy
// lohnen würde (anders als todo_board_settings, das die Board-Struktur
// geräteübergreifend halten muss). Lesen/Schreiben gekapselt, damit ein
// gesperrter Storage (Privates Fenster, blockierte Site-Daten) die Seite
// nicht beim Rendern abstürzen lässt.
function ladeSeitengroesse(): number {
  try {
    // Erst auf null prüfen: Number(null) ist 0, und 0 ist ein gültiger Wert
    // ("Alle") - ohne diese Zeile startet die Seite ohne Aufteilung.
    const gespeichert = window.localStorage.getItem(SEITENGROESSE_KEY)
    if (gespeichert === null) return SEITENGROESSE_STANDARD
    const wert = Number(gespeichert)
    return SEITENGROESSEN.includes(wert) ? wert : SEITENGROESSE_STANDARD
  } catch {
    return SEITENGROESSE_STANDARD
  }
}

function speichereSeitengroesse(wert: number) {
  try {
    window.localStorage.setItem(SEITENGROESSE_KEY, String(wert))
  } catch {
    // Anzeige-Vorliebe geht verloren, mehr nicht - kein Grund für eine Fehlermeldung.
  }
}

/** Bund braucht keine Gliederung - es gibt nur einen Bundestag (analog src/lib/gliederung.ts). */
function gliederungFuer(profile: Profile | null, ebene: Ebene): string | null {
  if (!profile) return null
  if (ebene === 'kommune') return profile.gliederung_kommune
  if (ebene === 'kreis') return profile.gliederung_kreis
  if (ebene === 'land') return profile.gliederung_land
  return null
}

function chipClass(active: boolean): string {
  return `min-h-8.5 rounded-full px-3 text-[13px] transition-colors ${
    active ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
  }`
}

/**
 * Dokumenten-Hub: eigener Reiter neben dem Archiv für Dokumente, die für die
 * ganze Partei/Ebene/Gliederung geteilt werden (z. B. hochgeladene
 * Sitzungsvorlagen) - RLS in 0033/0034_dokumente*.sql erledigt die
 * Sichtbarkeitsfilterung server-seitig, hier wird nur noch client-seitig
 * nach Ebene/Tag gefiltert. Klick auf ein Dokument öffnet
 * DokumentDetailModal, wo eigene (persönliche, Ebene-weite oder mit
 * einzelnen Personen geteilte) Notizen/Analysen daran angehängt werden -
 * eine frühere separate "Meine Dokumente"-Ansicht entfällt dadurch, siehe
 * docs/CHANGELOG.md. Gelöscht wird bewusst NUR dort und nicht aus dieser
 * Liste heraus: ein geteiltes Dokument verschwindet für alle, das gehört
 * hinter die Detailansicht mit ihrer Warnung, nicht neben einen Listeneintrag.
 */
/** Ab dieser Breite steht das geöffnete Dokument neben der Liste, darunter im Fenster. */
const BREIT = '(min-width: 1024px)'
/** iPad und schmale Fenster: ist ein Dokument offen, klappt die Liste in eine
 *  Schublade (Feinschliff 28.10.2026, Entwurf B) – sonst bleibt dem Text zu
 *  wenig Breite und Höhe. */
const KOMPAKT = '(pointer: coarse), (max-width: 1279px)'

function useMedien(abfrage: string): boolean {
  const [passt, setPasst] = useState(() => window.matchMedia(abfrage).matches)
  useEffect(() => {
    const mq = window.matchMedia(abfrage)
    const beiAenderung = () => setPasst(mq.matches)
    mq.addEventListener('change', beiAenderung)
    return () => mq.removeEventListener('change', beiAenderung)
  }, [abfrage])
  return passt
}

export default function Dokumente() {
  const breit = useMedien(BREIT)
  const kompakt = useMedien(KOMPAKT)
  const [listeOffen, setListeOffen] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [documents, setDocuments] = useState<DokumentListenZeile[]>([])
  const [authorNames, setAuthorNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)

  const [ebeneFilter, setEbeneFilter] = useState<Ebene | 'alle'>('alle')
  const [aktiveTags, setAktiveTags] = useState<string[]>([])
  // Aufgeklappter Vorgang in der Liste (Schlüssel aus gruppiereVorgaenge()).
  const [offenerVorgang, setOffenerVorgang] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [nurMeineGremien, setNurMeineGremien] = useState(false)
  const [archivEinbeziehen, setArchivEinbeziehen] = useState(false)

  // Verknüpfte Sitzungen (Archiv-Regel + "Meine Gremien"-Filter) und die
  // eigenen Gremien aus user_gremien (0005_user_gremien.sql). Ein Dokument
  // kann an mehreren Sitzungen hängen (0042_sitzung_dokumente.sql).
  const [sitzungen, setSitzungen] = useState<SitzungenJeDokument>(new Map())
  // Ohne Sitzungsdaten wäre kein Dokument archiviert - das darf nicht
  // stillschweigend wie eine leere Archiv-Ablage aussehen.
  const [sessionFehler, setSessionFehler] = useState<string | null>(null)
  const [ladeFehler, setLadeFehler] = useState<string | null>(null)
  const [meineGremien, setMeineGremien] = useState<string[]>([])

  const [seite, setSeite] = useState(1)
  const [proSeite, setProSeite] = useState(ladeSeitengroesse)

  const [showForm, setShowForm] = useState(false)
  const [newTitel, setNewTitel] = useState('')
  const [newEbene, setNewEbene] = useState<Ebene | ''>('')
  const [newTags, setNewTags] = useState<string[]>([])
  const [newInhalt, setNewInhalt] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [openDoc, setOpenDoc] = useState<DokumentRow | null>(null)
  // Treffer der Datenbanksuche; null = noch keine Antwort auf den aktuellen Begriff.
  const [suchTreffer, setSuchTreffer] = useState<Set<string> | null>(null)
  const [suchFehler, setSuchFehler] = useState<string | null>(null)

  // Die Liste hat den Text nicht (0058) - beim Öffnen das ganze Dokument laden.
  async function oeffne(id: string) {
    const voll = await ladeDokument(id)
    if (voll) setOpenDoc(voll)
  }

  // Erst nach einer kurzen Tipppause fragen, sonst ginge pro Buchstabe eine
  // Abfrage raus. Eine veraltete Antwort (der Begriff hat sich inzwischen
  // geändert) wird verworfen.
  useEffect(() => {
    const begriff = searchQuery.trim()
    if (!begriff) {
      setSuchTreffer(null)
      setSuchFehler(null)
      return
    }
    let veraltet = false
    const zeitgeber = setTimeout(async () => {
      const { ids, fehler } = await sucheDokumente(begriff)
      if (veraltet) return
      setSuchTreffer(ids)
      setSuchFehler(fehler)
    }, 250)
    return () => {
      veraltet = true
      clearTimeout(zeitgeber)
    }
  }, [searchQuery])

  const [kinderByParent, setKinderByParent] = useState<Map<string, { erstellt_am: string }[]>>(new Map())
  const [gelesenMap, setGelesenMap] = useState<Map<string, string>>(new Map())

  async function loadDocuments() {
    // Seitenweise: als eine Abfrage kamen nur die neuesten 1.000 Dokumente an,
    // die ältesten fehlten in Liste und Suche (src/lib/alleZeilen.ts).
    // Ohne den vollen Text (DOKUMENT_LISTEN_SPALTEN, 0058): die Liste zeigt
    // nur die gespeicherte Vorschau, gesucht wird in der Datenbank.
    const { zeilen: rows, fehler: dokFehler } = await alleZeilen<DokumentListenZeile>((von, bis) =>
      supabase
        .from('dokumente')
        .select(DOKUMENT_LISTEN_SPALTEN)
        .is('parent_id', null)
        .order('erstellt_am', { ascending: false })
        .order('id')
        .range(von, bis),
    )
    // Datum/Gremium der verknüpften Sitzungen: entscheidet, ob ein Dokument
    // archiviert ist (Sitzung vorbei) und ob es unter "Meine Gremien" fällt.
    //
    // Die Sitzungen werden VOR setDocuments() abgewartet und beide States
    // zusammen gesetzt. Umgekehrt (erst Dokumente, dann Sitzungen) rendert
    // React dazwischen einmal mit leerer Sitzungs-Map - und dann gilt kein
    // Dokument als archiviert, die Liste zeigt also für einen Moment auch das
    // Archiv. Auf langsamer Verbindung ist dieses Fenster gut sichtbar.
    const { sitzungen: geladen, fehler } = await ladeSitzungenJeDokument(
      supabase,
      rows.map((r) => r.id),
    )
    setSitzungen(geladen)
    setSessionFehler(fehler)
    // Eigener Hinweis: sonst sähe eine abgebrochene Liste aus wie eine vollständige.
    setLadeFehler(dokFehler)
    setDocuments(rows)
    setLoading(false)
  }

  // Für die Fett/Nicht-fett-Markierung (siehe src/lib/dokumenteGelesen.ts):
  // Erstellungsdaten aller sichtbaren Notizen je Top-Level-Dokument sowie die
  // eigenen Gelesen-Zeitstempel. Wird nach dem Schließen der Detailansicht
  // erneut geladen, damit gerade gelesene Dokumente sofort nicht mehr fett
  // erscheinen.
  async function loadLeseStatus(uid: string) {
    const { zeilen: kinder } = await alleZeilen<{ parent_id: string; erstellt_am: string }>((von, bis) =>
      supabase.from('dokumente').select('parent_id, erstellt_am').not('parent_id', 'is', null).order('id').range(von, bis),
    )
    const byParent = new Map<string, { erstellt_am: string }[]>()
    for (const k of kinder ?? []) {
      const list = byParent.get(k.parent_id as string) ?? []
      list.push({ erstellt_am: k.erstellt_am })
      byParent.set(k.parent_id as string, list)
    }
    setKinderByParent(byParent)

    const { data: gelesen } = await supabase.from('dokument_gelesen').select('dokument_id, gelesen_am').eq('user_id', uid)
    setGelesenMap(new Map((gelesen ?? []).map((g) => [g.dokument_id, g.gelesen_am])))
  }

  useEffect(() => {
    loadDocuments()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      const { data: profileRow } = await supabase.from('profiles').select('*').eq('id', data.user.id).single()
      setProfile(profileRow)
      const { data: gremienRows } = await supabase.from('user_gremien').select('gremium').eq('user_id', data.user.id)
      setMeineGremien((gremienRows ?? []).map((g) => g.gremium as string))
      await loadLeseStatus(data.user.id)
    })
  }, [])

  // Ersteller-Namen für fremde geteilte Dokumente nachladen (eigene Dokumente
  // brauchen das nicht, dort wird ohnehin nicht "von ..." angezeigt).
  useEffect(() => {
    const fremdeIds = Array.from(new Set(documents.filter((d) => d.user_id !== userId).map((d) => d.user_id)))
    if (fremdeIds.length === 0) {
      setAuthorNames(new Map())
      return
    }
    supabase
      .from('profiles')
      .select('id, name')
      .in('id', fremdeIds)
      .then(({ data }) => setAuthorNames(new Map((data ?? []).map((p) => [p.id as string, p.name as string]))))
  }, [documents, userId])

  function resetForm() {
    setNewTitel('')
    setNewEbene('')
    setNewTags([])
    setNewInhalt('')
    setFormError(null)
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!userId) return
    if (!newTitel.trim()) {
      setFormError('Titel ist erforderlich.')
      return
    }
    // Seit 0052_uploads_sperren.sql nur noch Text - Dateien bringt allein der ALLRIS-Import.
    if (!newInhalt.trim()) {
      setFormError('Text ist erforderlich.')
      return
    }
    if (!newEbene) {
      setFormError('Ebene ist erforderlich.')
      return
    }

    setSaving(true)
    setFormError(null)

    const gliederung = gliederungFuer(profile, newEbene)
    const { error } = await supabase.from('dokumente').insert({
      user_id: userId,
      titel: newTitel.trim(),
      sichtbarkeit: 'geteilt',
      ebene: newEbene,
      gliederung,
      tags: newTags,
      inhalt: newInhalt.trim() || null,
      vorschau: vorschau(newInhalt.trim() || null),
    })
    if (error) {
      setFormError(error.message)
      setSaving(false)
      return
    }

    resetForm()
    setShowForm(false)
    setSaving(false)
    await loadDocuments()
  }

  async function handleToggleGelesen(d: DokumentListenZeile, ungelesen: boolean) {
    if (!userId) return
    if (ungelesen) await markiereGelesen(supabase, d.id, userId)
    else await markiereUngelesen(supabase, d.id, userId)
    await loadLeseStatus(userId)
  }

  const eigeneEbenen = profile?.ebenen ?? []
  const ebenenPresent = EBENEN_ORDER.filter((e) => documents.some((d) => d.ebene === e))
  const tagsPresent = Array.from(new Set(documents.flatMap((d) => d.tags))).sort((a, b) => a.localeCompare(b, 'de'))
  // Archiv-Zustand einmal je Render für alle Dokumente (siehe
  // src/lib/dokumenteArchiv.ts) - wird zum Ausblenden, für das Archiv-Fähnchen
  // und für den Lesestand gebraucht: Archiviertes gilt als gelesen.
  const archivGrundById = new Map(documents.map((d) => [d.id, archivGrund(d, sitzungen)]))
  const archivGesamt = Array.from(archivGrundById.values()).filter(Boolean).length
  const offenGesamt = documents.length - archivGesamt
  const istUngelesen = (d: DokumentListenZeile) =>
    istDokumentUngelesen(d, kinderByParent.get(d.id) ?? [], gelesenMap.get(d.id), Boolean(archivGrundById.get(d.id)))
  const unreadCount = documents.filter(istUngelesen).length

  // Wer sucht, sucht im Gesamtbestand: eine aktive Suche zieht das Archiv
  // automatisch mit hinein, auch ohne den Archiv-Schalter (Nutzerwunsch).
  const sucheAktiv = searchQuery.trim().length > 0
  const zeigeArchiv = archivEinbeziehen || sucheAktiv

  const filtered = documents.filter((d) => {
    if (!zeigeArchiv && archivGrundById.get(d.id)) return false
    if (nurMeineGremien) {
      // Ohne verknüpfte Sitzung lässt sich kein Gremium bestimmen - solche
      // Dokumente fallen unter diesem Filter bewusst heraus. Bei mehreren
      // Sitzungen genügt eine aus den eigenen Gremien.
      const gremien = (sitzungen.get(d.id) ?? []).map((si) => si.gremium)
      if (!gremien.some((g) => g && meineGremien.includes(g))) return false
    }
    if (ebeneFilter !== 'alle' && d.ebene !== ebeneFilter) return false
    // Innerhalb einer Gruppe (z. B. zwei Fraktionen) genügt ein Treffer,
    // über Gruppen hinweg müssen alle passen.
    for (const gruppe of new Set(aktiveTags.map(tagGruppe))) {
      if (!aktiveTags.some((t) => tagGruppe(t) === gruppe && d.tags.includes(t))) return false
    }
    if (sucheAktiv) {
      // Titel, Tags und Text durchsucht die Datenbank (sucheDokumente); den
      // Namen der Autorin/des Autors steht dort nicht, der bleibt hier.
      const q = searchQuery.trim().toLowerCase().replace(/\s+/g, ' ')
      const authorName = d.user_id !== userId ? (authorNames.get(d.user_id) ?? '').toLowerCase() : ''
      if (!suchTreffer?.has(d.id) && !(authorName && authorName.includes(q))) return false
    }
    return true
  })

  // proSeite === 0 heißt "Alle" - dann gibt es genau eine Seite. Die Seitenzahl
  // wird beim Rendern geklemmt statt per Effekt zurückgesetzt: schrumpft die
  // Treffermenge (Filter/Suche), landet man sofort auf der letzten gültigen
  // Seite, ohne einen Zwischen-Render mit leerer Liste.
  // Eine Zeile je Vorgang (Anfrage + Antworten), geblättert wird über Vorgänge.
  const vorgaenge = gruppiereVorgaenge(filtered)
  const seitenAnzahl = proSeite === 0 ? 1 : Math.max(1, Math.ceil(vorgaenge.length / proSeite))
  const aktuelleSeite = Math.min(seite, seitenAnzahl)
  const sichtbare =
    proSeite === 0 ? vorgaenge : vorgaenge.slice((aktuelleSeite - 1) * proSeite, aktuelleSeite * proSeite)

  function tagUmschalten(tag: string) {
    setAktiveTags((vorher) => (vorher.includes(tag) ? vorher.filter((t) => t !== tag) : [...vorher, tag]))
    setSeite(1)
  }

  function handleProSeite(wert: number) {
    setProSeite(wert)
    speichereSeitengroesse(wert)
    setSeite(1)
  }

  /** Jede Filteränderung beginnt wieder auf Seite 1 - sonst zeigt eine frisch
   *  gefilterte Liste eine leere Seite 4. */
  function mitSeitenreset<T>(setter: (wert: T) => void): (wert: T) => void {
    return (wert) => {
      setter(wert)
      setSeite(1)
    }
  }

  // Ist ein Dokument offen, steht auf dem iPad die Liste samt Suche und Filtern
  // in der Schublade; sonst wie gewohnt über der Liste.
  const schublade = breit && kompakt && openDoc !== null
  useEffect(() => {
    if (!schublade || !listeOffen) return
    function beiEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setListeOffen(false)
    }
    window.addEventListener('keydown', beiEscape)
    return () => window.removeEventListener('keydown', beiEscape)
  }, [schublade, listeOffen])
  const suchfeld = (
    <div className="relative w-full sm:w-[380px]">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        placeholder="Titel, Text, Drucksachennummer …"
        value={searchQuery}
        onChange={(e) => mitSeitenreset(setSearchQuery)(e.target.value)}
        className="mc-input min-h-11 w-full rounded-[10px]! pl-10 pr-9 text-[15px]!"
      />
      {searchQuery && (
        <button
          type="button"
          onClick={() => mitSeitenreset(setSearchQuery)('')}
          aria-label="Suche leeren"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
  const filterzeile = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterAuswahl
          tags={tagsPresent}
          aktiv={aktiveTags}
          onUmschalten={tagUmschalten}
          zusatz={
            ebenenPresent.length > 1 && (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Ebene</span>
                <div className="flex flex-wrap gap-1.5">
                  {(['alle', ...ebenenPresent] as const).map((e) => (
                    <button
                      key={e}
                      type="button"
                      aria-pressed={ebeneFilter === e}
                      onClick={() => mitSeitenreset(setEbeneFilter)(e)}
                      className={chipClass(ebeneFilter === e)}
                    >
                      {e === 'alle' ? 'Alle Ebenen' : EBENE_LABEL[e]}
                    </button>
                  ))}
                </div>
              </div>
            )
          }
        />
        <span className="mx-1 h-5 w-px bg-slate-300" aria-hidden="true" />
        {meineGremien.length > 0 && (
          <button
            type="button"
            onClick={() => mitSeitenreset(setNurMeineGremien)(!nurMeineGremien)}
            title={`Nur Dokumente aus Sitzungen von: ${meineGremien.join(', ')}`}
            className={chipClass(nurMeineGremien)}
          >
            Meine Gremien
          </button>
        )}
        {archivGesamt > 0 && (
          <button
            type="button"
            onClick={() => mitSeitenreset(setArchivEinbeziehen)(!archivEinbeziehen)}
            disabled={sucheAktiv}
            title={
              sucheAktiv
                ? 'Bei aktiver Suche ist das Archiv immer eingeschlossen.'
                : 'Auch Dokumente vergangener Sitzungen anzeigen'
            }
            className={`${chipClass(zeigeArchiv)} inline-flex items-center gap-1 disabled:cursor-not-allowed`}
          >
            <Archive className="h-3 w-3" />
            Archiv ({archivGesamt})
          </button>
        )}
        {aktiveTags.map((t) => (
          <span
            key={t}
            className="inline-flex min-h-7.5 items-center gap-1 rounded-full bg-primary/10 pl-3 pr-1 text-[13px] font-medium text-primary"
          >
            {t}
            <button
              type="button"
              onClick={() => tagUmschalten(t)}
              aria-label={`Filter ${t} entfernen`}
              className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-primary/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        {ebeneFilter !== 'alle' && (
          <span className="inline-flex min-h-7.5 items-center gap-1 rounded-full bg-primary/10 pl-3 pr-1 text-[13px] font-medium text-primary">
            {EBENE_LABEL[ebeneFilter]}
            <button
              type="button"
              onClick={() => mitSeitenreset(setEbeneFilter)('alle')}
              aria-label="Ebenen-Filter entfernen"
              className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-primary/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>
      <button type="button" onClick={() => setShowForm((v) => !v)} className={showForm ? 'mc-btn-ghost' : 'mc-btn-primary'}>
        {showForm ? 'Abbrechen' : '+ Dokument'}
      </button>
    </div>
  )

  return (
    <div>
      {schublade ? (
        <header className="mb-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setListeOffen(true)}
            aria-expanded={listeOffen}
            aria-controls="vorgaenge-schublade"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[10px] border border-slate-300 bg-white px-3.5 text-sm font-semibold transition-colors hover:bg-slate-50"
          >
            <ListIcon className="h-4 w-4" />
            Vorgänge
            {unreadCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">{unreadCount}</span>
            )}
          </button>
          <h1 className="text-lg font-bold tracking-tight">Dokumente</h1>
          <span className="truncate text-sm text-slate-500">
            {offenGesamt.toLocaleString('de-DE')} offen
            {unreadCount > 0 ? ` · ${unreadCount.toLocaleString('de-DE')} ungelesen` : ''}
          </span>
        </header>
      ) : (
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="mc-page-title">Dokumente</h1>
          <span className="text-sm text-slate-500">
            {offenGesamt.toLocaleString('de-DE')} offen
            {unreadCount > 0 ? ` · ${unreadCount.toLocaleString('de-DE')} ungelesen` : ''}
            {archivGesamt > 0 ? ` · ${archivGesamt.toLocaleString('de-DE')} im Archiv` : ''}
          </span>
        </div>
        {suchfeld}
      </header>
      )}
      <div>
        {ladeFehler && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Die Dokumente konnten nicht vollständig geladen werden ({ladeFehler}) – die Liste ist
            unvollständig, auch die Suche findet nicht alles.
          </p>
        )}
        {suchFehler && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Die Suche ist fehlgeschlagen ({suchFehler}) – die Treffer sind unvollständig.
          </p>
        )}
        {sessionFehler && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Sitzungsdaten konnten nicht geladen werden ({sessionFehler}) – Dokumente vergangener Sitzungen
            werden deshalb gerade nicht ins Archiv einsortiert.
          </p>
        )}
        {sucheAktiv && archivGesamt > 0 && (
          <p className="mb-3 flex items-center gap-1.5 text-xs text-slate-500">
            <Archive className="h-3.5 w-3.5" />
            Die Suche schließt das Archiv mit ein.
          </p>
        )}

        {!schublade && filterzeile}

        {showForm && (
          <form onSubmit={handleAdd} className="mc-card mc-animate-pop mb-4 max-w-xl space-y-3 p-4">
            <input
              type="text"
              placeholder="Titel"
              value={newTitel}
              onChange={(e) => setNewTitel(e.target.value)}
              className="mc-input w-full"
              required
            />
            {eigeneEbenen.length === 0 ? (
              <p className="text-sm text-amber-600">
                Trage zuerst unter{' '}
                <Link to="/settings" className="underline">
                  Einstellungen → Meine Gremien
                </Link>{' '}
                deine Ebene(n) ein, um Dokumente anzulegen.
              </p>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Ebene</label>
                <select
                  value={newEbene}
                  onChange={(e) => setNewEbene(e.target.value as Ebene)}
                  className="mc-input w-full"
                  required
                >
                  <option value="">Bitte wählen...</option>
                  {eigeneEbenen.map((e) => {
                    const gl = gliederungFuer(profile, e)
                    const fehlendeGliederung = e !== 'bund' && !gl
                    return (
                      <option key={e} value={e} disabled={fehlendeGliederung}>
                        {EBENE_LABEL[e]}
                        {gl ? ` (${gl})` : fehlendeGliederung ? ' - keine Gliederung hinterlegt' : ''}
                      </option>
                    )
                  })}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Tags</label>
              <TagEditor tags={newTags} onChange={setNewTags} vorschlaege={TAG_VORSCHLAEGE} />
            </div>
            <textarea
              placeholder="Text"
              value={newInhalt}
              onChange={(e) => setNewInhalt(e.target.value)}
              className="mc-input w-full"
              rows={3}
            />
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <button type="submit" disabled={saving} className="mc-btn-primary">
              {saving ? 'Speichern...' : 'Dokument speichern'}
            </button>
          </form>
        )}

        <div
          className={
            breit
              ? `mc-card relative flex overflow-hidden ${schublade ? 'h-[calc(100dvh-6.5rem)] min-h-[480px]' : 'h-[calc(100vh-15rem)] min-h-[560px]'}`
              : ''
          }
        >
          {schublade && listeOffen && (
            <button
              type="button"
              aria-label="Vorgänge schließen"
              onClick={() => setListeOffen(false)}
              className="mc-animate-fade absolute inset-0 z-10 bg-slate-900/20"
            />
          )}
          <div
            id="vorgaenge-schublade"
            className={
              schublade
                ? listeOffen
                  ? 'mc-animate-slide absolute inset-y-0 left-0 z-20 flex w-[min(440px,85%)] flex-col border-r border-slate-200 bg-white shadow-xl'
                  : 'hidden'
                : breit
                  ? 'flex w-[400px] shrink-0 flex-col border-r border-slate-100 xl:w-[440px]'
                  : ''
            }
          >
            {schublade && (
              <div className="flex shrink-0 flex-col gap-3 border-b border-slate-100 p-3 *:mb-0! *:w-full!">
                {suchfeld}
                {filterzeile}
              </div>
            )}
            <ul className={breit ? 'min-h-0 flex-1 overflow-y-auto' : 'mc-card overflow-hidden'}>
              {sichtbare.map((v) => {
                const kopf = v.teile[0]
                const neuester = v.teile.reduce((x, y) => (Date.parse(y.erstellt_am) > Date.parse(x.erstellt_am) ? y : x))
                const mehrteilig = v.teile.length > 1
                const ungelesenTeile = v.teile.filter(istUngelesen)
                const ungelesen = ungelesenTeile.length > 0
                const aktiv = v.teile.some((t) => t.id === openDoc?.id)
                const aufgeklappt = mehrteilig && offenerVorgang === v.schluessel
                // Archiv-Fähnchen nur, wenn der ganze Vorgang im Archiv liegt.
                const grund = v.teile.every((t) => archivGrundById.get(t.id)) ? archivGrundById.get(neuester.id) : null
                const tags = [...new Set(v.teile.flatMap((t) => t.tags))]
                const nummer = grundnummer(kopf.titel)
                const oeffneVorgang = () => {
                  setOffenerVorgang(mehrteilig ? v.schluessel : null)
                  // Mehrteilige Vorgänge klappen ihre Teile auf – die Schublade bleibt dann offen.
                  if (!mehrteilig) setListeOffen(false)
                  // Das Neueste zuerst – meist die Antwort, auf die man wartet.
                  oeffne((ungelesenTeile[ungelesenTeile.length - 1] ?? neuester).id)
                }
                return (
                  <li key={v.schluessel} className="border-b border-slate-100 last:border-b-0">
                    <div
                      role="button"
                      tabIndex={0}
                      aria-pressed={breit ? aktiv : undefined}
                      aria-expanded={mehrteilig ? aufgeklappt : undefined}
                      onClick={oeffneVorgang}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          oeffneVorgang()
                        }
                      }}
                      className={`group flex cursor-pointer gap-2 px-3 py-3 ${aktiv ? 'bg-primary/10' : 'hover:bg-slate-50'}`}
                    >
                      {/* Im Archiv gilt alles als gelesen – dort gibt es nichts umzuschalten. */}
                      {grund ? (
                        <span className="w-6 shrink-0" />
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            for (const t of v.teile) {
                              if (!archivGrundById.get(t.id)) handleToggleGelesen(t, ungelesen)
                            }
                          }}
                          aria-label={ungelesen ? 'Als gelesen markieren' : 'Als ungelesen markieren'}
                          title={ungelesen ? 'Als gelesen markieren' : 'Als ungelesen markieren'}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-slate-200/60"
                        >
                          <span
                            className={`h-2 w-2 rounded-full transition-opacity ${
                              ungelesen ? 'bg-primary opacity-100' : 'bg-transparent opacity-0 ring-1 ring-slate-300 group-hover:opacity-100'
                            }`}
                          />
                        </button>
                      )}
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="truncate font-mono">
                            {nummer ?? (kopf.user_id !== userId ? (authorNames.get(kopf.user_id) ?? 'Unbekannt') : 'Eigenes Dokument')}
                          </span>
                          {mehrteilig && (
                            <span className="rounded-full bg-slate-200/70 px-1.5 font-semibold text-slate-700">{v.teile.length}</span>
                          )}
                          <span className="ml-auto shrink-0">{formatDate(neuester.erstellt_am)}</span>
                        </div>
                        <span className={`text-[15px] leading-snug text-slate-900 ${ungelesen ? 'font-semibold' : 'font-medium'}`}>
                          {titelOhneNummer(kopf.titel)}
                        </span>
                        {mehrteilig ? (
                          <p className="text-[13px] text-slate-500">
                            {v.teile.length} Drucksachen · zuletzt {drucksachennummer(neuester.titel) ?? formatDate(neuester.erstellt_am)}
                            {ungelesenTeile.length > 0 && ` · ${ungelesenTeile.length} neu`}
                          </p>
                        ) : (
                          kopf.vorschau && <p className="line-clamp-2 text-[13px] leading-snug text-slate-500">{kopf.vorschau}</p>
                        )}
                        {(tags.length > 0 || grund) && (
                          <div className="flex flex-wrap gap-1">
                            {tags.slice(0, 3).map((t) => (
                              <span key={t} className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                                {t}
                              </span>
                            ))}
                            {tags.length > 3 && <span className="px-1 text-[11px] text-slate-500">+{tags.length - 3}</span>}
                            {grund && (
                              <span
                                title={grund === 'sitzung' ? 'Archiviert: die verknüpfte Sitzung ist vorbei' : 'Von Hand archiviert'}
                                className="inline-flex items-center gap-1 rounded-sm bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500"
                              >
                                <Archive className="h-2.5 w-2.5" />
                                Archiv
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {aufgeklappt && (
                      <ol className="mc-animate-slide flex flex-col bg-primary/5 pb-2 pl-11 pr-3">
                        {v.teile.map((t) => {
                          const teilAktiv = openDoc?.id === t.id
                          const teilNeu = istUngelesen(t)
                          return (
                            <li key={t.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  setListeOffen(false)
                                  oeffne(t.id)
                                }}
                                aria-pressed={teilAktiv}
                                className={`flex min-h-9 w-full items-center gap-2.5 border-l-2 px-2.5 text-left text-[13px] ${
                                  teilAktiv ? 'border-primary font-semibold' : 'border-slate-300 hover:bg-white/70'
                                }`}
                              >
                                <span className="w-28 shrink-0 font-mono text-slate-500">{drucksachennummer(t.titel) ?? '—'}</span>
                                <span className="min-w-0 flex-1 truncate">{titelOhneNummer(t.titel)}</span>
                                {teilNeu && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="ungelesen" />}
                                <span className="shrink-0 text-slate-500">{formatDate(t.erstellt_am)}</span>
                              </button>
                            </li>
                          )
                        })}
                      </ol>
                    )}
                  </li>
                )
              })}
              {!loading && filtered.length === 0 && (
                <li className="p-6 text-center text-sm text-slate-400">
                  {documents.length === 0 ? 'Noch keine Dokumente.' : 'Keine Dokumente für diese Auswahl.'}
                </li>
              )}
            </ul>

            {filtered.length > 0 && (
              <div
                className={`flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500 ${
                  breit ? 'shrink-0 border-t border-slate-100 px-3 py-2' : 'mt-4'
                }`}
              >
                <label className="flex items-center gap-2">
                  <span>Pro Seite</span>
                  <select
                    value={proSeite}
                    onChange={(e) => handleProSeite(Number(e.target.value))}
                    className="mc-input w-auto! py-1! text-sm!"
                  >
                    {SEITENGROESSEN.map((g) => (
                      <option key={g} value={g}>
                        {g === 0 ? 'Alle' : g}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-2">
                  <span>
                    {proSeite === 0
                      ? `${vorgaenge.length} Vorgänge`
                      : `${(aktuelleSeite - 1) * proSeite + 1}–${Math.min(aktuelleSeite * proSeite, vorgaenge.length)} von ${vorgaenge.length}`}
                  </span>
                  {seitenAnzahl > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setSeite(aktuelleSeite - 1)}
                        disabled={aktuelleSeite <= 1}
                        aria-label="Vorherige Seite"
                        className="mc-btn-ghost p-1.5!"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <span className="tabular-nums">
                        {aktuelleSeite} / {seitenAnzahl}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSeite(aktuelleSeite + 1)}
                        disabled={aktuelleSeite >= seitenAnzahl}
                        aria-label="Nächste Seite"
                        className="mc-btn-ghost p-1.5!"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {breit && (
            <div className="min-w-0 flex-1">
              {openDoc ? (
                <DokumentDetailModal
                  key={openDoc.id}
                  document={openDoc}
                  eingebettet
                  onClose={() => setOpenDoc(null)}
                  onGelesenGeaendert={() => userId && loadLeseStatus(userId)}
                  onDeleted={() => {
                    setOpenDoc(null)
                    loadDocuments()
                  }}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-slate-400">
                  <FileText className="h-8 w-8" />
                  Ein Dokument aus der Liste wählen.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!breit && openDoc && (
        <DokumentDetailModal
          document={openDoc}
          onGelesenGeaendert={() => userId && loadLeseStatus(userId)}
          onClose={() => {
            setOpenDoc(null)
            loadDocuments()
          }}
          onDeleted={() => {
            setOpenDoc(null)
            loadDocuments()
          }}
        />
      )}
    </div>
  )
}
