import { Link, useNavigate, useParams } from 'react-router-dom'
import { TerminDetailPanel } from '../components/TerminDetailPanel'

export default function TerminDetail() {
  const { kind, id } = useParams<{ kind: string; id: string }>()
  const navigate = useNavigate()
  const isValidKind = kind === 'event' || kind === 'session'

  if (!isValidKind || !id) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <p className="text-red-600">Ungültiger Termin-Link.</p>
        <Link to="/" className="text-sm text-slate-600 underline">
          Zurück zum Dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="h-1.5 bg-topbar" aria-hidden="true" />
      <header className="bg-gradient-to-r from-primary to-primary-hover text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <h1 className="text-lg font-bold">Termindetails</h1>
          <Link to="/" className="mc-btn px-3 py-1.5 text-sm text-white/90 hover:bg-white/15 hover:text-white">
            Zurück zum Dashboard
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mc-card mc-animate-pop max-w-lg p-5">
          <TerminDetailPanel kind={kind} id={id} onDeleted={() => navigate('/')} />
        </div>
      </div>
    </div>
  )
}
