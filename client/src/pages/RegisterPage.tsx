import React, { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'
import { AlertTriangle, Mail, Lock, User, Phone, Heart } from 'lucide-react'
import { ThemeToggle } from '../components/ThemeToggle'

const roles = [
  { value: 'user', label: 'I need help', icon: User, desc: 'Submit emergency SOS requests' },
  { value: 'volunteer', label: 'I want to help', icon: Heart, desc: 'Respond to SOS requests as a field volunteer' },
] as const

export default function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialRole = searchParams.get('role') === 'volunteer' ? 'volunteer' : 'user'
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', role: initialRole as 'user' | 'volunteer' })
  const [loading, setLoading] = useState(false)

  const getPostRegisterRoute = (role: string) => {
    if (role === 'admin') return '/admin'
    if (role === 'volunteer') return '/volunteer'
    return '/my-requests'
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.password.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }

    setLoading(true)
    try {
      const createdUser = await register(form)
      toast.success('Account created successfully!')
      navigate(getPostRegisterRoute(createdUser.role), { replace: true })
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-bg)',
      backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(239,68,68,0.08) 0%, transparent 60%)',
      padding: 20,
      position: 'relative'
    }}>
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <ThemeToggle compact />
      </div>
      <div className="glass fade-in" style={{ width: '100%', maxWidth: 460, padding: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ display: 'inline-flex', background: '#ef4444', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <AlertTriangle size={28} color="white" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>Create Account</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginTop: 4 }}>Join DisasterLink today</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
          {roles.map(r => {
            const Icon = r.icon
            const active = form.role === r.value
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => setForm(p => ({ ...p, role: r.value }))}
                style={{
                  padding: '14px 12px', borderRadius: 10, textAlign: 'center', cursor: 'pointer',
                  border: `2px solid ${active ? '#ef4444' : 'rgba(255,255,255,0.1)'}`,
                  background: active ? 'rgba(239,68,68,0.1)' : 'var(--glass-bg)',
                  transition: 'all 0.2s'
                }}
              >
                <Icon size={20} color={active ? '#ef4444' : '#9ca3af'} style={{ margin: '0 auto 6px' }} />
                <div style={{ fontWeight: 600, fontSize: 13, color: active ? '#ef4444' : 'var(--color-text)' }}>{r.label}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{r.desc}</div>
              </button>
            )
          })}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Full Name</label>
              <div style={{ position: 'relative' }}>
                <User size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input className="input-field" style={{ paddingLeft: 32 }} placeholder="John Doe" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Phone</label>
              <div style={{ position: 'relative' }}>
                <Phone size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input className="input-field" style={{ paddingLeft: 32 }} placeholder="+91 98765..." value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
              </div>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Email</label>
            <div style={{ position: 'relative' }}>
              <Mail size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input type="email" className="input-field" style={{ paddingLeft: 32 }} placeholder="you@email.com" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} required />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Password</label>
            <div style={{ position: 'relative' }}>
              <Lock size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input type="password" className="input-field" style={{ paddingLeft: 32 }} placeholder="Min 6 characters" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} required />
            </div>
          </div>

          <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', padding: '12px', fontSize: 15 }}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: 'var(--color-text-muted)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'none' }}>Sign In</Link>
        </p>
      </div>
    </div>
  )
}
