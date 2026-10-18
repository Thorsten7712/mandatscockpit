import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { CalendarView } from '../components/CalendarView'
import { TodoBoard } from '../components/TodoBoard'
import { NotizenSection } from '../components/NotizenSection'
import { PresseschauSection } from '../components/PresseschauSection'
import { NeuigkeitenSection } from '../components/NeuigkeitenSection'

/** Startseite „Heute". Navigation, Profil und Abmelden liegen im App-Rahmen (AppLayout). */
export default function Dashboard() {
  const [presseschauAktiv, setPresseschauAktiv] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('presseschau_aktiv')
        .eq('id', data.user.id)
        .single()
      setPresseschauAktiv(profile?.presseschau_aktiv ?? false)
    })
  }, [])

  return (
    <div>
      <h1 className="mc-page-title mb-6">Heute</h1>
      {presseschauAktiv && <PresseschauSection />}
      <NeuigkeitenSection />
      <section className="mb-8">
        <h2 className="mb-3 text-base font-semibold text-slate-900">ToDo-Board</h2>
        <TodoBoard />
      </section>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <CalendarView />
        <NotizenSection />
      </div>
    </div>
  )
}
