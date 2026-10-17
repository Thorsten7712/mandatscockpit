import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Login from './pages/Login'
import Impressum from './pages/Impressum'
import Datenschutz from './pages/Datenschutz'
import { ProtectedRoute } from './components/ProtectedRoute'
import { ThemeLoader } from './components/ThemeLoader'

// Seiten hinter dem Login werden erst bei Bedarf nachgeladen: die Login-Seite
// braucht weder Markdown-Renderer noch Drag & Drop, und als ein einziges
// Bundle lag die App über Vites 500-kB-Warnschwelle.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Settings = lazy(() => import('./pages/Settings'))
const Archiv = lazy(() => import('./pages/Archiv'))
const Dokumente = lazy(() => import('./pages/Dokumente'))
const ZahlenUndFakten = lazy(() => import('./pages/ZahlenUndFakten'))
const TerminDetail = lazy(() => import('./pages/TerminDetail'))

export default function App() {
  return (
    <BrowserRouter basename="/mandatscockpit">
      <ThemeLoader />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/impressum" element={<Impressum />} />
          <Route path="/datenschutz" element={<Datenschutz />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/archiv"
            element={
              <ProtectedRoute>
                <Archiv />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dokumente"
            element={
              <ProtectedRoute>
                <Dokumente />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fakten"
            element={
              <ProtectedRoute>
                <ZahlenUndFakten />
              </ProtectedRoute>
            }
          />
          <Route
            path="/termin/:kind/:id"
            element={
              <ProtectedRoute>
                <TerminDetail />
              </ProtectedRoute>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
