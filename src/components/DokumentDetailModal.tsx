import { useEffect, useState, type FormEvent } from 'react'
import { Mail, MailOpen, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type { DokumentRow, DokumentSichtbarkeit, Profile } from '../lib/types'
import { EBENE_COLOR, EBENE_LABEL, tagColor } from '../lib/sourceColors'
import { formatDateTime } from '../lib/format'
import { DocumentPreviewModal, fileNameFromPath } from './DocumentPreviewModal'
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
  const [shareIdsByChild, setShareIdsByChild] = useState<Map<string, string[]>>(new Map())
  const [candidates, setCandidates] = useState<Profile[]>([])

  const [previewDoc, setPreviewDoc] = useState<{ path: string; name: string } | null>(null)

  // Lokaler Spiegel der Top-Level-Tags: document ist eine unveränderliche
  // Prop (siehe Dokumente.tsx), Tag-Änderungen brauchen aber sofortiges
  // visuelles Feedback in dieser Sitzung - sicher, weil Dokumente.tsx diese
  // Komponente beim Wechsel auf ein anderes Dokument immer erst unmountet
  // (openDoc geht durch null), nie direkt mit neuer document-Prop remountet.
  const [docTags, setDocTags] = useState<string[]>(document.tags)

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
  const [newFile, setNewFile] = useState<File | null>(null)
  const [newTags, setNewTags] = useState<string[]>([])
  const [newSichtbarkeit, setNewSichtbarkeit] = useState<DokumentSichtbarkeit>('persoenlich')
  const [teilenMit, setTeilenMit] = useState<string[]>([])
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

  async function toggleGelesen() {
    if (!userId) return
    if (istGelesen) {
      await markiereUngelesen(supabase, document.id, userId)
      setIstGelesen(false)
    } else {
      await markiereGelesen(supabase, document.id, userId)
      setIstGelesen(true)
    }
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

  return (
    <div className="mc-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="mc-animate-pop flex h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-slate-900">{document.titel}</h1>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={toggleGelesen}
              aria-label={istGelesen ? 'Als ungelesen markieren' : 'Als gelesen markieren'}
              title={istGelesen ? 'Als ungelesen markieren' : 'Als gelesen markieren'}
              className="mc-btn-ghost !p-2 text-slate-500"
            >
              {istGelesen ? <MailOpen size={17} /> : <Mail size={17} />}
            </button>
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
              {document.user_id !== userId &&
                docTags.map((t) => (
                  <span key={t} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tagColor(t).chip}`}>
                    {t}
                  </span>
                ))}
            </div>
            {document.user_id === userId && (
              <div className="mb-2">
                <TagEditor tags={docTags} onChange={handleUpdateTopLevelTags} vorschlaege={TAG_VORSCHLAEGE} />
              </div>
            )}
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
                      <button type="button" onClick={() => saveEditSharing(c)} disabled={editSaving} className="mc-btn-primary !px-2.5 !py-1 !text-xs">
                        {editSaving ? 'Speichern...' : 'Speichern'}
                      </button>
                      <button type="button" onClick={() => setEditingChildId(null)} className="mc-btn-ghost !px-2.5 !py-1 !text-xs">
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
        </div>
      </div>

      {previewDoc && (
        <DocumentPreviewModal path={previewDoc.path} fileName={previewDoc.name} bucket="dokumente" onClose={() => setPreviewDoc(null)} />
      )}
    </div>
  )
}
