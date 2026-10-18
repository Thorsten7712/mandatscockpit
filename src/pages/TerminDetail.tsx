import { Link, useNavigate, useParams } from 'react-router-dom'
import { TerminDetailPanel } from '../components/TerminDetailPanel'

export default function TerminDetail() {
  const { kind, id } = useParams<{ kind: string; id: string }>()
  const navigate = useNavigate()
  const isValidKind = kind === 'event' || kind === 'session'

  if (!isValidKind || !id) {
    return (
      <div>
        <p className="text-red-600">Ungültiger Termin-Link.</p>
        <Link to="/" className="text-sm text-slate-600 underline">
          Zur Startseite
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="mc-page-title">{kind === 'session' ? 'Sitzung' : 'Termin'}</h1>
      <div className="mc-card mc-animate-pop max-w-lg p-5">
        <TerminDetailPanel kind={kind} id={id} onDeleted={() => navigate(kind === 'session' ? '/sitzungen' : '/kalender')} />
      </div>
    </div>
  )
}
