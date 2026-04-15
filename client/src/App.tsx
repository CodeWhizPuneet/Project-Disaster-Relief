import React, { Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Toaster } from 'react-hot-toast'

const HomePage = React.lazy(() => import('./pages/HomePage'))
const LoginPage = React.lazy(() => import('./pages/LoginPage'))
const RegisterPage = React.lazy(() => import('./pages/RegisterPage'))
const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard'))
const VolunteerDashboard = React.lazy(() => import('./pages/VolunteerDashboard'))
const UserDashboard = React.lazy(() => import('./pages/CivilianDashboard'))
const SOSPage = React.lazy(() => import('./pages/SOSPage'))
const ResourcesPage = React.lazy(() => import('./pages/ResourcesPage'))
const NotFoundPage = React.lazy(() => import('./pages/NotFoundPage'))

const PageLoader = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 14, background: 'var(--color-bg)' }}>
    <div style={{ width: 44, height: 44, border: '3px solid rgba(239,68,68,0.2)', borderTop: '3px solid #ef4444', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    <span style={{ color: '#9ca3af', fontSize: 13, letterSpacing: 0.5 }}>Loading...</span>
  </div>
)

const ProtectedRoute = ({ children, roles }: { children: React.ReactNode; roles?: string[] }) => {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />
  return <>{children}</>
}

const AppRoutes = () => {
  const { user } = useAuth()

  const afterLogin = user?.role === 'admin'
    ? '/admin'
    : user?.role === 'volunteer'
      ? '/volunteer'
      : user?.role === 'user'
        ? '/my-requests'
        : '/'

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={user ? <Navigate to={afterLogin} replace /> : <LoginPage />} />
        <Route path="/register" element={user ? <Navigate to={afterLogin} replace /> : <RegisterPage />} />

        <Route path="/my-requests" element={<ProtectedRoute roles={['user']}><UserDashboard /></ProtectedRoute>} />
        <Route path="/sos" element={<ProtectedRoute roles={['user']}><SOSPage /></ProtectedRoute>} />

        <Route path="/volunteer" element={<ProtectedRoute roles={['volunteer']}><VolunteerDashboard /></ProtectedRoute>} />

        <Route path="/admin" element={<ProtectedRoute roles={['admin']}><AdminDashboard /></ProtectedRoute>} />
        <Route path="/resources" element={<ProtectedRoute roles={['admin']}><ResourcesPage /></ProtectedRoute>} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}

const App = () => (
  <ErrorBoundary>
    <AuthProvider>
      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--glass-border)', fontSize: 14 },
          success: { iconTheme: { primary: '#22c55e', secondary: '#111827' } },
          error: { iconTheme: { primary: '#ef4444', secondary: '#111827' } },
        }}
      />
      <AppRoutes />
    </AuthProvider>
  </ErrorBoundary>
)

export default App