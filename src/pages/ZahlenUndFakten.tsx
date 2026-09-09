import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, MessageSquareQuote, Pencil, Scale, Search, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type { Ebene, FaktKategorie, FaktRow, Profile } from '../lib/types'
import { EBENE_COLOR, EBENE_LABEL, tagColor } from '../lib/sourceColors'
import { formatDate } from '../lib/format'
import { TagEditor } from '../components/TagEditor'
import { LoeschDialog } from '../components/LoeschDialog'

/**
 * "Zahlen und Fakten": das Material, das man in Debatte, Interview und
 * Bürgergespräch griffbereit braucht - Argumentationshilfen (Argument +
 * Erwiderung), Sprachregelungen (wie wir worüber sprechen) und belegte
 * Kennzahlen. Eigene Tabelle statt Tag-Sicht auf den Dokumenten-Hub, weil
 * Fakten kurze, wiederverwendbare Bausteine mit Belegpflicht sind und keine
 * datierten Artefakte mit Datei, Notizen-Baum und Gelesen-Status - Begründung
 * ausführlich in supabase/migrations/0039_fakten.sql.
 *
 * Fakten sind **immer** Ebenen-Material: es gibt keine privaten Fakten
 * (0040_fakten_immer_geteilt.sql). Wer etwas nur für sich notieren will, nutzt
 * den Dokumenten-Hub. Deshalb hat das Formular keine Sichtbarkeits-Auswahl,
 * nur die Frage, für welche der eigenen Ebenen der Fakt gilt.
 *
 * RLS (0039_fakten.sql) filtert server-seitig auf Eigenes + für die eigene
 * Partei/Ebene/Gliederung Geteiltes; hier wird nur noch nach Kategorie, Tag
 * und Suchbegriff gefiltert.
 */

const KATEGORIEN: { value: FaktKategorie; label: string; icon: typeof Scale; hinweis: string }[] = [
  {
    value: 'argumentationshilfe',
    label: 'Argumentationshilfen',
    icon: Scale,
    hinweis: 'Das Argument und die Erwiderung darauf - für Debatte und Bürgergespräch.',
  },
  {
    value: 'sprachregelung',
    label: 'Sprachregelungen',
    icon: MessageSquareQuote,
    hinweis: 'Wie wir worüber sprechen - und welche Formulierungen wir vermeiden.',
  },
  {
    value: 'zahl',
    label: 'Zahlen & Fakten',
    icon: BarChart3,
    hinweis: 'Belegte Kennzahlen. Ohne Quelle und Stand ist eine Zahl in der Debatte wertlos.',
  },
]

const TAG_VORSCHLAEGE = ['Haushalt', 'Verkehr', 'Wohnen', 'Klima', 'Soziales', 'Bildung']

/** Bund braucht keine Gliederung - es gibt nur einen Bundestag (analog src/lib/gliederung.ts). */
function gliederungFuer(profile: Profile | null, ebene: Ebene): string | null {
  if (!profile) return null
  if (ebene === 'kommune') return profile.gliederung_kommune
  if (ebene === 'kreis') return profile.gliederung_kreis
  if (ebene === 'land') return profile.gliederung_land
  return null
}

const LEERES_FORMULAR = {
  titel: '',
  inhalt: '',
  kennzahl: '',
  einheit: '',
  quelle: '',
  stand: '',
  tags: [] as string[],
  ebene: '' as Ebene | '',
}

export default function ZahlenUndFakten() {
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [fakten, setFakten] = useState<FaktRow[]>([])
  const [authorNames, setAuthorNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)

  const [kategorie, setKategorie] = useState<FaktKategorie>('argumentationshilfe')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Ein Formularzustand für Anlegen UND Bearbeiten: editId === null heißt
  // "neuer Eintrag" (gleiches Muster wie das Bearbeiten von Notizen im
  // DokumentDetailModal, das ebenfalls einen einzigen Satz Felder wiederverwendet).
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(LEERES_FORMULAR)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Fakten sind immer Ebenen-weit sichtbar (0040_fakten_immer_geteilt.sql) -
  // die Löschrückfrage bekommt deshalb ausnahmslos die Geteilt-Variante.
  const [loeschKandidat, setLoeschKandidat] = useState<FaktRow | null>(null)
  const [loeschenVerstanden, setLoeschenVerstanden] = useState(false)

  async function loadFakten() {
    const { data } = await supabase.from('fakten').select('*').order('geaendert_am', { ascending: false })
    setFakten(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadFakten()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      const { data: profileRow } = await supabase.from('profiles').select('*').eq('id', data.user.id).single()
      setProfile(profileRow)
    })
  }, [])

  // Namen fremder Einträge nachladen (bei eigenen steht ohnehin kein "von ...").
  useEffect(() => {
    const fremdeIds = Array.from(new Set(fakten.filter((f) => f.user_id !== userId).map((f) => f.user_id)))
    if (fremdeIds.length === 0) {
      setAuthorNames(new Map())
      return
    }
    supabase
      .from('profiles')
      .select('id, name')
      .in('id', fremdeIds)
      .then(({ data }) => setAuthorNames(new Map((data ?? []).map((p) => [p.id as string, p.name as string]))))
  }, [fakten, userId])

  const eigeneEbenen = profile?.ebenen ?? []

  function oeffneNeu() {
    setEditId(null)
    setForm({ ...LEERES_FORMULAR, ebene: eigeneEbenen[0] ?? '' })
    setFormError(null)
    setShowForm(true)
  }

  function oeffneBearbeiten(f: FaktRow) {
    setEditId(f.id)
    setForm({
      titel: f.titel,
      inhalt: f.inhalt ?? '',
      kennzahl: f.kennzahl ?? '',
      einheit: f.einheit ?? '',
      quelle: f.quelle ?? '',
      // <input type="date"> erwartet YYYY-MM-DD; stand ist bereits ein date.
      stand: f.stand ?? '',
      tags: f.tags,
      ebene: f.ebene,
    })
    setFormError(null)
    setShowForm(true)
    setKategorie(f.kategorie)
  }

  function schliesseForm() {
    setShowForm(false)
    setEditId(null)
    setForm(LEERES_FORMULAR)
    setFormError(null)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!userId) return
    if (!form.titel.trim()) {
      setFormError('Titel ist erforderlich.')
      return
    }
    if (kategorie === 'zahl' && !form.kennzahl.trim()) {
      setFormError('Für eine Zahl ist die Kennzahl erforderlich.')
      return
    }
    if (kategorie !== 'zahl' && !form.inhalt.trim()) {
      setFormError('Text ist erforderlich.')
      return
    }
    if (!form.ebene) {
      setFormError('Ebene ist erforderlich - ein Fakt gilt immer für eine bestimmte Ebene.')
      return
    }

    setSaving(true)
    setFormError(null)

    // gliederung kommt IMMER aus dem eigenen Profil, nie aus einer Eingabe -
    // sonst landet Material in der falschen Gliederung (gleiche Regel wie im
    // Dokumenten-Hub, siehe 0033_dokumente.sql).
    const ebene = form.ebene as Ebene
    const werte = {
      kategorie,
      titel: form.titel.trim(),
      inhalt: form.inhalt.trim() || null,
      kennzahl: kategorie === 'zahl' ? form.kennzahl.trim() || null : null,
      einheit: kategorie === 'zahl' ? form.einheit.trim() || null : null,
      quelle: form.quelle.trim() || null,
      stand: form.stand || null,
      tags: form.tags,
      sichtbarkeit: 'geteilt' as const,
      ebene,
      gliederung: gliederungFuer(profile, ebene),
    }

    const { error } = editId
      ? await supabase
          .from('fakten')
          .update({ ...werte, geaendert_am: new Date().toISOString() })
          .eq('id', editId)
      : await supabase.from('fakten').insert({ ...werte, user_id: userId })

    setSaving(false)
    if (error) {
      setFormError(error.message)
      return
    }
    schliesseForm()
    await loadFakten()
  }

  async function handleDelete(f: FaktRow) {
    await supabase.from('fakten').delete().eq('id', f.id)
    setLoeschKandidat(null)
    await loadFakten()
  }

  const inKategorie = fakten.filter((f) => f.kategorie === kategorie)
  const tagsPresent = Array.from(new Set(inKategorie.flatMap((f) => f.tags))).sort((a, b) => a.localeCompare(b, 'de'))

  const gefiltert = inKategorie.filter((f) => {
    if (tagFilter && !f.tags.includes(tagFilter)) return false
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      const autor = f.user_id !== userId ? authorNames.get(f.user_id) ?? '' : ''
      const haystack = [f.titel, f.inhalt ?? '', f.kennzahl ?? '', f.einheit ?? '', f.quelle ?? '', ...f.tags, autor]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  const aktiveKategorie = KATEGORIEN.find((k) => k.value === kategorie)!

  /** Quelle + Stand stehen unter jedem Eintrag - ohne sie ist ein Fakt nicht zitierfähig. */
  function beleg(f: FaktRow) {
    if (!f.quelle && !f.stand) {
      return <span className="italic text-amber-600">Keine Quelle hinterlegt</span>
    }
    // Bewusst umbrechend statt abgeschnitten: eine halbe Drucksachennummer
    // nützt beim Zitieren nichts.
    return (
      <span className="break-words">
        {f.quelle}
        {f.quelle && f.stand ? ' · ' : ''}
        {f.stand ? `Stand ${formatDate(f.stand)}` : ''}
      </span>
    )
  }

  /** Beleg + Bearbeiten/Löschen unter jedem Eintrag - in beiden Darstellungen gleich. */
  function fusszeile(f: FaktRow) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500">
        {beleg(f)}
        {f.user_id !== userId && <span className="shrink-0">von {authorNames.get(f.user_id) ?? 'Unbekannt'}</span>}
        {f.user_id === userId && (
          <span className="ml-auto flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => oeffneBearbeiten(f)}
              aria-label="Bearbeiten"
              title="Bearbeiten"
              className="mc-btn-ghost !p-1.5"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setLoeschenVerstanden(false)
                setLoeschKandidat(f)
              }}
              className="mc-btn-danger !px-2 !py-1 !text-xs"
            >
              Löschen
            </button>
          </span>
        )}
      </div>
    )
  }

  function badges(f: FaktRow) {
    return (
      <>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${EBENE_COLOR[f.ebene].chip}`}
        >
          {EBENE_LABEL[f.ebene]}
          {f.gliederung ? ` · ${f.gliederung}` : ''}
        </span>
        {f.tags.map((t) => (
          <span key={t} className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${tagColor(t).chip}`}>
            {t}
          </span>
        ))}
      </>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="h-1.5 bg-topbar" aria-hidden="true" />
      <header className="bg-gradient-to-r from-primary to-primary-hover text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <h1 className="text-lg font-bold">Zahlen &amp; Fakten</h1>
          <Link to="/" className="mc-btn px-3 py-1.5 text-sm text-white/90 hover:bg-white/15 hover:text-white">
            Zurück zum Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-2 flex flex-wrap gap-2">
          {KATEGORIEN.map((k) => {
            const Icon = k.icon
            const anzahl = fakten.filter((f) => f.kategorie === k.value).length
            return (
              <button
                key={k.value}
                type="button"
                onClick={() => {
                  setKategorie(k.value)
                  setTagFilter(null)
                }}
                className={kategorie === k.value ? 'mc-btn-primary' : 'mc-btn-ghost'}
              >
                <Icon size={16} /> {k.label}
                {anzahl > 0 && <span className="ml-1 opacity-70">({anzahl})</span>}
              </button>
            )
          })}
        </div>
        <p className="mb-5 text-sm text-slate-500">{aktiveKategorie.hinweis}</p>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Durchsuchen (Titel, Text, Quelle, Tags)..."
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
          <button
            type="button"
            onClick={() => (showForm ? schliesseForm() : oeffneNeu())}
            disabled={!showForm && eigeneEbenen.length === 0}
            title={
              eigeneEbenen.length === 0
                ? 'Trage zuerst unter Einstellungen → Meine Gremien deine Ebene(n) ein.'
                : undefined
            }
            className={showForm ? 'mc-btn-ghost' : 'mc-btn-primary'}
          >
            {showForm ? 'Abbrechen' : `+ ${kategorie === 'zahl' ? 'Zahl' : kategorie === 'sprachregelung' ? 'Sprachregelung' : 'Argumentationshilfe'}`}
          </button>
        </div>

        {eigeneEbenen.length === 0 && (
          <p className="mb-4 text-sm text-amber-600">
            Trage zuerst unter{' '}
            <Link to="/settings" className="underline">
              Einstellungen → Meine Gremien
            </Link>{' '}
            deine Ebene(n) ein, um eigene Einträge anzulegen – ein Fakt gilt immer für eine bestimmte Ebene.
          </p>
        )}

        {tagsPresent.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
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
        )}

        {showForm && (
          <form onSubmit={handleSave} className="mc-card mc-animate-pop mb-6 max-w-2xl space-y-3 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {editId ? 'Eintrag bearbeiten' : `Neu: ${aktiveKategorie.label}`}
            </p>
            <input
              type="text"
              placeholder={kategorie === 'zahl' ? 'Wofür steht die Zahl? (z. B. Anteil Radverkehr)' : 'Titel / Kernaussage'}
              value={form.titel}
              onChange={(e) => setForm({ ...form, titel: e.target.value })}
              className="mc-input w-full"
              required
            />
            {kategorie === 'zahl' && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Kennzahl (z. B. 12,5 oder rund 1.200)"
                  value={form.kennzahl}
                  onChange={(e) => setForm({ ...form, kennzahl: e.target.value })}
                  className="mc-input flex-1"
                />
                <input
                  type="text"
                  placeholder="Einheit (%, Mio. €, Wohnungen)"
                  value={form.einheit}
                  onChange={(e) => setForm({ ...form, einheit: e.target.value })}
                  className="mc-input flex-1"
                />
              </div>
            )}
            <textarea
              placeholder={
                kategorie === 'argumentationshilfe'
                  ? 'Argument und Erwiderung...'
                  : kategorie === 'sprachregelung'
                    ? 'Wie formulieren wir das - und wie nicht?'
                    : 'Einordnung: Was sagt die Zahl aus, was nicht? (optional)'
              }
              value={form.inhalt}
              onChange={(e) => setForm({ ...form, inhalt: e.target.value })}
              className="mc-input w-full"
              rows={4}
            />
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                placeholder="Quelle (Behörde, Studie, Drucksache, URL)"
                value={form.quelle}
                onChange={(e) => setForm({ ...form, quelle: e.target.value })}
                className="mc-input min-w-[14rem] flex-1"
              />
              <label className="flex items-center gap-2 text-sm text-slate-500">
                Stand
                <input
                  type="date"
                  value={form.stand}
                  onChange={(e) => setForm({ ...form, stand: e.target.value })}
                  className="mc-input !w-auto"
                />
              </label>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Tags</label>
              <TagEditor tags={form.tags} onChange={(tags) => setForm({ ...form, tags })} vorschlaege={TAG_VORSCHLAEGE} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="fakt-ebene">
                Gilt für Ebene
              </label>
              <select
                id="fakt-ebene"
                value={form.ebene}
                onChange={(e) => setForm({ ...form, ebene: e.target.value as Ebene })}
                className="mc-input !w-auto !text-sm"
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
              <p className="mt-1 text-xs text-slate-500">
                Fakten stehen immer allen Mitgliedern deiner Partei auf dieser Ebene zur Verfügung.
              </p>
            </div>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="mc-btn-primary">
                {saving ? 'Speichern...' : editId ? 'Änderungen speichern' : 'Speichern'}
              </button>
              <button type="button" onClick={schliesseForm} className="mc-btn-ghost">
                Abbrechen
              </button>
            </div>
          </form>
        )}

        {kategorie === 'zahl' ? (
          // Kennzahlen als Kachelraster: der Wert ist die Botschaft und soll
          // ohne Lesen erfassbar sein - anders als bei den Textkategorien,
          // wo der Fließtext die Hauptsache ist.
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {gefiltert.map((f, idx) => (
              <div
                key={f.id}
                style={{ animationDelay: `${Math.min(idx, 8) * 30}ms` }}
                className="mc-card mc-animate-slide flex flex-col p-4"
              >
                <div className="mb-1 flex flex-wrap items-center gap-1.5">{badges(f)}</div>
                <p className="text-3xl font-bold leading-none text-primary">
                  {f.kennzahl}
                  {f.einheit && <span className="ml-1 text-base font-semibold text-slate-500">{f.einheit}</span>}
                </p>
                <p className="mt-1.5 text-sm font-semibold text-slate-900">{f.titel}</p>
                {f.inhalt && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{f.inhalt}</p>}
                <div className="mt-auto">{fusszeile(f)}</div>
              </div>
            ))}
            {!loading && gefiltert.length === 0 && (
              <div className="mc-card p-6 text-center text-sm text-slate-400 sm:col-span-2 lg:col-span-3">
                {inKategorie.length === 0 ? 'Noch keine Zahlen hinterlegt.' : 'Keine Treffer für diese Auswahl.'}
              </div>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {gefiltert.map((f, idx) => (
              <li
                key={f.id}
                style={{ animationDelay: `${Math.min(idx, 8) * 30}ms` }}
                className="mc-card mc-animate-slide p-4"
              >
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold text-slate-900">{f.titel}</span>
                  {badges(f)}
                </div>
                {f.inhalt && <p className="whitespace-pre-wrap text-sm text-slate-700">{f.inhalt}</p>}
                {fusszeile(f)}
              </li>
            ))}
            {!loading && gefiltert.length === 0 && (
              <li className="mc-card p-6 text-center text-sm text-slate-400">
                {inKategorie.length === 0
                  ? `Noch keine ${aktiveKategorie.label.toLowerCase()} hinterlegt.`
                  : 'Keine Treffer für diese Auswahl.'}
              </li>
            )}
          </ul>
        )}
      </div>

      {loeschKandidat && (
        <LoeschDialog
          titel={loeschKandidat.titel}
          folgen={[
            `Der Eintrag steht allen Mitgliedern deiner Partei auf Ebene ${EBENE_LABEL[loeschKandidat.ebene]}${
              loeschKandidat.gliederung ? ` (${loeschKandidat.gliederung})` : ''
            } zur Verfügung und verschwindet für alle.`,
            'Das lässt sich nicht rückgängig machen.',
          ]}
          bestaetigungsText="Ja, ich möchte diesen Eintrag für alle löschen."
          bestaetigt={loeschenVerstanden}
          onBestaetigtChange={setLoeschenVerstanden}
          onAbbrechen={() => setLoeschKandidat(null)}
          onLoeschen={() => handleDelete(loeschKandidat)}
        />
      )}
    </div>
  )
}
