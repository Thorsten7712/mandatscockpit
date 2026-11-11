import { Link } from 'react-router-dom'
import { NUTZUNGSERKLAERUNG_VERSION, NutzungserklaerungText } from '../components/Nutzungserklaerung'

/**
 * Öffentlich lesbare Fassung der Nutzungserklärung, die jedes Konto beim
 * ersten Login bestätigt (siehe ProtectedRoute.tsx). Liegt außerhalb von
 * ProtectedRoute, damit man sie auch vor und nach der Bestätigung nachlesen kann.
 */
export default function NutzungserklaerungSeite() {
  return (
    <div className="min-h-screen bg-slate-100">
      <div className="h-1.5 bg-topbar" aria-hidden="true" />
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link to="/" className="mb-6 inline-block text-sm font-medium text-primary underline">
          ← Zurück zum Cockpit
        </Link>
        <h1 className="mb-6 text-2xl font-bold text-slate-900">Nutzungserklärung</h1>
        <div className="mc-card p-6">
          <NutzungserklaerungText />
          <p className="mt-6 text-xs text-slate-400">Fassung {NUTZUNGSERKLAERUNG_VERSION}</p>
        </div>
      </div>
    </div>
  )
}
