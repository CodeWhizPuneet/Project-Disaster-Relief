import { Link } from 'react-router-dom'
import { Home } from 'lucide-react'
import { ThemeToggle } from '../components/ThemeToggle'

export default function NotFoundPage() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-bg)', flexDirection: 'column', gap: 20, padding: 24,
      backgroundImage: 'radial-gradient(ellipse at 50% 50%, rgba(239,68,68,0.05) 0%, transparent 70%)',
      position: 'relative'
    }}>
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <ThemeToggle compact />
      </div>
      <div style={{ fontSize: 80, lineHeight: 1 }}>🚨</div>
      <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-1px' }}>404 — Page Not Found</h1>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 15, textAlign: 'center', maxWidth: 360 }}>
        The page you're looking for doesn't exist or you don't have access to it.
      </p>
      <Link to="/" className="btn-primary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 24px' }}>
        <Home size={16} />Back to Map
      </Link>
    </div>
  )
}
