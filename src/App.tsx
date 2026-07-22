import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import Archiv from './pages/Archiv'
import TerminDetail from './pages/TerminDetail'
import Impressum from './pages/Impressum'
import Datenschutz from './pages/Datenschutz'
import { ProtectedRoute } from './components/ProtectedRoute'
import { ThemeLoader } from './components/ThemeLoader'

export default function App() {
  return (
    <BrowserRouter basename="/mandatscockpit">
      <ThemeLoader />
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
          path="/termin/:kind/:id"
          element={
            <ProtectedRoute>
              <TerminDetail />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
