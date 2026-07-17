import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { CalendarView } from '../components/CalendarView'
import { TodoBoard } from '../components/TodoBoard'

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">MandatsCockpit</h1>
        <div className="space-x-4">
          <Link to="/settings" className="text-sm text-slate-600 underline">
            Einstellungen
          </Link>
          <button onClick={() => supabase.auth.signOut()} className="text-sm text-slate-600 underline">
            Abmelden
          </button>
        </div>
      </header>
      <main>
        <section className="mb-8">
          <h2 className="font-semibold mb-2">ToDo-Board</h2>
          <TodoBoard />
        </section>
        <CalendarView />
      </main>
    </div>
  )
}
