import { useEffect, useState, type FormEvent } from 'react'
import { Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type { DokumentRow, DokumentSichtbarkeit, Profile } from '../lib/types'
import { EBENE_COLOR, EBENE_LABEL, tagColor } from '../lib/sourceColors'
import { formatDateTime } from '../lib/format'
import { DocumentPreviewModal, fileNameFromPath } from './DocumentPreviewModal'
import { istNotizUngelesen } from '../lib/dokumenteGelesen'

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
export function DokumentDetailModal({
  document,
  onClose,
  onDeleted,
}: {
  document: DokumentRow
  onClose: () => void
  onDeleted: () => void
}) {
  const [userId, setUserId] = useState<string | null>(null)
  const [myProfile, setMyProfile] = useState<Profile | null>(null)
  const [children, setChildren] = useState<DokumentRow[]>([])
  const [authorNames, setAuthorNames] = useState<Map<string, string>>(new Map())
  const [shareNamesByChild, setShareNamesByChild] = useState<Map<string, string[]>>(new Map())
  const [candidates, setCandidates] = useState<Profile[]>([])

  const [previewDoc, setPreviewDoc] = useState<{ path: string; name: string } | null>(null)

  // Zeitstempel VOR dem Markieren-als-gelesen (siehe useEffect unten) - damit
  // Notizen, die seit dem letzten Öffnen neu dazugekommen sind, für die Dauer
  // dieser Modal-Sitzung noch fett bleiben (wie bei einem Mailprogramm),
  // obwohl im Hintergrund direkt der neue Gelesen-Zeitstempel gespeichert wird.
  const [gelesenAmVorDiesemOeffnen, setGelesenAmVorDiesemOeffnen] = useState<string | undefined>(undefined)

  const [newTitel, setNewTitel] = useState('')
  const [newInhalt, setNewInhalt] = useState('')
  const [newFile, setNewFile] = useState<File | null>(null)
  const [newTags, setNewTags] = useState<string[]>([])
  const [newTagInput, setNewTagInput] = useState('')
  const [newSichtbarkeit, setNewSichtbarkeit] = useState<DokumentSichtbarkeit>('persoenlich')
  const [teilenMit, setTeilenMit] = useState<string[]>([])
  const [shareSearch, setShareSearch] = useState('')
  const [shareDropdownOpen, setShareDropdownOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function loadChildren() {
    const { data } = await supabase
      .from('dokumente')
      .select('*')
      .eq('parent_id', document.id)
      .order('erstellt_am', { ascending: false })
    setChildren(data ?? [])
  }

  useEffect(() => {
    loadChildren()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      const { data: profileRow } = await supabase.from('profiles').select('*').eq('id', data.user.id).single()
      setMyProfile(profileRow)

      const { data: gelesenRows } = await supabase
        .from('dokument_gelesen')
        .select('gelesen_am')
        .eq('dokument_id', document.id)
        .eq('user_id', data.user.id)
      setGelesenAmVorDiesemOeffnen(gelesenRows?.[0]?.gelesen_am)

      await supabase
        .from('dokument_gelesen')
        .upsert(
          { dokument_id: document.id, user_id: data.user.id, gelesen_am: new Date().toISOString() },
          { onConflict: 'dokument_id,user_id' },
        )
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
          const byChild = new Map<string, string[]>()
          for (const s of shares ?? []) {
            const list = byChild.get(s.dokument_id as string) ?? []
            list.push(nameById.get(s.user_id as string) ?? '…')
            byChild.set(s.dokument_id as string, list)
          }
          setShareNamesByChild(byChild)
        })
    } else {
      setShareNamesByChild(new Map())
    }
  }, [children, userId])

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
            (p: Profile) => p.partei === myProfile.partei && (p.ebenen ?? []).some((e) => (myProfile.ebenen ?? []).includes(e)),
          ),
        )
      })
  }, [myProfile, userId])

  function resetForm() {
    setNewTitel('')
    setNewInhalt('')
    setNewFile(null)
    setNewTags([])
    setNewTagInput('')
    setNewSichtbarkeit('persoenlich')
    setTeilenMit([])
    setShareSearch('')
    setFormError(null)
  }

  function addTag(tag: string) {
    const t = tag.trim()
    if (!t || newTags.includes(t)) return
    setNewTags((prev) => [...prev, t])
  }

  async function handleAddChild(e: FormEvent) {
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
    if (newSichtbarkeit === 'einzelpersonen' && teilenMit.length === 0) {
      setFormError('Mindestens eine Person auswählen.')
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
        datei_url: dateiUrl,
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

  async function handleDeleteChild(c: DokumentRow) {
    if (!window.confirm(`"${c.titel}" wirklich löschen?`)) return
    if (c.datei_url) await supabase.storage.from('dokumente').remove([c.datei_url])
    await supabase.from('dokumente').delete().eq('id', c.id)
    await loadChildren()
  }

  async function handleDeleteDocument() {
    if (!window.confirm(`"${document.titel}" wirklich löschen? Angehängte Notizen/Analysen werden mitgelöscht.`)) return
    setDeleting(true)
    if (document.datei_url) await supabase.storage.from('dokumente').remove([document.datei_url])
    await supabase.from('dokumente').delete().eq('id', document.id)
    setDeleting(false)
    onDeleted()
  }

  const kandidatenGefiltert = candidates
    .filter((c) => !teilenMit.includes(c.id))
    .filter((c) => c.name.toLowerCase().includes(shareSearch.toLowerCase()))

  function sichtbarkeitLabel(c: DokumentRow): string {
    if (c.sichtbarkeit === 'persoenlich') return 'Persönlich'
    if (c.sichtbarkeit === 'geteilt') return `Ganze Ebene${c.ebene ? ` (${EBENE_LABEL[c.ebene]}${c.gliederung ? ` ${c.gliederung}` : ''})` : ''}`
    const namen = shareNamesByChild.get(c.id) ?? []
    return namen.length > 0 ? `Geteilt mit ${namen.join(', ')}` : 'Einzelne Personen'
  }

  return (
    <div className="mc-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="mc-animate-pop flex h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-slate-900">{document.titel}</h1>
          <div className="flex shrink-0 items-center gap-1.5">
            {document.user_id === userId && (
              <button
                type="button"
                onClick={handleDeleteDocument}
                disabled={deleting}
                aria-label="Dokument löschen"
                title="Dokument löschen"
                className="mc-btn-ghost !p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 size={17} />
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Schließen" title="Schließen" className="mc-btn-ghost !p-2">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mc-card mb-6 p-4">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {document.ebene && (
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${EBENE_COLOR[document.ebene].chip}`}>
                  {EBENE_LABEL[document.ebene]}
                  {document.gliederung ? ` · ${document.gliederung}` : ''}
                </span>
              )}
              {document.tags.map((t) => (
                <span key={t} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tagColor(t).chip}`}>
                  {t}
                </span>
              ))}
            </div>
            {document.inhalt && <p className="mb-2 whitespace-pre-wrap text-sm text-slate-700">{document.inhalt}</p>}
            {document.datei_url && (
              <button
                type="button"
                onClick={() => setPreviewDoc({ path: document.datei_url!, name: fileNameFromPath(document.datei_url!) })}
                className="mc-btn-ghost !text-xs"
              >
                📎 Original-Dokument: {fileNameFromPath(document.datei_url)}
              </button>
            )}
          </div>

          <h2 className="mb-2 text-sm font-semibold text-slate-900">Meine Notizen &amp; Dokumente</h2>
          <ul className="mb-4 space-y-2">
            {children.map((c) => (
              <li key={c.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{sichtbarkeitLabel(c)}</span>
                  {c.tags.map((t) => (
                    <span key={t} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tagColor(t).chip}`}>
                      {t}
                    </span>
                  ))}
                </div>
                <p className={`text-sm text-slate-900 ${istNotizUngelesen(c, gelesenAmVorDiesemOeffnen) ? 'font-bold' : 'font-normal'}`}>
                  {c.titel}
                </p>
                {c.inhalt && <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{c.inhalt}</p>}
                {c.datei_url && (
                  <button
                    type="button"
                    onClick={() => setPreviewDoc({ path: c.datei_url!, name: fileNameFromPath(c.datei_url!) })}
                    className="mc-btn-ghost !mt-1 !px-2 !py-1 !text-xs"
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
                    <button type="button" onClick={() => handleDeleteChild(c)} className="mc-btn-danger !px-2 !py-1 !text-xs">
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
              placeholder="Notiz/Analyse (optional)"
              value={newInhalt}
              onChange={(e) => setNewInhalt(e.target.value)}
              className="mc-input w-full"
              rows={3}
            />
            <input type="file" onChange={(e) => setNewFile(e.target.files?.[0] ?? null)} className="w-full text-sm" />

            <div>
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
                  <span key={t} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${tagColor(t).chip}`}>
                    {t}
                    <button type="button" onClick={() => setNewTags((prev) => prev.filter((x) => x !== t))} aria-label={`Tag "${t}" entfernen`} className="hover:opacity-70">
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

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Sichtbarkeit</label>
              <div className="flex flex-wrap gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={newSichtbarkeit === 'persoenlich'} onChange={() => setNewSichtbarkeit('persoenlich')} />
                  Persönlich
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={newSichtbarkeit === 'geteilt'} onChange={() => setNewSichtbarkeit('geteilt')} />
                  Ganze Ebene{document.ebene ? ` (${EBENE_LABEL[document.ebene]}${document.gliederung ? ` ${document.gliederung}` : ''})` : ''}
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={newSichtbarkeit === 'einzelpersonen'} onChange={() => setNewSichtbarkeit('einzelpersonen')} />
                  Einzelne Personen
                </label>
              </div>
              {newSichtbarkeit === 'einzelpersonen' && (
                <div className="mt-2">
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {teilenMit.map((uid) => {
                      const p = candidates.find((c) => c.id === uid)
                      return (
                        <span key={uid} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                          {p?.name ?? '…'}
                          <button type="button" onClick={() => setTeilenMit((prev) => prev.filter((x) => x !== uid))} className="hover:opacity-70">
                            ×
                          </button>
                        </span>
                      )
                    })}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Kolleg*in suchen..."
                      value={shareSearch}
                      onChange={(e) => setShareSearch(e.target.value)}
                      onFocus={() => setShareDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setShareDropdownOpen(false), 150)}
                      className="mc-input w-full"
                    />
                    {shareDropdownOpen && (
                      <ul className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                        {kandidatenGefiltert.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              onMouseDown={() => {
                                setTeilenMit((prev) => [...prev, c.id])
                                setShareSearch('')
                              }}
                              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                            >
                              {c.name}
                            </button>
                          </li>
                        ))}
                        {kandidatenGefiltert.length === 0 && (
                          <li className="px-3 py-1.5 text-sm text-slate-400">
                            {candidates.length === 0 ? 'Keine Kolleg*innen mit gleicher Partei/Ebene gefunden.' : 'Keine Treffer.'}
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>

            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <button type="submit" disabled={saving} className="mc-btn-primary">
              {saving ? 'Speichern...' : 'Anhängen'}
            </button>
          </form>
        </div>
      </div>

      {previewDoc && (
        <DocumentPreviewModal path={previewDoc.path} fileName={previewDoc.name} bucket="dokumente" onClose={() => setPreviewDoc(null)} />
      )}
    </div>
  )
}
