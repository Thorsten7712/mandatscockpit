import { useEffect, useState } from 'react'
import { TodoBoard } from '../components/TodoBoard'
import { TodoDetailModal } from '../components/TodoDetailModal'
import { NotizenSection } from '../components/NotizenSection'

const BREIT = '(min-width: 1024px)'

/**
 * Aufgaben (UI-Umbau 18.10.2026): das Board mit den vier festen Spalten, die
 * gewählte Karte ab Desktop-Breite rechts daneben statt in einem Fenster.
 * Schmaler bleibt es beim Fenster – neben dem Board wäre kein Platz.
 */
export default function Aufgaben() {
  const [ausgewaehlt, setAusgewaehlt] = useState<string | null>(null)
  const [stand, setStand] = useState(0)
  const [nurMir, setNurMir] = useState(false)
  const [breit, setBreit] = useState(() => window.matchMedia(BREIT).matches)

  useEffect(() => {
    const mq = window.matchMedia(BREIT)
    const beiAenderung = () => setBreit(mq.matches)
    mq.addEventListener('change', beiAenderung)
    return () => mq.removeEventListener('change', beiAenderung)
  }, [])

  const detail = ausgewaehlt && (
    <TodoDetailModal
      key={ausgewaehlt}
      id={ausgewaehlt}
      eingebettet={breit}
      onClose={() => setAusgewaehlt(null)}
      onChanged={() => setStand((s) => s + 1)}
    />
  )

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="mc-page-title">Aufgaben</h1>
          <button
            type="button"
            aria-pressed={nurMir}
            onClick={() => setNurMir((v) => !v)}
            className={`min-h-11 rounded-[10px] border px-3.5 text-sm transition-colors ${
              nurMir ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white hover:bg-slate-50'
            }`}
          >
            Nur mir zugewiesen
          </button>
        </header>
        <div className="flex items-start gap-5">
          <div className="min-w-0 flex-1">
            <TodoBoard ausgewaehltId={ausgewaehlt} onAuswahl={setAusgewaehlt} stand={stand} nurMir={nurMir} />
          </div>
          {breit && detail && <aside className="sticky top-6 w-[420px] shrink-0">{detail}</aside>}
        </div>
      </div>
      {!breit && detail}
      <NotizenSection />
    </div>
  )
}
