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
    <div className="min-h-screen bg-slate-50 p-6">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-xl font-bold">Termindetails</h1>
        <Link to="/" className="text-sm text-slate-600 underline">
          Zurück zum Dashboard
        </Link>
      </header>
      <div className="max-w-md">
        <TerminDetailPanel kind={kind} id={id} onDeleted={() => navigate('/')} />
      </div>
    </div>
  )
}
