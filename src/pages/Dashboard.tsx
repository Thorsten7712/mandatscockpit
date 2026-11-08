import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { PresseschauSection } from '../components/PresseschauSection'
import { TodoDetailModal } from '../components/TodoDetailModal'
import { TerminDetailModal } from '../components/TerminDetailModal'
import { ladeNeuigkeiten, neuigkeitenGesehen, type Neuigkeiten } from '../lib/neuigkeiten'
import {
  aufgabeErledigen,
  aufgabeWiederOeffnen,
  ladeMeineAufgaben,
  ladeVorbereitung,
  ladeWoche,
  type AufgabenStand,
  type MeineAufgabe,
  type Vorbereitung,
  type WochenEintrag,
} from '../lib/heute'
import { formatDateTime, formatTime } from '../lib/format'

/**
 * Startseite „Heute" (Richtung A „Morgenlage", 08.11.2026): das Cockpit als
 * tägliches Briefing. Oben Begrüßung nach Tageszeit und ein Lagesatz mit den
 * Zahlen, die heute zählen; darunter die Presseschau als Band und drei Spalten
 * wie auf einer Zeitungsseite – nächste Sitzung mit Lesestand, die kommenden
 * Tage, meine Aufgaben und was neu ist. Board und Kalender bleiben eigene
 * Seiten (/aufgaben, /kalender).
 */

type Offen = { art: 'todo'; id: string } | { art: 'session' | 'event'; id: string }

const AUFGABEN_ANZAHL = 5
/** So lange bleibt „Rückgängig" nach einem Haken stehen. */
const RUECKGAENGIG_MS = 6000

function begruessung(): string {
  const stunde = new Date().getHours()
  if (stunde < 11) return 'Guten Morgen'
  if (stunde < 18) return 'Guten Tag'
  return 'Guten Abend'
}

function tagesSchluessel(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function faelligText(faellig: string, ueberfaellig: boolean): string {
  const datum = new Date(`${faellig}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
  return ueberfaellig ? `Überfällig seit ${datum}` : `Fällig ${datum}`
}

function wochentag(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', { weekday: 'long' })
}

export default function Dashboard() {
  const [userId, setUserId] = useState<string | null>(null)
  const [vorname, setVorname] = useState('')
  const [presseschauAktiv, setPresseschauAktiv] = useState(false)
  const [woche, setWoche] = useState<WochenEintrag[] | null>(null)
  const [aufgaben, setAufgaben] = useState<AufgabenStand | null>(null)
  const [neuigkeiten, setNeuigkeiten] = useState<Neuigkeiten | null>(null)
  const [vorbereitung, setVorbereitung] = useState<Vorbereitung | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [offen, setOffen] = useState<Offen | null>(null)
  const [erledigt, setErledigt] = useState<MeineAufgabe | null>(null)
  const rueckgaengigTimer = useRef<number | null>(null)

  const laden = useCallback(async (uid: string) => {
    try {
      const [w, a, n] = await Promise.all([ladeWoche(uid), ladeMeineAufgaben(uid), ladeNeuigkeiten(uid)])
      const naechste = w.find((e) => e.kind === 'session' && !e.abgesagt && !e.vorbei)
      const v = naechste ? await ladeVorbereitung(uid, naechste.id) : null
      // Alles nach demselben await setzen, sonst stünde kurz eine Sitzung ohne Lesestand da.
      setWoche(w)
      setAufgaben(a)
      setNeuigkeiten(n)
      setVorbereitung(v)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      const { data: profile } = await supabase
        .from('profiles')
        .select('name, presseschau_aktiv')
        .eq('id', data.user.id)
        .single()
      setVorname((profile?.name ?? '').trim().split(/\s+/)[0] ?? '')
      setPresseschauAktiv(profile?.presseschau_aktiv ?? false)
      await laden(data.user.id)
    })
  }, [laden])

  useEffect(
    () => () => {
      if (rueckgaengigTimer.current) window.clearTimeout(rueckgaengigTimer.current)
    },
    [],
  )

  function schliessen() {
    setOffen(null)
    if (userId) laden(userId)
  }

  async function erledigen(aufgabe: MeineAufgabe) {
    if (!userId || !aufgaben) return
    const meldung = await aufgabeErledigen(userId, aufgabe.id, aufgaben.fertigSpalteId)
    if (meldung) {
      setFehler(meldung)
      return
    }
    setErledigt(aufgabe)
    if (rueckgaengigTimer.current) window.clearTimeout(rueckgaengigTimer.current)
    rueckgaengigTimer.current = window.setTimeout(() => setErledigt(null), RUECKGAENGIG_MS)
    laden(userId)
  }

  async function rueckgaengig() {
    if (!userId || !erledigt) return
    const aufgabe = erledigt
    setErledigt(null)
    const meldung = await aufgabeWiederOeffnen(userId, aufgabe.id, aufgabe.spalteId)
    if (meldung) setFehler(meldung)
    laden(userId)
  }

  async function allesGesehen() {
    if (!userId || !neuigkeiten) return
    const meldung = await neuigkeitenGesehen(userId)
    if (meldung) {
      setFehler(meldung)
      return
    }
    setNeuigkeiten({ ...neuigkeiten, seit: new Date().toISOString(), neu: [] })
  }

  const sitzungen = (woche ?? []).filter((e) => e.kind === 'session' && !e.abgesagt && !e.vorbei)
  const naechsteSitzung = sitzungen[0]
  const ueberfaellig = aufgaben?.offen.filter((a) => a.ueberfaellig).length ?? 0
  const ungelesen = vorbereitung ? vorbereitung.gesamt - vorbereitung.gelesen : 0
  const anteil = vorbereitung && vorbereitung.gesamt > 0 ? Math.round((vorbereitung.gelesen / vorbereitung.gesamt) * 100) : 0

  // Woche nach Tagen gruppieren.
  const tage: { schluessel: string; datum: string; eintraege: WochenEintrag[] }[] = []
  for (const e of woche ?? []) {
    const schluessel = tagesSchluessel(e.start)
    const tag = tage.find((t) => t.schluessel === schluessel)
    if (tag) tag.eintraege.push(e)
    else tage.push({ schluessel, datum: e.start, eintraege: [e] })
  }
  const heuteSchluessel = tagesSchluessel(new Date().toISOString())

  const geladen = woche !== null && aufgaben !== null
  const lageLink = 'font-semibold text-inherit underline decoration-accent decoration-2 underline-offset-4 hover:text-primary'
  const spaltenKopf = 'text-[13px] font-semibold text-slate-500'

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
        <div className="flex max-w-[64ch] flex-col gap-2.5">
          <span className="font-mono text-[13px] text-[#1E6F77]">
            {new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
          <h1 className="font-display text-[34px] leading-[1.05] font-medium tracking-[-0.02em] text-slate-900 sm:text-[46px]">
            {begruessung()}
            {vorname ? `, ${vorname}.` : '.'}
          </h1>
          {geladen && (
            <p className="text-[17px] leading-relaxed text-slate-600 sm:text-lg">
              {sitzungen.length === 0 ? (
                'In den nächsten sieben Tagen tagt keines deiner Gremien.'
              ) : (
                <>
                  {sitzungen.length === 1 ? 'Diese Woche tagt ' : `Diese Woche tagen `}
                  <Link to="/kalender" className={lageLink}>
                    {sitzungen.length === 1 ? 'eines deiner Gremien' : `${sitzungen.length}\u00a0deiner Gremien`}
                  </Link>
                  .
                  {naechsteSitzung && vorbereitung && vorbereitung.gesamt > 0 && (
                    <>
                      {' '}
                      Zur Sitzung am {wochentag(naechsteSitzung.start)}{' '}
                      {ungelesen === 0 ? (
                        'hast du alle Vorlagen gelesen'
                      ) : (
                        <>
                          {ungelesen === 1 ? 'ist noch ' : 'sind noch '}
                          <Link to={`/sitzungen/${naechsteSitzung.id}`} className={lageLink}>
                            {ungelesen === 1 ? 'eine Vorlage ungelesen' : `${ungelesen}\u00a0Vorlagen ungelesen`}
                          </Link>
                        </>
                      )}
                      .
                    </>
                  )}
                </>
              )}
              {ueberfaellig > 0 && (
                <>
                  {' '}
                  <Link to="/aufgaben" className={lageLink}>
                    {ueberfaellig === 1 ? 'Eine Aufgabe ist überfällig' : `${ueberfaellig}\u00a0Aufgaben sind überfällig`}
                  </Link>
                  .
                </>
              )}
            </p>
          )}
        </div>
        {geladen && (
          <dl className="flex gap-8 pb-1">
            <div className="flex flex-col-reverse">
              <dt className="text-[13px] text-slate-500">Sitzungen in 7 Tagen</dt>
              <dd className="text-[34px] leading-none font-semibold tabular-nums">{sitzungen.length}</dd>
            </div>
            {naechsteSitzung && vorbereitung && (
              <div className="flex flex-col-reverse">
                <dt className="text-[13px] text-slate-500">ungelesen bis {wochentag(naechsteSitzung.start).slice(0, 2)}</dt>
                <dd className="text-[34px] leading-none font-semibold tabular-nums text-[#1E6F77]">{ungelesen}</dd>
              </div>
            )}
            <div className="flex flex-col-reverse">
              <dt className="text-[13px] text-slate-500">Aufgaben offen</dt>
              <dd className="text-[34px] leading-none font-semibold tabular-nums">{aufgaben?.offen.length ?? 0}</dd>
            </div>
          </dl>
        )}
      </header>

      {fehler && <p className="text-sm text-red-600">Etwas konnte nicht geladen werden: {fehler}</p>}

      {presseschauAktiv && <PresseschauSection />}

      <div className="grid grid-cols-1 border-t-2 border-primary xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
        {/* Nächste Sitzung */}
        <section aria-labelledby="h-sitzung" className="flex flex-col gap-4 border-slate-200 py-6 xl:border-r xl:pr-8">
          <h2 id="h-sitzung" className={spaltenKopf}>
            Nächste Sitzung
          </h2>
          {woche === null && <p className="text-sm text-slate-500">Lade …</p>}
          {woche && !naechsteSitzung && <p className="text-[15px] text-slate-600">Keine Sitzung in den nächsten sieben Tagen.</p>}
          {naechsteSitzung && (
            <>
              <div className="flex flex-col gap-1.5">
                <p className="font-display text-[34px] leading-[1.05] font-semibold tracking-[-0.015em] sm:text-[38px]">
                  {naechsteSitzung.gremium ?? naechsteSitzung.titel}
                </p>
                <p className="text-[15px] text-slate-600">
                  <span className="font-mono">
                    {new Date(naechsteSitzung.start).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} ·{' '}
                    {formatTime(naechsteSitzung.start)}
                  </span>
                  {naechsteSitzung.ort ? ` · ${naechsteSitzung.ort}` : ''}
                </p>
              </div>
              {vorbereitung && vorbereitung.gesamt > 0 ? (
                <>
                  <div className="flex flex-col gap-2">
                    <span className="flex justify-between text-sm">
                      <span>Vorbereitung</span>
                      <span className="font-mono">
                        {vorbereitung.gelesen} / {vorbereitung.gesamt} gelesen
                      </span>
                    </span>
                    <span
                      className="h-1.5 overflow-hidden rounded-full bg-slate-200"
                      role="progressbar"
                      aria-label="Gelesene Vorlagen"
                      aria-valuenow={anteil}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <span
                        className="block h-full origin-left rounded-full bg-accent transition-transform duration-500 ease-out motion-reduce:transition-none"
                        style={{ transform: `scaleX(${anteil / 100})` }}
                      />
                    </span>
                  </div>
                  {vorbereitung.hinweise.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[13px] text-slate-500">Noch ungelesen{vorbereitung.hinweise.some((h) => h.analysen > 0) ? ', mit Notizen zuerst' : ''}</span>
                      <ul className="flex flex-col">
                        {vorbereitung.hinweise.map((h) => (
                          <li key={h.dokumentId} className="border-b border-slate-200 last:border-b-0">
                            <Link
                              to={`/sitzungen/${naechsteSitzung.id}`}
                              className="flex min-h-11 items-baseline gap-3.5 py-2.5 text-[15px] leading-snug hover:text-primary"
                            >
                              <span className="w-12 shrink-0 font-mono text-[13px] text-slate-500">{h.nummer?.replace(/^Ö\s*/, '') ?? ''}</span>
                              <span className="min-w-0 flex-1">
                                {h.titel}
                                {h.analysen > 0 && (
                                  <span className="ml-1.5 font-mono text-xs text-[#1E6F77]">
                                    · {h.analysen === 1 ? '1 Notiz' : `${h.analysen} Notizen`}
                                  </span>
                                )}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-500">
                  {naechsteSitzung.tops ? 'Diese Tagesordnung hat keine Drucksachen.' : 'Noch keine Tagesordnung veröffentlicht.'}
                </p>
              )}
              <div className="mt-auto flex flex-wrap gap-2.5 pt-2">
                <Link
                  to={`/sitzungen/${naechsteSitzung.id}/modus`}
                  className="inline-flex min-h-12 items-center rounded-full bg-primary px-5.5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-primary-hover active:scale-[0.98]"
                >
                  Sitzungsmodus öffnen
                </Link>
                <Link
                  to={`/sitzungen/${naechsteSitzung.id}`}
                  className="inline-flex min-h-12 items-center rounded-full border border-slate-900 px-5 text-[15px] transition-colors duration-150 hover:bg-white active:scale-[0.98]"
                >
                  Tagesordnung
                </Link>
              </div>
            </>
          )}
        </section>

        {/* Kommende Tage */}
        <section aria-labelledby="h-woche" className="flex flex-col border-t border-slate-200 py-6 xl:border-t-0 xl:border-r xl:px-8">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 id="h-woche" className={spaltenKopf}>
              Die nächsten sieben Tage
            </h2>
            <Link to="/kalender" className="text-[13px] font-medium text-primary hover:underline">
              Kalender
            </Link>
          </div>
          {woche === null && <p className="text-sm text-slate-500">Lade …</p>}
          {woche?.length === 0 && <p className="text-sm text-slate-600">Es steht nichts an.</p>}
          {tage.map((tag) => {
            const d = new Date(tag.datum)
            const heute = tag.schluessel === heuteSchluessel
            return (
              <div key={tag.schluessel} className="flex gap-4 border-b border-slate-200 py-3 last:border-b-0">
                <div className="flex w-12 shrink-0 flex-col leading-none">
                  <span className={`text-xs ${heute ? 'font-semibold text-[#1E6F77]' : 'text-slate-500'}`}>
                    {heute ? 'Heute' : d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')}
                  </span>
                  <span className={`mt-1 text-2xl font-semibold tabular-nums ${heute ? 'text-primary' : ''}`}>{d.getDate()}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {tag.eintraege.map((e) => {
                    const sitzung = e.kind === 'session'
                    return (
                      <button
                        key={`${e.kind}-${e.id}`}
                        type="button"
                        onClick={() => setOffen({ art: e.kind, id: e.id })}
                        className="-mx-2 flex min-h-11 flex-col justify-center gap-0.5 rounded-lg px-2 py-1 text-left transition-colors duration-150 hover:bg-white"
                      >
                        <span className={`text-[15px] ${sitzung && !e.abgesagt ? 'font-semibold' : ''} ${e.abgesagt ? 'text-slate-500 line-through' : ''}`}>
                          {e.titel}
                        </span>
                        <span className="text-[13px] text-slate-600">
                          <span className="font-mono">{formatTime(e.start)}</span>
                          {e.abgesagt
                            ? ' · abgesagt'
                            : sitzung
                              ? e.tops
                                ? ` · ${e.tops} Punkte`
                                : ' · noch keine Tagesordnung'
                              : e.ort
                                ? ` · ${e.ort}`
                                : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </section>

        {/* Aufgaben und Neues */}
        <div className="flex flex-col gap-8 border-t border-slate-200 py-6 xl:border-t-0 xl:pl-8">
          <section aria-labelledby="h-aufgaben" className="flex flex-col">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 id="h-aufgaben" className={spaltenKopf}>
                Meine Aufgaben
              </h2>
              <Link to="/aufgaben" className="text-[13px] font-medium text-primary hover:underline">
                Board
              </Link>
            </div>
            {aufgaben === null && <p className="text-sm text-slate-500">Lade …</p>}
            {aufgaben?.offen.length === 0 && <p className="text-sm text-slate-600">Keine offenen Aufgaben.</p>}
            <ul className="flex flex-col">
              {aufgaben?.offen.slice(0, AUFGABEN_ANZAHL).map((a) => (
                <li key={a.id} className="flex items-start gap-3 border-b border-slate-200 py-2.5 last:border-b-0">
                  <input
                    type="checkbox"
                    aria-label={`„${a.titel}" erledigt`}
                    onChange={() => erledigen(a)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                  />
                  <button type="button" onClick={() => setOffen({ art: 'todo', id: a.id })} className="flex min-w-0 flex-col gap-0.5 text-left">
                    <span className="text-[15px] hover:underline">{a.titel}</span>
                    <span className={`text-[13px] ${a.ueberfaellig ? 'font-semibold text-[#B4471B]' : 'text-slate-600'}`}>
                      {a.faellig_am ? faelligText(a.faellig_am, a.ueberfaellig) : 'Ohne Termin'}
                      {a.spalte ? ` · ${a.spalte}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {aufgaben && aufgaben.offen.length > AUFGABEN_ANZAHL && (
              <Link to="/aufgaben" className="mt-2 text-[13px] font-medium text-primary hover:underline">
                {aufgaben.offen.length - AUFGABEN_ANZAHL} weitere offene Aufgaben
              </Link>
            )}
          </section>

          <section id="neu-fuer-dich" aria-labelledby="h-neu" className="flex scroll-mt-24 flex-col">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 id="h-neu" className={spaltenKopf}>
                Neu für dich
              </h2>
              {neuigkeiten && neuigkeiten.neu.length > 0 && (
                <button type="button" onClick={allesGesehen} className="text-[13px] font-medium text-primary hover:underline">
                  Alles gesehen
                </button>
              )}
            </div>
            {neuigkeiten === null && <p className="text-sm text-slate-500">Lade …</p>}
            {neuigkeiten?.neu.length === 0 && (
              <p className="text-sm text-slate-600">
                {neuigkeiten.seit ? `Nichts Neues seit ${formatDateTime(neuigkeiten.seit)}.` : 'Ab jetzt erscheint hier, was neu dazukommt.'}
              </p>
            )}
            <ul className="flex flex-col">
              {neuigkeiten?.neu.map((n) => (
                <li key={n.schluessel} className="border-b border-slate-200 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOffen(n.ziel.art === 'todo' ? n.ziel : { art: 'session', id: n.ziel.id })}
                    className="flex w-full flex-col gap-0.5 py-2.5 text-left"
                  >
                    <span className="text-xs font-semibold text-[#1E6F77]">{n.art}</span>
                    <span className="text-[15px] hover:underline">{n.text}</span>
                    <span className="font-mono text-xs text-slate-500">{formatDateTime(n.zeit)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {erledigt && (
        <div
          role="status"
          className="mc-animate-pop fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-full bg-slate-900 py-2 pl-5 pr-2 text-sm text-white shadow-xl md:bottom-8"
        >
          <span className="max-w-[40ch] truncate">„{erledigt.titel}" erledigt</span>
          <button type="button" onClick={rueckgaengig} className="min-h-10 rounded-full px-4 font-semibold text-accent hover:bg-white/10">
            Rückgängig
          </button>
        </div>
      )}

      {offen?.art === 'todo' && <TodoDetailModal id={offen.id} onClose={schliessen} onChanged={() => {}} />}
      {(offen?.art === 'session' || offen?.art === 'event') && (
        <TerminDetailModal kind={offen.art} id={offen.id} onClose={schliessen} />
      )}
    </div>
  )
}
