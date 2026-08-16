import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type { DokumentRow, Ebene, Profile } from '../lib/types'
import { EBENE_COLOR, EBENE_LABEL, tagColor } from '../lib/sourceColors'
import { formatDate } from '../lib/format'
import { fileNameFromPath } from '../components/DocumentPreviewModal'
import { DokumentDetailModal } from '../components/DokumentDetailModal'

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

  const [showForm, setShowForm] = useState(false)
  const [newTitel, setNewTitel] = useState('')
  const [newEbene, setNewEbene] = useState<Ebene | ''>('')
  const [newTags, setNewTags] = useState<string[]>([])
  const [newTagInput, setNewTagInput] = useState('')
  const [newInhalt, setNewInhalt] = useState('')
  const [newFile, setNewFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [openDoc, setOpenDoc] = useState<DokumentRow | null>(null)

  async function loadDocuments() {
    const { data } = await supabase.from('dokumente').select('*').is('parent_id', null).order('erstellt_am', { ascending: false })
    setDocuments(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadDocuments()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      const { data: profileRow } = await supabase.from('profiles').select('*').eq('id', data.user.id).single()
      setProfile(profileRow)
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
    setNewTagInput('')
    setNewInhalt('')
    setNewFile(null)
    setFormError(null)
  }

  function addTag(tag: string) {
    const t = tag.trim()
    if (!t || newTags.includes(t)) return
    setNewTags((prev) => [...prev, t])
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

  const filtered = documents.filter((d) => {
    if (ebeneFilter !== 'alle' && d.ebene !== ebeneFilter) return false
    if (tagFilter && !d.tags.includes(tagFilter)) return false
    return true
  })

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="h-1.5 bg-topbar" aria-hidden="true" />
      <header className="bg-gradient-to-r from-primary to-primary-hover text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <h1 className="text-lg font-bold">Dokumente</h1>
          <Link to="/" className="mc-btn px-3 py-1.5 text-sm text-white/90 hover:bg-white/15 hover:text-white">
            Zurück zum Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
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
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {TAG_VORSCHLAEGE.filter((t) => !newTags.includes(t)).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => addTag(t)}
                    className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200"
                  >
                    + {t}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {newTags.map((t) => (
                  <span
                    key={t}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${tagColor(t).chip}`}
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => setNewTags((prev) => prev.filter((x) => x !== t))}
                      aria-label={`Tag "${t}" entfernen`}
                      className="hover:opacity-70"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  placeholder="eigener Tag + Enter"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addTag(newTagInput)
                      setNewTagInput('')
                    }
                  }}
                  className="mc-input !w-40 !py-1 !text-xs"
                />
              </div>
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
          {filtered.map((d) => (
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
              className="mc-card flex cursor-pointer items-start justify-between gap-3 p-3 hover:shadow-md"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <FileText className="mt-0.5 h-6 w-6 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-slate-900">{d.titel}</span>
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
                  className="mc-btn-danger !px-2 !py-1 !text-xs shrink-0"
                >
                  Löschen
                </button>
              )}
            </li>
          ))}
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
          onClose={() => setOpenDoc(null)}
          onDeleted={() => {
            setOpenDoc(null)
            loadDocuments()
          }}
        />
      )}
    </div>
  )
}
