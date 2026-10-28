import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, FileText, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type { DokumentRow, SessionRow, TagesordnungsEintrag } from '../lib/types'
import { DOKUMENT_SPALTEN } from '../lib/dokumentSpalten'
import { vorlageAufbereiten, vorschau } from '../lib/vorlageMarkdown'
import { drucksachennummer, titelOhneNummer } from '../lib/vorgaenge'
import { formatDateTime } from '../lib/format'
import { logoUrl, themeById } from '../lib/themes'
import { DokumentDetailModal } from '../components/DokumentDetailModal'

interface EigeneNotiz {
  id: string
  inhalt: string | null
  erstellt_am: string
}

/**
 * Sitzungsmodus (Feinschliff 28.10.2026, Entwurf B „Ein TOP, groß"): Vollbild
 * ohne Leiste für die laufende Sitzung. Es steht immer genau ein
 * Tagesordnungspunkt da – Nummer, Titel, Beschlussvorschlag, die eigenen
 * Notizen als Spickzettel und ein Feld für die Mitschrift. Unten Zurück/Weiter
 * und alle Punkte als Leiste.
 *
 * Der gewählte Punkt steht in der Adresse (?top=), damit ein Neuladen auf dem
 * iPad nicht an den Anfang springt. Die Mitschrift wird als persönliche Notiz
 * am Dokument des Punktes gespeichert (dasselbe wie im Hub), ein Ergebnis wird
 * nicht gesetzt – `sitzung_dokumente.ergebnis` gehört dem ALLRIS-Import.
 */
export default function SitzungsModus() {
  const { id } = useParams<{ id: string }>()
  const [params, setParams] = useSearchParams()
  const [userId, setUserId] = useState<string | null>(null)
  const [partei, setPartei] = useState<string | null>(null)
  const [session, setSession] = useState<SessionRow | null>(null)
  const [tops, setTops] = useState<TagesordnungsEintrag[]>([])
  const [dokById, setDokById] = useState<Map<string, DokumentRow>>(new Map())
  const [geladen, setGeladen] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [jetzt, setJetzt] = useState(() => new Date())

  const [notizen, setNotizen] = useState<EigeneNotiz[]>([])
  // Entwürfe je Punkt, damit ein Wechsel zum nächsten TOP nichts verwirft.
  const [entwuerfe, setEntwuerfe] = useState<Map<number, string>>(new Map())
  const [speichern, setSpeichern] = useState(false)
  const [speicherFehler, setSpeicherFehler] = useState<string | null>(null)
  const [gespeichert, setGespeichert] = useState(false)
  const [vorlageOffen, setVorlageOffen] = useState(false)
  const leisteRef = useRef<HTMLOListElement>(null)

  const index = Math.min(Math.max(Number(params.get('top') ?? 0) || 0, 0), Math.max(tops.length - 1, 0))
  const akt = tops[index] as TagesordnungsEintrag | undefined
  const dok = akt?.dokument_id ? (dokById.get(akt.dokument_id) ?? null) : null

  useEffect(() => {
    async function laden() {
      const { data: auth } = await supabase.auth.getUser()
      if (auth.user) {
        setUserId(auth.user.id)
        const { data: profil } = await supabase.from('profiles').select('partei').eq('id', auth.user.id).single()
        setPartei(profil?.partei ?? null)
      }
      const { data: s, error } = await supabase.from('sessions').select('*').eq('id', id!).single()
      if (error || !s) {
        setFehler('Sitzung nicht gefunden.')
        setGeladen(true)
        return
      }
      // Gleiche Sortierung wie in der Sitzungsansicht (TerminDetailPanel):
      // reihenfolge zuerst, weil top_nummer als Text falsch sortiert.
      const { data: links } = await supabase
        .from('sitzung_dokumente')
        .select('dokument_id, top_nummer, top_titel, reihenfolge, ergebnis')
        .eq('session_id', id!)
      const eintraege = (links ?? []) as Omit<TagesordnungsEintrag, 'titel'>[]
      const ids = eintraege.map((l) => l.dokument_id).filter((d): d is string => d !== null)
      const { data: doks } =
        ids.length > 0 ? await supabase.from('dokumente').select(DOKUMENT_SPALTEN).in('id', ids) : { data: [] as DokumentRow[] }
      const map = new Map((doks ?? []).map((d) => [d.id, d as DokumentRow]))
      const sortiert = eintraege
        .map((e) => ({ ...e, titel: (e.dokument_id ? map.get(e.dokument_id)?.titel : '') ?? '' }))
        .sort((a, b) => {
          if (a.reihenfolge !== null && b.reihenfolge !== null) return a.reihenfolge - b.reihenfolge
          if (a.reihenfolge !== null) return -1
          if (b.reihenfolge !== null) return 1
          return (a.top_titel || a.titel).localeCompare(b.top_titel || b.titel, 'de')
        })
      setSession(s)
      setDokById(map)
      setTops(sortiert)
      setGeladen(true)
    }
    laden()
  }, [id])

  // Uhr im Kopf, halbminütlich genügt.
  useEffect(() => {
    const t = setInterval(() => setJetzt(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  // Bildschirm anlassen, solange der Sitzungsmodus offen ist. Der Browser gibt
  // die Sperre beim Wechsel in den Hintergrund frei, daher beim Zurückkommen
  // neu anfordern. Ohne Unterstützung (ältere Browser) passiert einfach nichts.
  useEffect(() => {
    let sperre: WakeLockSentinel | null = null
    async function anfordern() {
      try {
        if (document.visibilityState === 'visible' && 'wakeLock' in navigator) {
          sperre = await navigator.wakeLock.request('screen')
        }
      } catch {
        // z. B. Energiesparmodus – kein Grund für eine Meldung
      }
    }
    anfordern()
    document.addEventListener('visibilitychange', anfordern)
    return () => {
      document.removeEventListener('visibilitychange', anfordern)
      sperre?.release().catch(() => {})
    }
  }, [])

  async function ladeNotizen(dokumentId: string, uid: string) {
    const { data } = await supabase
      .from('dokumente')
      .select('id, inhalt, erstellt_am')
      .eq('parent_id', dokumentId)
      .eq('user_id', uid)
      .order('erstellt_am', { ascending: false })
    setNotizen(data ?? [])
  }

  useEffect(() => {
    setNotizen([])
    setSpeicherFehler(null)
    setGespeichert(false)
    if (dok && userId) ladeNotizen(dok.id, userId)
  }, [dok, userId])

  // Aktuellen Punkt in der unteren Leiste sichtbar halten (Ratssitzungen haben 80 Punkte).
  useEffect(() => {
    leisteRef.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [index, tops.length])

  function gehe(neu: number) {
    if (neu < 0 || neu >= tops.length) return
    setParams({ top: String(neu) }, { replace: true })
  }

  // Pfeiltasten wechseln den Punkt – außer beim Schreiben.
  useEffect(() => {
    function beiTaste(e: KeyboardEvent) {
      const ziel = e.target as HTMLElement | null
      if (vorlageOffen || ziel?.closest('textarea, input, select, [contenteditable="true"]')) return
      if (e.key === 'ArrowRight') gehe(index + 1)
      if (e.key === 'ArrowLeft') gehe(index - 1)
    }
    window.addEventListener('keydown', beiTaste)
    return () => window.removeEventListener('keydown', beiTaste)
  })

  const beschluss = useMemo(() => (dok ? vorlageAufbereiten(dok.inhalt).beschlussvorschlag : null), [dok])
  const entwurf = entwuerfe.get(index) ?? ''

  async function mitschriftSpeichern() {
    if (!dok || !userId || !session || !entwurf.trim()) return
    setSpeichern(true)
    setSpeicherFehler(null)
    const inhalt = entwurf.trim()
    // Persönliche Notiz am Dokument, wie im Hub (DokumentDetailModal): nur für mich sichtbar.
    const { error } = await supabase.from('dokumente').insert({
      user_id: userId,
      parent_id: dok.id,
      titel: `Mitschrift ${session.gremium ?? session.titel}, ${new Date(session.datum).toLocaleDateString('de-DE')}`,
      sichtbarkeit: 'persoenlich',
      ebene: null,
      gliederung: null,
      tags: [],
      inhalt,
      vorschau: vorschau(inhalt),
    })
    setSpeichern(false)
    if (error) {
      setSpeicherFehler(error.message)
      return
    }
    setEntwuerfe((m) => {
      const neu = new Map(m)
      neu.delete(index)
      return neu
    })
    setGespeichert(true)
    await ladeNotizen(dok.id, userId)
  }

  const logo = logoUrl(themeById(partei))
  const titel = akt ? akt.top_titel || (dok ? titelOhneNummer(dok.titel) : '') || '(ohne Titel)' : ''
  const nummer = akt?.top_nummer ?? String(index + 1)
  const ds = dok ? drucksachennummer(dok.titel) : null

  return (
    <div className="flex h-dvh flex-col bg-white text-slate-900">
      <header className="flex min-h-16 shrink-0 items-center gap-3 bg-primary px-4 text-white sm:gap-4 sm:px-6">
        {logo && (
          <span className="hidden h-9 shrink-0 items-center rounded-lg bg-white px-2 sm:flex">
            <img src={logo} alt={themeById(partei).label} className="h-6 w-auto max-w-16 object-contain" />
          </span>
        )}
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-base font-semibold">{session?.gremium ?? session?.titel ?? 'Sitzung'}</span>
          {session && (
            <span className="truncate text-[13px] text-white/75">
              {formatDateTime(session.datum)}
              {session.ort ? ` · ${session.ort}` : ''}
            </span>
          )}
        </div>
        <span className="ml-auto font-mono text-xl tabular-nums" aria-label="Uhrzeit">
          {jetzt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <Link
          to={`/sitzungen/${id}`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-white/40 px-3.5 text-sm font-medium transition-colors hover:bg-white/10"
        >
          <X size={16} />
          Beenden
        </Link>
      </header>

      {!geladen ? (
        <div className="flex-1" />
      ) : fehler ? (
        <p className="p-8 text-center text-slate-500">{fehler}</p>
      ) : tops.length === 0 ? (
        <p className="p-8 text-center text-slate-500">Für diese Sitzung ist noch keine Tagesordnung veröffentlicht.</p>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-5 py-6 sm:px-10 lg:flex-row lg:gap-10 lg:px-14 lg:py-9">
          <div key={index} className="mc-animate-fade flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-mono text-5xl leading-none text-primary sm:text-6xl">{nummer}</span>
              <span className="text-[15px] text-slate-500">
                Punkt {index + 1} von {tops.length}
                {ds && (
                  <>
                    {' · '}
                    <span className="font-mono">{ds}</span>
                  </>
                )}
                {akt?.ergebnis && ` · ${akt.ergebnis}`}
              </span>
            </div>
            <h1 className="max-w-[28ch] text-[28px] font-bold leading-tight tracking-tight text-balance sm:text-[34px]">
              {titel}
            </h1>
            {dok && (
              <section className="mt-1 max-w-[66ch] rounded-xl bg-slate-100 px-5 py-4">
                <h2 className="mb-1.5 text-sm font-semibold text-slate-500">
                  {beschluss ? 'Beschlussvorschlag' : 'Worum es geht'}
                </h2>
                <p className="whitespace-pre-line font-serif text-lg leading-relaxed sm:text-xl">
                  {beschluss || dok.vorschau || 'Für dieses Dokument liegt noch kein Text vor.'}
                </p>
              </section>
            )}
            {dok && (
              <div>
                <button
                  type="button"
                  onClick={() => setVorlageOffen(true)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-slate-300 px-4 text-sm font-semibold transition-colors hover:bg-slate-50"
                >
                  <FileText size={16} />
                  Ganze Vorlage lesen
                </button>
              </div>
            )}
            {!dok && <p className="text-[15px] text-slate-500">Zu diesem Punkt gibt es keine Drucksache.</p>}
          </div>

          <aside aria-label="Spickzettel und Mitschrift" className="flex w-full shrink-0 flex-col gap-3 lg:w-[360px]">
            <h2 className="text-[15px] font-bold">Mein Spickzettel</h2>
            {notizen.length > 0 ? (
              <ul className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
                {notizen.map((n) => (
                  <li key={n.id} className="rounded-xl border border-slate-200 p-3.5">
                    <span className="mb-1 block text-xs text-slate-500">{formatDateTime(n.erstellt_am)}</span>
                    <p className="whitespace-pre-line text-base leading-relaxed">{n.inhalt}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">
                {dok ? 'Keine eigenen Notizen zu dieser Vorlage.' : 'Ohne Drucksache gibt es hier keine Notizen.'}
              </p>
            )}
            {dok && (
              <>
                <label htmlFor="mitschrift" className="mt-2 text-sm font-semibold">
                  Mitschrift
                </label>
                <textarea
                  id="mitschrift"
                  rows={5}
                  value={entwurf}
                  onChange={(e) => {
                    const wert = e.target.value
                    setGespeichert(false)
                    setEntwuerfe((m) => new Map(m).set(index, wert))
                  }}
                  placeholder="Ergebnis, Wortmeldungen, Nachfassen …"
                  className="mc-input w-full resize-none text-base!"
                />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={mitschriftSpeichern}
                    disabled={speichern || !entwurf.trim()}
                    className="mc-btn-primary min-h-11 disabled:opacity-50"
                  >
                    {speichern ? 'Speichern …' : 'Als Notiz speichern'}
                  </button>
                  <span className="text-xs text-slate-500" role="status">
                    {gespeichert ? 'Gespeichert – nur für dich sichtbar.' : 'Nur für dich sichtbar.'}
                  </span>
                </div>
                {speicherFehler && <p className="text-sm text-red-600">{speicherFehler}</p>}
              </>
            )}
          </aside>
        </main>
      )}

      {tops.length > 0 && (
        <footer className="flex shrink-0 items-center gap-3 border-t border-slate-200 bg-slate-50 px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:gap-4 sm:px-6">
          <button
            type="button"
            onClick={() => gehe(index - 1)}
            disabled={index === 0}
            className="inline-flex min-h-13 shrink-0 items-center gap-1 rounded-xl border border-slate-300 bg-white px-4 text-[15px] transition-colors hover:bg-slate-100 disabled:opacity-40"
          >
            <ChevronLeft size={18} />
            <span className="hidden sm:inline">Zurück</span>
          </button>
          <ol ref={leisteRef} aria-label="Tagesordnung" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {tops.map((t, k) => {
              const aktuell = k === index
              return (
                <li key={`${t.top_nummer ?? ''}|${t.dokument_id ?? k}`} className="min-w-11 flex-1">
                  <button
                    type="button"
                    onClick={() => gehe(k)}
                    aria-current={aktuell ? 'step' : undefined}
                    aria-label={`Punkt ${t.top_nummer ?? k + 1}: ${t.top_titel || titelOhneNummer(t.titel) || 'ohne Titel'}`}
                    title={t.top_titel || titelOhneNummer(t.titel)}
                    className={`min-h-11 w-full whitespace-nowrap rounded-lg px-1.5 font-mono text-sm transition-colors ${
                      aktuell
                        ? 'bg-primary text-white'
                        : k < index
                          ? 'bg-primary/15 text-slate-700 hover:bg-primary/25'
                          : 'bg-slate-200/70 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {t.top_nummer ?? k + 1}
                  </button>
                </li>
              )
            })}
          </ol>
          <button
            type="button"
            onClick={() => gehe(index + 1)}
            disabled={index >= tops.length - 1}
            className="inline-flex min-h-13 shrink-0 items-center gap-1 rounded-xl bg-primary px-5 text-[15px] font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
          >
            <span className="hidden sm:inline">Nächster TOP</span>
            <ChevronRight size={18} />
          </button>
        </footer>
      )}

      {vorlageOffen && dok && (
        <DokumentDetailModal
          document={dok}
          onClose={() => setVorlageOffen(false)}
          onDeleted={() => {
            setVorlageOffen(false)
            setDokById((m) => {
              const neu = new Map(m)
              neu.delete(dok.id)
              return neu
            })
          }}
        />
      )}
    </div>
  )
}
