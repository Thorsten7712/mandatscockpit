import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Login from './pages/Login'
import Impressum from './pages/Impressum'
import Datenschutz from './pages/Datenschutz'
import { ProtectedRoute } from './components/ProtectedRoute'
import { ThemeLoader } from './components/ThemeLoader'
import { AppLayout } from './components/AppLayout'

// Seiten hinter dem Login werden erst bei Bedarf nachgeladen: die Login-Seite
// braucht weder Markdown-Renderer noch Drag & Drop, und als ein einziges
// Bundle lag die App über Vites 500-kB-Warnschwelle.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Settings = lazy(() => import('./pages/Settings'))
const Archiv = lazy(() => import('./pages/Archiv'))
const Dokumente = lazy(() => import('./pages/Dokumente'))
const ZahlenUndFakten = lazy(() => import('./pages/ZahlenUndFakten'))
const TerminDetail = lazy(() => import('./pages/TerminDetail'))
const Kalender = lazy(() => import('./pages/Kalender'))
const Sitzungen = lazy(() => import('./pages/Sitzungen'))
const Aufgaben = lazy(() => import('./pages/Aufgaben'))
const SitzungsModus = lazy(() => import('./pages/SitzungsModus'))

export default function App() {
  return (
    <BrowserRouter basename="/mandatscockpit">
      <ThemeLoader />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/impressum" element={<Impressum />} />
          <Route path="/datenschutz" element={<Datenschutz />} />
          {/* Sitzungsmodus: Vollbild ohne Leiste, damit während der Sitzung nichts ablenkt. */}
          <Route
            path="/sitzungen/:id/modus"
            element={
              <ProtectedRoute>
                <SitzungsModus />
              </ProtectedRoute>
            }
          />
          {/* Alle Seiten hinter dem Login teilen sich den App-Rahmen (Leiste). */}
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/kalender" element={<Kalender />} />
            <Route path="/sitzungen" element={<Sitzungen />} />
            <Route path="/sitzungen/:id" element={<Sitzungen />} />
            <Route path="/aufgaben" element={<Aufgaben />} />
            <Route path="/dokumente" element={<Dokumente />} />
            <Route path="/fakten" element={<ZahlenUndFakten />} />
            <Route path="/archiv" element={<Archiv />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/termin/:kind/:id" element={<TerminDetail />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
