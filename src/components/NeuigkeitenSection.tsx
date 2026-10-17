import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { ladeNeuigkeiten, neuigkeitenGesehen, type Neuigkeiten, type Ziel } from '../lib/neuigkeiten'
import { formatDateTime } from '../lib/format'
import { TodoDetailModal } from './TodoDetailModal'
import { TerminDetailModal } from './TerminDetailModal'
import { AntragDetailModal } from './AntragDetailModal'

// Neuigkeiten im Cockpit statt Mails (0057): links, was seit dem letzten
// "Alles gesehen" neu ist, rechts, was in den nächsten Tagen ansteht. Bleibt
// ganz weg, wenn beides leer ist - ein leerer Kasten über dem Board wäre nur
// Platzverbrauch.
export function NeuigkeitenSection() {
  const [userId, setUserId] = useState<string | null>(null)
  const [stand, setStand] = useState<Neuigkeiten | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [offen, setOffen] = useState<Ziel | null>(null)

  async function load(uid: string) {
    try {
      setStand(await ladeNeuigkeiten(uid))
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      load(data.user.id)
    })
  }, [])

  async function handleGesehen() {
    if (!userId || !stand) return
    const meldung = await neuigkeitenGesehen(userId)
    if (meldung) {
      setFehler(meldung)
      return
    }
    setStand({ ...stand, seit: new Date().toISOString(), neu: [] })
  }

  function schliessen() {
    setOffen(null)
    if (userId) load(userId)
  }

  if (fehler) {
    return <p className="mb-6 text-sm text-red-600">Neuigkeiten konnten nicht geladen werden: {fehler}</p>
  }
  if (!stand || (stand.neu.length === 0 && stand.demnaechst.length === 0)) return null

  const zeile = 'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50'

  return (
    <section className="mc-card mc-animate-fade mb-8 grid grid-cols-1 gap-6 p-4 lg:grid-cols-2">
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">
            Neu für dich
            {stand.neu.length > 0 && (
              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {stand.neu.length}
              </span>
            )}
          </h2>
          {stand.neu.length > 0 && (
            <button type="button" onClick={handleGesehen} className="mc-btn-ghost px-2! py-1! text-xs!">
              Alles gesehen
            </button>
          )}
        </div>
        {stand.neu.length === 0 ? (
          <p className="text-sm text-slate-400">
            {stand.seit ? `Nichts Neues seit ${formatDateTime(stand.seit)}.` : 'Ab jetzt erscheint hier, was neu dazukommt.'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {stand.neu.map((n) => (
              <li key={n.schluessel}>
                <button type="button" onClick={() => setOffen(n.ziel)} className={zeile}>
                  <span className="shrink-0">{n.symbol}</span>
                  <span className="min-w-0 flex-1 text-slate-800">{n.text}</span>
                  <span className="shrink-0 text-xs text-slate-400">{formatDateTime(n.zeit)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-base font-semibold text-slate-900">Demnächst</h2>
        {stand.demnaechst.length === 0 ? (
          <p className="text-sm text-slate-400">In den nächsten Tagen steht nichts an.</p>
        ) : (
          <ul className="space-y-0.5">
            {stand.demnaechst.map((t) => (
              <li key={t.schluessel}>
                <button type="button" onClick={() => setOffen(t.ziel)} className={zeile}>
                  <span className="shrink-0">{t.symbol}</span>
                  <span className={`min-w-0 flex-1 ${t.dringend ? 'font-medium text-amber-800' : 'text-slate-800'}`}>
                    {t.text}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {t.ziel.art === 'todo'
                      ? new Date(t.zeit).toLocaleDateString('de-DE')
                      : formatDateTime(t.zeit)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {offen?.art === 'todo' && <TodoDetailModal id={offen.id} onClose={schliessen} onChanged={() => {}} />}
      {offen?.art === 'sitzung' && <TerminDetailModal kind="session" id={offen.id} onClose={schliessen} />}
      {offen?.art === 'antrag' && <AntragDetailModal id={offen.id} onClose={schliessen} onChanged={() => {}} />}
    </section>
  )
}
