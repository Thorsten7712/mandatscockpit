import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { ladeTermine, type KalenderEintrag } from '../lib/termine'
import { formatTime, startOfTodayIso } from '../lib/format'
import { EBENE_LABEL } from '../lib/sourceColors'
import type { Ebene } from '../lib/types'
import { TerminDetailModal } from '../components/TerminDetailModal'

/**
 * Kalender (UI-Umbau 18.10.2026): Woche als sieben Spalten oder Liste der
 * kommenden Wochen, mit Filtern nach eigenen Terminen, Ebene und Gremium.
 * Sitzungen öffnen sich in der Sitzungsansicht, eigene Termine im Fenster.
 */

type Ansicht = 'woche' | 'liste'
type Filter = 'alle' | 'eigene' | Ebene | string

const TAG_MS = 24 * 60 * 60 * 1000
const LISTE_TAGE = 90
const EBENEN: Ebene[] = ['kommune', 'kreis', 'land', 'bund']

function wochenBeginn(d: Date): Date {
  const montag = new Date(d)
  montag.setHours(0, 0, 0, 0)
  montag.setDate(montag.getDate() - ((montag.getDay() + 6) % 7))
  return montag
}

function gleicherTag(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function zeitraumText(beginn: Date): string {
  const ende = new Date(beginn.getTime() + 6 * TAG_MS)
  const monatJahr = ende.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
  if (beginn.getMonth() === ende.getMonth()) return `${beginn.getDate()}.–${ende.getDate()}. ${monatJahr}`
  return `${beginn.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })} – ${ende.getDate()}. ${monatJahr}`
}

function infoText(e: KalenderEintrag): string {
  if (e.abgesagt) return 'abgesagt'
  if (e.kind === 'event') return e.ort ? `Eigener Termin · ${e.ort}` : 'Eigener Termin'
  const tops = e.tops ? `${e.tops} Punkte` : 'Noch keine Tagesordnung'
  return e.ort ? `${tops} · ${e.ort}` : tops
}

export default function Kalender() {
  const navigate = useNavigate()
  const [userId, setUserId] = useState<string | null>(null)
  const [ansicht, setAnsicht] = useState<Ansicht>(() =>
    window.matchMedia('(min-width: 768px)').matches ? 'woche' : 'liste',
  )
  const [woche, setWoche] = useState(() => wochenBeginn(new Date()))
  const [eintraege, setEintraege] = useState<KalenderEintrag[] | null>(null)
  const [ohneGremien, setOhneGremien] = useState(false)
  const [filter, setFilter] = useState<Filter>('alle')
  const [fehler, setFehler] = useState<string | null>(null)
  const [offenerTermin, setOffenerTermin] = useState<string | null>(null)
  const [heute, setHeute] = useState(() => new Date())

  const [formOffen, setFormOffen] = useState(false)
  const [titel, setTitel] = useState('')
  const [start, setStart] = useState('')
  const [ende, setEnde] = useState('')
  const [ort, setOrt] = useState('')
  const [speichert, setSpeichert] = useState(false)
  const [formFehler, setFormFehler] = useState<string | null>(null)

  const laden = useCallback(async (uid: string, a: Ansicht, w: Date) => {
    const von = a === 'woche' ? w.toISOString() : startOfTodayIso()
    const bis = new Date(Date.parse(von) + (a === 'woche' ? 7 : LISTE_TAGE) * TAG_MS).toISOString()
    try {
      setEintraege(await ladeTermine(uid, von, bis))
      setHeute(new Date())
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      const { count } = await supabase
        .from('user_gremien')
        .select('gremium', { count: 'exact', head: true })
        .eq('user_id', data.user.id)
      setOhneGremien((count ?? 0) === 0)
    })
  }, [])

  useEffect(() => {
    if (userId) laden(userId, ansicht, woche)
  }, [userId, ansicht, woche, laden])

  function oeffnen(e: KalenderEintrag) {
    if (e.kind === 'session') navigate(`/sitzungen/${e.id}`)
    else setOffenerTermin(e.id)
  }

  async function terminAnlegen(e: FormEvent) {
    e.preventDefault()
    if (!userId) return
    setSpeichert(true)
    setFormFehler(null)
    const { error } = await supabase.from('events').insert({
      user_id: userId,
      erstellt_von: userId,
      titel,
      start: new Date(start).toISOString(),
      ende: ende ? new Date(ende).toISOString() : null,
      ort: ort || null,
    })
    setSpeichert(false)
    if (error) {
      setFormFehler(error.message)
      return
    }
    setTitel('')
    setStart('')
    setEnde('')
    setOrt('')
    setFormOffen(false)
    laden(userId, ansicht, woche)
  }

  // Filter-Chips nur für das, was im Zeitraum auch vorkommt.
  const alle = eintraege ?? []
  const ebenenDa = EBENEN.filter((eb) => alle.some((e) => e.ebene === eb))
  const gremienDa = [...new Set(alle.map((e) => e.gremium).filter((g): g is string => Boolean(g)))].sort((a, b) =>
    a.localeCompare(b, 'de'),
  )
  const filterOptionen: { wert: Filter; text: string }[] = [
    { wert: 'alle', text: 'Alles' },
    ...(alle.some((e) => e.kind === 'event') ? [{ wert: 'eigene' as Filter, text: 'Eigene Termine' }] : []),
    ...(ebenenDa.length > 1 ? ebenenDa.map((eb) => ({ wert: eb as Filter, text: EBENE_LABEL[eb] })) : []),
    ...gremienDa.map((g) => ({ wert: g, text: g })),
  ]
  const gefiltert = alle.filter((e) => {
    if (filter === 'alle') return true
    if (filter === 'eigene') return e.kind === 'event'
    if ((EBENEN as string[]).includes(filter)) return e.ebene === filter
    return e.gremium === filter
  })

  const kachelFarbe = (e: KalenderEintrag) =>
    e.abgesagt ? 'bg-slate-100 text-slate-400' : e.kind === 'session' ? 'bg-primary/10' : 'bg-slate-100'

  const tage = Array.from({ length: 7 }, (_, i) => new Date(woche.getTime() + i * TAG_MS))

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mc-page-title">Kalender</h1>
          {ansicht === 'woche' && (
            <>
              <div className="flex gap-1">
                <button
                  type="button"
                  aria-label="Vorige Woche"
                  onClick={() => setWoche((w) => new Date(w.getTime() - 7 * TAG_MS))}
                  className="mc-btn h-10 w-10 border border-slate-300 bg-white"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setWoche(wochenBeginn(new Date()))}
                  className="mc-btn h-10 border border-slate-300 bg-white px-3 text-sm"
                >
                  Heute
                </button>
                <button
                  type="button"
                  aria-label="Nächste Woche"
                  onClick={() => setWoche((w) => new Date(w.getTime() + 7 * TAG_MS))}
                  className="mc-btn h-10 w-10 border border-slate-300 bg-white"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
              <span className="text-base font-semibold text-slate-700">{zeitraumText(woche)}</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Ansicht" className="grid grid-cols-2 rounded-[10px] bg-slate-200/70 p-[3px]">
            {(['woche', 'liste'] as const).map((a) => (
              <button
                key={a}
                type="button"
                role="tab"
                aria-selected={ansicht === a}
                onClick={() => setAnsicht(a)}
                className={`min-h-9 rounded-lg px-3.5 text-sm font-semibold ${ansicht === a ? 'bg-white shadow-xs' : 'text-slate-600'}`}
              >
                {a === 'woche' ? 'Woche' : 'Liste'}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setFormOffen((v) => !v)} className="mc-btn-primary min-h-11 px-4.5">
            {formOffen ? 'Abbrechen' : '+ Termin'}
          </button>
        </div>
      </header>

      {formOffen && (
        <form onSubmit={terminAnlegen} className="mc-card mc-animate-pop grid gap-2.5 p-4 md:grid-cols-[2fr_1fr_1fr_1.5fr_auto]">
          <input type="text" placeholder="Titel" value={titel} onChange={(e) => setTitel(e.target.value)} className="mc-input" required />
          <input
            type="datetime-local"
            aria-label="Beginn"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="mc-input"
            required
          />
          <input type="datetime-local" aria-label="Ende (optional)" value={ende} onChange={(e) => setEnde(e.target.value)} className="mc-input" />
          <input type="text" placeholder="Ort (optional)" value={ort} onChange={(e) => setOrt(e.target.value)} className="mc-input" />
          <button type="submit" disabled={speichert || !userId} className="mc-btn-primary">
            {speichert ? 'Speichern …' : 'Eintragen'}
          </button>
          {formFehler && <p className="text-sm text-red-600 md:col-span-5">{formFehler}</p>}
        </form>
      )}

      {filterOptionen.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {filterOptionen.map((o) => (
            <button
              key={o.wert}
              type="button"
              aria-pressed={filter === o.wert}
              onClick={() => setFilter(o.wert)}
              className={`min-h-8.5 rounded-full px-3 text-[13px] transition-colors ${
                filter === o.wert ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white hover:bg-slate-50'
              }`}
            >
              {o.text}
            </button>
          ))}
        </div>
      )}

      {fehler && <p className="text-sm text-red-600">Termine konnten nicht geladen werden: {fehler}</p>}
      {ohneGremien && (
        <p className="text-sm text-slate-600">
          Für Sitzungstermine unter{' '}
          <Link to="/settings" className="font-medium text-primary underline">
            Einstellungen
          </Link>{' '}
          die Gremien wählen, in denen du ein Mandat hast.
        </p>
      )}

      {ansicht === 'woche' ? (
        <div className="mc-card overflow-x-auto">
          <div className="grid min-w-[1050px] grid-cols-7">
            {tage.map((tag) => {
              const istHeute = gleicherTag(tag, heute)
              const anTag = gefiltert.filter((e) => gleicherTag(new Date(e.start), tag))
              return (
                <div key={tag.toISOString()} className="flex min-h-[520px] flex-col border-r border-slate-100 last:border-r-0">
                  <div className={`flex items-baseline gap-1.5 border-b border-slate-100 p-3 ${istHeute ? 'bg-primary/10' : ''}`}>
                    <span className="text-xs uppercase tracking-wider text-slate-500">
                      {tag.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')}
                    </span>
                    <span className={`text-xl font-bold ${istHeute ? 'text-primary' : ''}`}>{tag.getDate()}</span>
                  </div>
                  <div className="flex flex-col gap-1.5 p-2">
                    {anTag.map((e) => (
                      <button
                        key={`${e.kind}-${e.id}`}
                        type="button"
                        onClick={() => oeffnen(e)}
                        className={`flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-[filter] hover:brightness-95 ${kachelFarbe(e)}`}
                      >
                        <span className={`font-mono text-xs ${e.kind === 'session' && !e.abgesagt ? 'text-primary' : 'text-slate-500'}`}>
                          {formatTime(e.start)}
                        </span>
                        <span className={`text-sm font-semibold leading-snug [overflow-wrap:anywhere] ${e.abgesagt ? 'line-through' : ''}`}>
                          {e.titel}
                        </span>
                        <span className="text-xs text-slate-500">{infoText(e)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="mc-card overflow-hidden">
          {eintraege === null && <p className="px-5 py-4 text-sm text-slate-400">Lade …</p>}
          {eintraege !== null && gefiltert.length === 0 && (
            <p className="px-5 py-4 text-sm text-slate-500">Keine Termine in den nächsten {LISTE_TAGE} Tagen.</p>
          )}
          {gefiltert.map((e) => (
            <button
              key={`${e.kind}-${e.id}`}
              type="button"
              onClick={() => oeffnen(e)}
              className="flex w-full flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-100 px-5 py-3.5 text-left last:border-b-0 hover:bg-slate-50"
            >
              <span className="whitespace-nowrap font-mono text-[13px] text-slate-500 sm:w-40">
                {new Date(e.start).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} ·{' '}
                {formatTime(e.start)}
              </span>
              <span className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
                <span className={`text-[15px] font-semibold ${e.abgesagt ? 'text-slate-400 line-through' : ''}`}>{e.titel}</span>
                <span className="text-[13px] text-slate-500">{infoText(e)}</span>
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  e.kind === 'session' ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {e.kind === 'session' ? (e.ebene ? `Sitzung · ${EBENE_LABEL[e.ebene]}` : 'Sitzung') : 'Eigener Termin'}
              </span>
            </button>
          ))}
        </div>
      )}

      {offenerTermin && (
        <TerminDetailModal
          kind="event"
          id={offenerTermin}
          onClose={() => {
            setOffenerTermin(null)
            if (userId) laden(userId, ansicht, woche)
          }}
        />
      )}
    </div>
  )
}
