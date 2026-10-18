import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { PresseschauSection } from '../components/PresseschauSection'
import { TodoDetailModal } from '../components/TodoDetailModal'
import { TerminDetailModal } from '../components/TerminDetailModal'
import { ladeNeuigkeiten, neuigkeitenGesehen, type Neuigkeiten } from '../lib/neuigkeiten'
import { aufgabeErledigen, ladeMeineAufgaben, ladeWoche, type AufgabenStand, type WochenEintrag } from '../lib/heute'
import { formatDateTime, formatTime } from '../lib/format'

/**
 * Startseite „Heute" (UI-Umbau 18.10.2026, Entwurf A): Kurzüberblick in
 * Kacheln, darunter drei Spalten – die Woche, meine offenen Aufgaben und was
 * seit dem letzten „Alles gesehen" neu ist. Board und Kalender liegen auf
 * eigenen Seiten (/aufgaben, /kalender).
 */

type Offen = { art: 'todo'; id: string } | { art: 'session' | 'event'; id: string }

const AUFGABEN_ANZAHL = 6

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

export default function Dashboard() {
  const [userId, setUserId] = useState<string | null>(null)
  const [vorname, setVorname] = useState('')
  const [presseschauAktiv, setPresseschauAktiv] = useState(false)
  const [woche, setWoche] = useState<WochenEintrag[] | null>(null)
  const [aufgaben, setAufgaben] = useState<AufgabenStand | null>(null)
  const [neuigkeiten, setNeuigkeiten] = useState<Neuigkeiten | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [offen, setOffen] = useState<Offen | null>(null)

  const laden = useCallback(async (uid: string) => {
    try {
      const [w, a, n] = await Promise.all([ladeWoche(uid), ladeMeineAufgaben(uid), ladeNeuigkeiten(uid)])
      setWoche(w)
      setAufgaben(a)
      setNeuigkeiten(n)
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

  function schliessen() {
    setOffen(null)
    if (userId) laden(userId)
  }

  async function erledigen(todoId: string) {
    if (!userId || !aufgaben) return
    const meldung = await aufgabeErledigen(userId, todoId, aufgaben.fertigSpalteId)
    if (meldung) {
      setFehler(meldung)
      return
    }
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

  const naechsteSitzung = woche?.find((e) => e.kind === 'session' && !e.abgesagt && !e.vorbei)
  const ueberfaellig = aufgaben?.offen.filter((a) => a.ueberfaellig).length ?? 0
  const faelligDieseWoche = aufgaben?.offen.filter((a) => a.dieseWoche).length ?? 0

  // Woche nach Tagen gruppieren.
  const tage: { schluessel: string; datum: string; eintraege: WochenEintrag[] }[] = []
  for (const e of woche ?? []) {
    const schluessel = tagesSchluessel(e.start)
    const tag = tage.find((t) => t.schluessel === schluessel)
    if (tag) tag.eintraege.push(e)
    else tage.push({ schluessel, datum: e.start, eintraege: [e] })
  }

  const kachel = 'mc-card flex flex-col gap-1.5 p-4'
  const karte = 'mc-card flex flex-col gap-3 p-5'
  const kartenKopf = 'flex items-baseline justify-between gap-3'
  const kartenTitel = 'text-[17px] font-semibold text-slate-900'
  const link = 'text-[13px] font-medium text-primary hover:underline'

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-sm text-slate-500">
          {new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </span>
        <h1 className="mc-page-title">
          {begruessung()}
          {vorname ? `, ${vorname}` : ''}
        </h1>
      </header>

      {fehler && <p className="text-sm text-red-600">Etwas konnte nicht geladen werden: {fehler}</p>}

      <section aria-label="Kurzüberblick" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {naechsteSitzung ? (
          <button
            type="button"
            onClick={() => setOffen({ art: 'session', id: naechsteSitzung.id })}
            className={`${kachel} col-span-2 text-left transition-colors hover:border-primary/40 lg:col-span-1`}
          >
            <span className="flex items-center gap-1.5 text-[13px] text-slate-500">
              <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
              Nächste Sitzung
            </span>
            <span className="text-[17px] font-semibold">{naechsteSitzung.titel}</span>
            <span className="font-mono text-[13px] text-slate-600">
              {new Date(naechsteSitzung.start).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} ·{' '}
              {formatTime(naechsteSitzung.start)}
            </span>
          </button>
        ) : (
          <div className={`${kachel} col-span-2 lg:col-span-1`}>
            <span className="text-[13px] text-slate-500">Nächste Sitzung</span>
            <span className="text-[15px] text-slate-500">{woche ? 'Keine in den nächsten 7 Tagen' : '…'}</span>
          </div>
        )}
        <Link to="/aufgaben" className={`${kachel} transition-colors hover:border-primary/40`}>
          <span className="text-[13px] text-slate-500">Fällig in 7 Tagen</span>
          <span className="text-[28px] font-bold leading-none">{aufgaben ? faelligDieseWoche : '–'}</span>
          {ueberfaellig > 0 ? (
            <span className="text-[13px] font-semibold text-orange-800">{ueberfaellig} überfällig</span>
          ) : (
            <span className="text-[13px] text-slate-500">{aufgaben ? 'nichts überfällig' : '\u00a0'}</span>
          )}
        </Link>
        <a href="#neu-fuer-dich" className={`${kachel} transition-colors hover:border-primary/40`}>
          <span className="text-[13px] text-slate-500">Neu für dich</span>
          <span className="text-[28px] font-bold leading-none">{neuigkeiten ? neuigkeiten.neu.length : '–'}</span>
          <span className="text-[13px] text-slate-500">
            {neuigkeiten?.seit ? `seit ${formatDateTime(neuigkeiten.seit)}` : 'seit deinem letzten Besuch'}
          </span>
        </a>
      </section>

      {presseschauAktiv && <PresseschauSection />}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] items-start gap-5">
        <section aria-labelledby="h-woche" className={karte}>
          <div className={kartenKopf}>
            <h2 id="h-woche" className={kartenTitel}>
              Diese Woche
            </h2>
            <Link to="/kalender" className={link}>
              Kalender
            </Link>
          </div>
          {woche === null && <p className="text-sm text-slate-400">Lade …</p>}
          {woche?.length === 0 && <p className="text-sm text-slate-500">In den nächsten 7 Tagen steht nichts an.</p>}
          {tage.map((tag) => {
            const d = new Date(tag.datum)
            return (
              <div key={tag.schluessel} className="flex gap-3.5">
                <div className="flex w-12 shrink-0 flex-col items-center">
                  <span className="text-xs uppercase tracking-wider text-slate-500">
                    {d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')}
                  </span>
                  <span className="text-[22px] font-bold leading-tight">{d.getDate()}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {tag.eintraege.map((e) => {
                    const sitzung = e.kind === 'session'
                    return (
                      <button
                        key={`${e.kind}-${e.id}`}
                        type="button"
                        onClick={() => setOffen({ art: e.kind, id: e.id })}
                        className={`flex flex-col gap-0.5 rounded-[10px] px-3 py-2.5 text-left transition-colors ${
                          sitzung && !e.abgesagt ? 'bg-primary/10 hover:bg-primary/15' : 'bg-slate-100 hover:bg-slate-200/70'
                        }`}
                      >
                        <span className={`font-mono text-xs ${sitzung && !e.abgesagt ? 'text-primary' : 'text-slate-500'}`}>
                          {formatTime(e.start)}
                          {e.ort ? ` · ${e.ort}` : ''}
                        </span>
                        <span className={`text-[15px] font-semibold ${e.abgesagt ? 'text-slate-400 line-through' : ''}`}>
                          {e.titel}
                        </span>
                        <span className="text-[13px] text-slate-600">
                          {e.abgesagt
                            ? 'abgesagt'
                            : sitzung
                              ? e.tops
                                ? `${e.tops} Tagesordnungspunkte · Vorbereiten →`
                                : 'Noch keine Tagesordnung'
                              : 'Eigener Termin'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </section>

        <section aria-labelledby="h-aufgaben" className={karte}>
          <div className={kartenKopf}>
            <h2 id="h-aufgaben" className={kartenTitel}>
              Meine Aufgaben
            </h2>
            <Link to="/aufgaben" className={link}>
              Board öffnen
            </Link>
          </div>
          {aufgaben === null && <p className="text-sm text-slate-400">Lade …</p>}
          {aufgaben?.offen.length === 0 && <p className="text-sm text-slate-500">Keine offenen Aufgaben.</p>}
          <ul className="flex flex-col">
            {aufgaben?.offen.slice(0, AUFGABEN_ANZAHL).map((a) => (
              <li key={a.id} className="flex items-start gap-3 border-b border-slate-100 py-2 last:border-b-0">
                <input
                  type="checkbox"
                  aria-label={`„${a.titel}" erledigt`}
                  onChange={() => erledigen(a.id)}
                  className="mt-1 h-5 w-5 shrink-0 accent-primary"
                />
                <button type="button" onClick={() => setOffen({ art: 'todo', id: a.id })} className="flex min-w-0 flex-col gap-0.5 text-left">
                  <span className="text-[15px] font-medium hover:underline">{a.titel}</span>
                  <span className={`text-[13px] ${a.ueberfaellig ? 'font-semibold text-orange-800' : 'text-slate-500'}`}>
                    {a.faellig_am ? faelligText(a.faellig_am, a.ueberfaellig) : 'Ohne Termin'}
                    {a.spalte ? ` · ${a.spalte}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {aufgaben && aufgaben.offen.length > AUFGABEN_ANZAHL && (
            <Link to="/aufgaben" className={link}>
              {aufgaben.offen.length - AUFGABEN_ANZAHL} weitere offene Aufgaben
            </Link>
          )}
          {aufgaben && aufgaben.spalten.length > 0 && (
            <div className="grid grid-cols-4 gap-2 pt-1">
              {aufgaben.spalten.map((s) => (
                <div key={s.titel} className="flex flex-col items-center rounded-lg bg-slate-100 p-2">
                  <span className="text-lg font-bold">{s.anzahl}</span>
                  <span className="truncate text-xs text-slate-500">{s.titel === 'Ergebnis erstellt' ? 'Ergebnis' : s.titel}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section id="neu-fuer-dich" aria-labelledby="h-neu" className={`${karte} scroll-mt-6`}>
          <div className={kartenKopf}>
            <h2 id="h-neu" className={kartenTitel}>
              Neu für dich
            </h2>
            {neuigkeiten && neuigkeiten.neu.length > 0 && (
              <button type="button" onClick={allesGesehen} className="mc-btn rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] hover:bg-slate-50">
                Alles gesehen
              </button>
            )}
          </div>
          {neuigkeiten === null && <p className="text-sm text-slate-400">Lade …</p>}
          {neuigkeiten?.neu.length === 0 && (
            <p className="text-sm text-slate-500">
              {neuigkeiten.seit ? `Nichts Neues seit ${formatDateTime(neuigkeiten.seit)}.` : 'Ab jetzt erscheint hier, was neu dazukommt.'}
            </p>
          )}
          <ul className="flex flex-col">
            {neuigkeiten?.neu.map((n) => (
              <li key={n.schluessel} className="border-b border-slate-100 last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOffen(n.ziel.art === 'todo' ? n.ziel : { art: 'session', id: n.ziel.id })}
                  className="flex w-full flex-col gap-0.5 py-2.5 text-left"
                >
                  <span className="text-xs font-semibold uppercase tracking-wider text-primary">{n.art}</span>
                  <span className="text-[15px] font-medium hover:underline">{n.text}</span>
                  <span className="font-mono text-xs text-slate-400">{formatDateTime(n.zeit)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {offen?.art === 'todo' && <TodoDetailModal id={offen.id} onClose={schliessen} onChanged={() => {}} />}
      {(offen?.art === 'session' || offen?.art === 'event') && (
        <TerminDetailModal kind={offen.art} id={offen.id} onClose={schliessen} />
      )}
    </div>
  )
}
