import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type { DokumentRow, SessionRow, TagesordnungsEintrag } from '../lib/types'
import { DOKUMENT_SPALTEN } from '../lib/dokumentSpalten'
import { vorschau } from '../lib/vorlageMarkdown'
import { drucksachennummer, titelOhneNummer } from '../lib/vorgaenge'
import { formatDateTime } from '../lib/format'
import { inStuecken } from '../lib/alleZeilen'
import { VorlageAnsicht } from '../components/VorlageAnsicht'

/** ALLRIS stellt öffentlichen Punkten ein „Ö " voran – in der engen Leiste unten nur die Zahl. */
function kurzeNummer(nummer: string | null): string | null {
  return nummer ? nummer.replace(/^Ö\s*/, '') : null
}

interface Notiz {
  id: string
  user_id: string
  titel: string
  sichtbarkeit: string
  inhalt: string | null
  erstellt_am: string
}

/**
 * Sitzungsmodus (Feinschliff 28.10.2026, Entwurf B „Ein TOP, groß"): Vollbild
 * ohne Leiste für die laufende Sitzung. Es steht immer genau ein
 * Tagesordnungspunkt da – Nummer, Titel und die Vorlage selbst, rechts die Notizen
 * und Analysen zur Vorlage als Spickzettel, eine neue Notiz auf Wunsch. Unten Zurück/Weiter
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
  // Anzahl Notizen/Analysen je Dokument – Punkt an der Nummer in der Leiste unten.
  const [notizenJeDok, setNotizenJeDok] = useState<Map<string, number>>(new Map())
  const [session, setSession] = useState<SessionRow | null>(null)
  const [tops, setTops] = useState<TagesordnungsEintrag[]>([])
  const [dokById, setDokById] = useState<Map<string, DokumentRow>>(new Map())
  const [geladen, setGeladen] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [jetzt, setJetzt] = useState(() => new Date())

  const [notizen, setNotizen] = useState<Notiz[]>([])
  const [autorNamen, setAutorNamen] = useState<Map<string, string>>(new Map())
  // Entwürfe je Punkt, damit ein Wechsel zum nächsten TOP nichts verwirft.
  const [entwuerfe, setEntwuerfe] = useState<Map<number, string>>(new Map())
  const [speichern, setSpeichern] = useState(false)
  const [speicherFehler, setSpeicherFehler] = useState<string | null>(null)
  const [gespeichert, setGespeichert] = useState(false)
  // Das Feld für eine neue Notiz erscheint nur auf Wunsch.
  const [schreiben, setSchreiben] = useState(false)
  const leisteRef = useRef<HTMLOListElement>(null)

  const index = Math.min(Math.max(Number(params.get('top') ?? 0) || 0, 0), Math.max(tops.length - 1, 0))
  const akt = tops[index] as TagesordnungsEintrag | undefined
  const dok = akt?.dokument_id ? (dokById.get(akt.dokument_id) ?? null) : null

  useEffect(() => {
    async function laden() {
      const { data: auth } = await supabase.auth.getUser()
      if (auth.user) setUserId(auth.user.id)
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
      const zaehler = new Map<string, number>()
      for (const stueck of inStuecken(ids)) {
        const { data: kinder } = await supabase.from('dokumente').select('parent_id').in('parent_id', stueck)
        for (const k of kinder ?? []) if (k.parent_id) zaehler.set(k.parent_id, (zaehler.get(k.parent_id) ?? 0) + 1)
      }
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
      setNotizenJeDok(zaehler)
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

  // Alle Notizen am Dokument, die RLS mich sehen lässt: eigene und geteilte
  // Analysen (Rückmeldung 05.11.2026 – vorher nur eigene). Eigene zuerst.
  async function ladeNotizen(dokumentId: string, uid: string) {
    const { data } = await supabase
      .from('dokumente')
      .select('id, user_id, titel, sichtbarkeit, inhalt, erstellt_am')
      .eq('parent_id', dokumentId)
      .order('erstellt_am', { ascending: false })
    const zeilen = (data ?? []).filter((n) => n.inhalt?.trim())
    zeilen.sort((a, b) => Number(b.user_id === uid) - Number(a.user_id === uid))
    const fremde = [...new Set(zeilen.map((n) => n.user_id).filter((id) => id !== uid))]
    const { data: profile } =
      fremde.length > 0 ? await supabase.from('profiles').select('id, name').in('id', fremde) : { data: [] }
    setAutorNamen(new Map((profile ?? []).map((p) => [p.id, p.name])))
    setNotizen(zeilen)
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
      if (ziel?.closest('textarea, input, select, [contenteditable="true"]')) return
      if (e.key === 'ArrowRight') gehe(index + 1)
      if (e.key === 'ArrowLeft') gehe(index - 1)
    }
    window.addEventListener('keydown', beiTaste)
    return () => window.removeEventListener('keydown', beiTaste)
  })

  const entwurf = entwuerfe.get(index) ?? ''
  // Ein angefangener Entwurf hält das Feld offen, auch nach einem Wechsel des Punktes.
  const schreibfeldOffen = schreiben || entwurf.length > 0

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
    setSchreiben(false)
    await ladeNotizen(dok.id, userId)
  }

  const titel = akt ? akt.top_titel || (dok ? titelOhneNummer(dok.titel) : '') || '(ohne Titel)' : ''
  const nummer = akt?.top_nummer ?? String(index + 1)
  const ds = dok ? drucksachennummer(dok.titel) : null

  return (
    <div className="flex h-dvh flex-col bg-slate-100 text-slate-900">
      {/* Kopf wie im App-Rahmen (Richtung A, 08.11.2026): Streifen in der Parteifarbe,
          weiße Leiste. „Beenden" links statt neben der Uhr – dort traf man es beim
          Halten des iPads versehentlich. */}
      <div className="h-1 shrink-0 bg-topbar" aria-hidden="true" />
      <header className="flex min-h-15 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:gap-4 sm:px-8">
        <Link
          to={`/sitzungen/${id}`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-slate-300 pl-3 pr-4 text-sm text-slate-700 transition-colors duration-150 hover:bg-slate-100 active:scale-[0.98]"
        >
          <X size={16} aria-hidden="true" />
          Beenden
        </Link>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 leading-tight">
          <span className="truncate font-display text-[21px] font-semibold">{session?.gremium ?? session?.titel ?? 'Sitzung'}</span>
          {session && (
            <span className="truncate text-sm text-slate-600">
              <span className="font-mono">{formatDateTime(session.datum)}</span>
              {session.ort ? ` · ${session.ort}` : ''}
            </span>
          )}
        </div>
        <span className="ml-auto font-mono text-lg tabular-nums" aria-label="Uhrzeit">
          {jetzt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </header>
      {tops.length > 0 && (
        <div className="h-[3px] shrink-0 bg-slate-200" aria-hidden="true">
          <div
            className="h-full origin-left bg-accent transition-transform duration-300 ease-out motion-reduce:transition-none"
            style={{ transform: `scaleX(${(index + 1) / tops.length})` }}
          />
        </div>
      )}

      {!geladen ? (
        <div className="flex-1" />
      ) : fehler ? (
        <p className="p-8 text-center text-slate-500">{fehler}</p>
      ) : tops.length === 0 ? (
        <p className="p-8 text-center text-slate-500">Für diese Sitzung ist noch keine Tagesordnung veröffentlicht.</p>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5 sm:px-8 lg:flex-row lg:gap-8 lg:overflow-hidden lg:py-6">
          <div key={index} className="mc-animate-fade flex min-w-0 flex-1 flex-col gap-3 lg:min-h-0">
            <div className="flex items-start gap-4">
              <span className="w-14 shrink-0 font-display text-[40px] leading-none font-medium text-[#1E6F77]">{kurzeNummer(nummer)}</span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[13px] text-slate-600">
                  Punkt {index + 1} von {tops.length}
                  {ds && (
                    <>
                      {' · '}
                      <span className="font-mono">{ds}</span>
                    </>
                  )}
                  {akt?.ergebnis && ` · ${akt.ergebnis}`}
                </span>
                <h1 className="max-w-[44ch] font-display text-[26px] leading-[1.2] font-semibold tracking-[-0.015em] text-balance">{titel}</h1>
              </div>
            </div>
            {/* Die Vorlage steht direkt hier (Rückmeldung 06.11.2026) – mit dem
                Beschlussvorschlag als Kasten obenauf, statt Vorschau und Extra-Fenster. */}
            {dok && (
              <div className="h-[70vh] min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white lg:h-auto lg:flex-1">
                <VorlageAnsicht inhalt={dok.inhalt} zentriert />
              </div>
            )}
            {!dok && <p className="text-[15px] text-slate-500">Zu diesem Punkt gibt es keine Drucksache.</p>}
          </div>

          {/* Spickzettel (Rückmeldung 06.11.2026): vorhandene Notizen und Analysen stehen
              immer da, das Feld für eine neue Notiz erscheint erst auf „+ Notiz". */}
          <aside
            aria-label="Spickzettel"
            className="flex w-full shrink-0 flex-col gap-3 lg:min-h-0 lg:w-[min(480px,42%)]"
          >
            <div className="flex min-h-10 items-center gap-2">
              <h2 className="text-[15px] font-bold">
                Spickzettel
                {notizen.length > 0 && <span className="ml-1.5 font-normal text-slate-500">({notizen.length})</span>}
              </h2>
              {dok && !schreibfeldOffen && (
                <button
                  type="button"
                  onClick={() => setSchreiben(true)}
                  className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-[10px] border border-slate-300 px-3 text-sm font-semibold transition-colors hover:bg-slate-50"
                >
                  <Plus size={15} />
                  Notiz
                </button>
              )}
            </div>
            {notizen.length > 0 ? (
              <ul className="flex flex-col gap-2.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                {notizen.map((n) => (
                  <li key={n.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <span className="mb-1 block text-xs text-slate-500">
                      <b className="font-semibold text-slate-700">
                        {n.user_id === userId ? 'Du' : (autorNamen.get(n.user_id) ?? 'Unbekannt')}
                      </b>
                      {n.sichtbarkeit === 'persoenlich' ? ' · nur für dich' : ''} · {formatDateTime(n.erstellt_am)}
                    </span>
                    {/* Analysen beginnen meist mit ihrem Titel als Überschrift – dann nicht doppelt. */}
                    {n.titel && !n.titel.startsWith('Mitschrift ') && !n.inhalt?.trimStart().startsWith('#') && (
                      <span className="mb-1 block text-sm font-semibold text-slate-800">{n.titel}</span>
                    )}
                    <div className="mc-dokument-content text-[15px] [&_h1]:mb-2 [&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:text-slate-900">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{n.inhalt ?? ''}</ReactMarkdown>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500 lg:flex-1">
                {dok ? 'Keine Notizen oder Analysen zu dieser Vorlage.' : 'Ohne Drucksache gibt es hier keine Notizen.'}
              </p>
            )}
            {dok && schreibfeldOffen && (
              <div className="mc-animate-pop flex shrink-0 flex-col gap-2 rounded-xl border border-slate-200 p-3">
                <label htmlFor="mitschrift" className="text-sm font-semibold">
                  Neue Notiz
                </label>
                <textarea
                  id="mitschrift"
                  rows={4}
                  autoFocus
                  value={entwurf}
                  onChange={(e) => {
                    const wert = e.target.value
                    setGespeichert(false)
                    setEntwuerfe((m) => new Map(m).set(index, wert))
                  }}
                  placeholder="Ergebnis, Wortmeldungen, Nachfassen …"
                  className="mc-input w-full resize-none text-[15px]!"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={mitschriftSpeichern}
                    disabled={speichern || !entwurf.trim()}
                    className="mc-btn-primary min-h-10 disabled:opacity-50"
                  >
                    {speichern ? 'Speichern …' : 'Speichern'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSchreiben(false)
                      setEntwuerfe((m) => {
                        const neu = new Map(m)
                        neu.delete(index)
                        return neu
                      })
                    }}
                    className="mc-btn-ghost min-h-10"
                  >
                    Verwerfen
                  </button>
                  <span className="ml-auto text-xs text-slate-500">Nur für dich sichtbar.</span>
                </div>
                {speicherFehler && <p className="text-sm text-red-600">{speicherFehler}</p>}
              </div>
            )}
            {gespeichert && !schreibfeldOffen && (
              <p className="text-xs text-slate-500" role="status">
                Notiz gespeichert – nur für dich sichtbar.
              </p>
            )}
          </aside>
        </main>
      )}

      {tops.length > 0 && (
        <footer className="flex shrink-0 items-center gap-3 border-t border-slate-200 bg-white px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:gap-4 sm:px-8">
          <button
            type="button"
            onClick={() => gehe(index - 1)}
            disabled={index === 0}
            className="inline-flex min-h-12 shrink-0 items-center gap-1 rounded-full border border-primary bg-white px-4.5 text-[15px] text-primary transition-colors duration-150 hover:bg-slate-100 active:scale-[0.98] disabled:opacity-40"
          >
            <ChevronLeft size={18} />
            <span className="hidden sm:inline">Zurück</span>
          </button>
          <ol ref={leisteRef} aria-label="Tagesordnung" className="flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto p-0.5 [scrollbar-width:none]">
            {tops.map((t, k) => {
              const aktuell = k === index
              return (
                <li key={`${t.top_nummer ?? ''}|${t.dokument_id ?? k}`} className="shrink-0 snap-center">
                  <button
                    type="button"
                    onClick={() => gehe(k)}
                    aria-current={aktuell ? 'step' : undefined}
                    aria-label={`Punkt ${t.top_nummer ?? k + 1}: ${t.top_titel || titelOhneNummer(t.titel) || 'ohne Titel'}`}
                    title={t.top_titel || titelOhneNummer(t.titel)}
                    className={`relative min-h-11 min-w-11 whitespace-nowrap rounded-full border px-3 font-mono text-sm transition-colors duration-150 ${
                      aktuell
                        ? 'border-primary bg-primary text-white'
                        : k < index
                          ? 'border-slate-200 bg-slate-200 text-slate-700 hover:bg-slate-300'
                          : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    {kurzeNummer(t.top_nummer) ?? k + 1}
                    {t.dokument_id && (notizenJeDok.get(t.dokument_id) ?? 0) > 0 && (
                      <span
                        aria-hidden="true"
                        className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${aktuell ? 'bg-accent' : 'bg-[#1E6F77]'}`}
                      />
                    )}
                  </button>
                </li>
              )
            })}
          </ol>
          <button
            type="button"
            onClick={() => gehe(index + 1)}
            disabled={index >= tops.length - 1}
            className="inline-flex min-h-12 shrink-0 items-center gap-1 rounded-full bg-primary px-5.5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
          >
            <span className="hidden sm:inline">Nächster Punkt</span>
            <ChevronRight size={18} />
          </button>
        </footer>
      )}

    </div>
  )
}
