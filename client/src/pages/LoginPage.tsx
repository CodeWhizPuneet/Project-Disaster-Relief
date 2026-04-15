import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'
import { AlertTriangle, Mail, Lock, Eye, EyeOff } from 'lucide-react'
import { ThemeToggle } from '../components/ThemeToggle'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)

  const getPostLoginRoute = (role: string) => {
    if (role === 'admin') return '/admin'
    if (role === 'volunteer') return '/volunteer'
    return '/my-requests'
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const loggedInUser = await login(form.email, form.password)
      toast.success('Welcome back!')
      navigate(getPostLoginRoute(loggedInUser.role), { replace: true })
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-bg)',
      backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(239,68,68,0.08) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(59,130,246,0.05) 0%, transparent 60%)',
      padding: 20,
      position: 'relative'
    }}>
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <ThemeToggle compact />
      </div>
      <div className="glass fade-in" style={{ width: '100%', maxWidth: 420, padding: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', background: '#ef4444', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <AlertTriangle size={28} color="white" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>Welcome Back</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginTop: 4 }}>Sign in to DisasterLink</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Email address</label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input
                type="email"
                className="input-field"
                style={{ paddingLeft: 38 }}
                placeholder="you@example.com"
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                required
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Password</label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input
                type={showPass ? 'text' : 'password'}
                className="input-field"
                style={{ paddingLeft: 38, paddingRight: 38 }}
                placeholder="********"
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                required
              />
              <button type="button" onClick={() => setShowPass(!showPass)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', padding: '12px', fontSize: 15, marginTop: 4 }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: 'var(--color-text-muted)' }}>
          Don&apos;t have an account?{' '}
          <Link to="/register" style={{ color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'none' }}>Register</Link>
        </p>
      </div>
    </div>
  )
}