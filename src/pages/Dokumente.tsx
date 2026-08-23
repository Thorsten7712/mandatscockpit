import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { File, FileImage, FileText, Search, StickyNote, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type { DokumentRow, Ebene, Profile } from '../lib/types'
import { EBENE_COLOR, EBENE_LABEL, tagColor } from '../lib/sourceColors'
import { formatDate } from '../lib/format'
import { fileExtension, fileNameFromPath, IMAGE_EXTENSIONS } from '../components/DocumentPreviewModal'
import { DokumentDetailModal } from '../components/DokumentDetailModal'
import { TagEditor } from '../components/TagEditor'
import { istDokumentUngelesen, markiereGelesen, markiereUngelesen } from '../lib/dokumenteGelesen'

// Vorschläge, keine feste Liste - Nutzer können jederzeit eigene Tags
// eintragen (siehe Eingabefeld im Formular unten).
const TAG_VORSCHLAEGE = ['Antrag', 'Fact Sheet', 'Argumentationshilfe']

const EBENEN_ORDER: Ebene[] = ['kommune', 'kreis', 'land', 'bund']

/** Bund braucht keine Gliederung - es gibt nur einen Bundestag (analog src/lib/gliederung.ts). */
function gliederungFuer(profile: Profile | null, ebene: Ebene): string | null {
  if (!profile) return null
  if (ebene === 'kommune') return profile.gliederung_kommune
  if (ebene === 'kreis') return profile.gliederung_kreis
  if (ebene === 'land') return profile.gliederung_land
  return null
}

function chipClass(active: boolean): string {
  return `rounded-full px-3 py-1 text-xs font-medium transition-colors ${
    active ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
  }`
}

/** Datei-Typ-Icon für die Listenkarte - variiert nur das Glyph, nicht die
 *  Farbe (bewusst zurückhaltend, kein neues Farbsystem). */
function docIcon(d: DokumentRow) {
  if (!d.datei_url) return StickyNote
  const ext = fileExtension(d.datei_url)
  if (IMAGE_EXTENSIONS.has(ext)) return FileImage
  if (ext === 'pdf') return FileText
  return File
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
 * docs/CHANGELOG.md.
 */
export default function Dokumente() {
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [documents, setDocuments] = useState<DokumentRow[]>([])
  const [authorNames, setAuthorNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)

  const [ebeneFilter, setEbeneFilter] = useState<Ebene | 'alle'>('alle')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [newTitel, setNewTitel] = useState('')
  const [newEbene, setNewEbene] = useState<Ebene | ''>('')
  const [newTags, setNewTags] = useState<string[]>([])
  const [newInhalt, setNewInhalt] = useState('')
  const [newFile, setNewFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [openDoc, setOpenDoc] = useState<DokumentRow | null>(null)

  const [kinderByParent, setKinderByParent] = useState<Map<string, { erstellt_am: string }[]>>(new Map())
  const [gelesenMap, setGelesenMap] = useState<Map<string, string>>(new Map())

  async function loadDocuments() {
    const { data } = await supabase.from('dokumente').select('*').is('parent_id', null).order('erstellt_am', { ascending: false })
    setDocuments(data ?? [])
    setLoading(false)
  }

  // Für die Fett/Nicht-fett-Markierung (siehe src/lib/dokumenteGelesen.ts):
  // Erstellungsdaten aller sichtbaren Notizen je Top-Level-Dokument sowie die
  // eigenen Gelesen-Zeitstempel. Wird nach dem Schließen der Detailansicht
  // erneut geladen, damit gerade gelesene Dokumente sofort nicht mehr fett
  // erscheinen.
  async function loadLeseStatus(uid: string) {
    const { data: kinder } = await supabase.from('dokumente').select('parent_id, erstellt_am').not('parent_id', 'is', null)
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
    setNewFile(null)
    setFormError(null)
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!userId) return
    if (!newTitel.trim()) {
      setFormError('Titel ist erforderlich.')
      return
    }
    if (!newInhalt.trim() && !newFile) {
      setFormError('Entweder Text oder eine Datei angeben.')
      return
    }
    if (!newEbene) {
      setFormError('Ebene ist erforderlich.')
      return
    }

    setSaving(true)
    setFormError(null)

    let dateiUrl: string | null = null
    if (newFile) {
      const path = `${userId}/${Date.now()}-${newFile.name}`
      const { error: uploadError } = await supabase.storage.from('dokumente').upload(path, newFile)
      if (uploadError) {
        setFormError(uploadError.message)
        setSaving(false)
        return
      }
      dateiUrl = path
    }

    const gliederung = gliederungFuer(profile, newEbene)
    const { error } = await supabase.from('dokumente').insert({
      user_id: userId,
      titel: newTitel.trim(),
      sichtbarkeit: 'geteilt',
      ebene: newEbene,
      gliederung,
      tags: newTags,
      inhalt: newInhalt.trim() || null,
      datei_url: dateiUrl,
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

  async function handleToggleGelesen(d: DokumentRow, ungelesen: boolean) {
    if (!userId) return
    if (ungelesen) await markiereGelesen(supabase, d.id, userId)
    else await markiereUngelesen(supabase, d.id, userId)
    await loadLeseStatus(userId)
  }

  async function handleDelete(d: DokumentRow) {
    if (!window.confirm(`"${d.titel}" wirklich löschen?`)) return
    if (d.datei_url) await supabase.storage.from('dokumente').remove([d.datei_url])
    await supabase.from('dokumente').delete().eq('id', d.id)
    setOpenDoc(null)
    await loadDocuments()
  }

  const eigeneEbenen = profile?.ebenen ?? []
  const ebenenPresent = EBENEN_ORDER.filter((e) => documents.some((d) => d.ebene === e))
  const tagsPresent = Array.from(new Set(documents.flatMap((d) => d.tags))).sort((a, b) => a.localeCompare(b, 'de'))
  const unreadCount = documents.filter((d) => istDokumentUngelesen(d, kinderByParent.get(d.id) ?? [], gelesenMap.get(d.id))).length

  const filtered = documents.filter((d) => {
    if (ebeneFilter !== 'alle' && d.ebene !== ebeneFilter) return false
    if (tagFilter && !d.tags.includes(tagFilter)) return false
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      const authorName = d.user_id !== userId ? authorNames.get(d.user_id) ?? '' : ''
      const haystack = [d.titel, d.inhalt ?? '', ...d.tags, authorName].join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="h-1.5 bg-topbar" aria-hidden="true" />
      <header className="bg-gradient-to-r from-primary to-primary-hover text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold">Dokumente</h1>
            {unreadCount > 0 && (
              <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-primary">
                {unreadCount}
              </span>
            )}
          </div>
          <Link to="/" className="mc-btn px-3 py-1.5 text-sm text-white/90 hover:bg-white/15 hover:text-white">
            Zurück zum Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="relative mb-3 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Dokumente durchsuchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="mc-input w-full pl-9 pr-8"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Suche leeren"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {ebenenPresent.length > 0 && (
              <>
                <button type="button" onClick={() => setEbeneFilter('alle')} className={chipClass(ebeneFilter === 'alle')}>
                  Alle Ebenen
                </button>
                {ebenenPresent.map((e) => (
                  <button key={e} type="button" onClick={() => setEbeneFilter(e)} className={chipClass(ebeneFilter === e)}>
                    {EBENE_LABEL[e]}
                  </button>
                ))}
              </>
            )}
            {tagsPresent.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTagFilter((cur) => (cur === t ? null : t))}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-opacity ${tagColor(t).chip} ${
                  tagFilter === t ? `ring-2 ring-offset-1 ${tagColor(t).ring}` : 'opacity-60 hover:opacity-100'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setShowForm((v) => !v)} className={showForm ? 'mc-btn-ghost' : 'mc-btn-primary'}>
            {showForm ? 'Abbrechen' : '+ Dokument'}
          </button>
        </div>

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
              placeholder="Text (optional)"
              value={newInhalt}
              onChange={(e) => setNewInhalt(e.target.value)}
              className="mc-input w-full"
              rows={3}
            />
            <input type="file" onChange={(e) => setNewFile(e.target.files?.[0] ?? null)} className="w-full text-sm" />
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <button type="submit" disabled={saving} className="mc-btn-primary">
              {saving ? 'Speichern...' : 'Dokument speichern'}
            </button>
          </form>
        )}

        <ul className="space-y-2">
          {filtered.map((d, idx) => {
            const ungelesen = istDokumentUngelesen(d, kinderByParent.get(d.id) ?? [], gelesenMap.get(d.id))
            const Icon = docIcon(d)
            return (
            <li
              key={d.id}
              role="button"
              tabIndex={0}
              onClick={() => setOpenDoc(d)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setOpenDoc(d)
                }
              }}
              style={{ animationDelay: `${Math.min(idx, 8) * 30}ms` }}
              className="mc-card mc-animate-slide group flex cursor-pointer items-start justify-between gap-3 p-3 transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]"
            >
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleToggleGelesen(d, ungelesen)
                  }}
                  aria-label={ungelesen ? 'Als gelesen markieren' : 'Als ungelesen markieren'}
                  title={ungelesen ? 'Als gelesen markieren' : 'Als ungelesen markieren'}
                  className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-slate-100"
                >
                  <span
                    className={`h-2 w-2 rounded-full transition-opacity ${
                      ungelesen ? 'bg-primary opacity-100' : 'bg-transparent opacity-0 ring-1 ring-slate-300 group-hover:opacity-100'
                    }`}
                  />
                </button>
                <Icon className="mt-0.5 h-6 w-6 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`truncate text-sm text-slate-900 ${ungelesen ? 'font-bold' : 'font-normal'}`}>
                      {d.titel}
                    </span>
                    {d.ebene && (
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${EBENE_COLOR[d.ebene].chip}`}
                      >
                        {EBENE_LABEL[d.ebene]}
                        {d.gliederung ? ` · ${d.gliederung}` : ''}
                      </span>
                    )}
                    {d.tags.map((t) => (
                      <span key={t} className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${tagColor(t).chip}`}>
                        {t}
                      </span>
                    ))}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {d.user_id !== userId && `${authorNames.get(d.user_id) ?? 'Unbekannt'} · `}
                    {formatDate(d.erstellt_am)}
                    {d.datei_url && ` · 📎 ${fileNameFromPath(d.datei_url)}`}
                  </p>
                  {d.inhalt && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{d.inhalt}</p>}
                </div>
              </div>
              {d.user_id === userId && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(d)
                  }}
                  className="mc-btn-danger !shrink-0 !px-2 !py-1 !text-xs"
                >
                  Löschen
                </button>
              )}
            </li>
            )
          })}
          {!loading && filtered.length === 0 && (
            <li className="mc-card p-6 text-center text-sm text-slate-400">
              {documents.length === 0 ? 'Noch keine Dokumente.' : 'Keine Dokumente für diese Auswahl.'}
            </li>
          )}
        </ul>
      </div>

      {openDoc && (
        <DokumentDetailModal
          document={openDoc}
          onClose={() => {
            setOpenDoc(null)
            if (userId) loadLeseStatus(userId)
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
