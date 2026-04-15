import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate, Link } from 'react-router-dom'
import axios from 'axios'
import toast from 'react-hot-toast'
import { Package, Plus, Trash2, Edit2, AlertTriangle, LogOut, MapPin, X, Check } from 'lucide-react'
import { ThemeToggle } from '../components/ThemeToggle'

interface Resource {
  _id: string; name: string; type: string; quantity: number; unit: string
  lowStockThreshold: number; location: { campName: string }; isAvailable: boolean
}

const TYPES = ['food', 'water', 'medical', 'vehicle', 'shelter', 'clothing', 'other']
const TYPE_ICONS: Record<string, string> = { food: '🍱', water: '💧', medical: '🏥', vehicle: '🚗', shelter: '⛺', clothing: '👕', other: '📦' }

const defaultForm = { name: '', type: 'food', quantity: 0, unit: 'units', lowStockThreshold: 10, location: { campName: '', coordinates: [0, 0] } }

export default function ResourcesPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [resources, setResources] = useState<Resource[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<any>(defaultForm)
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchResources() }, [])

  const fetchResources = async () => {
    try {
      const { data } = await axios.get('/api/resources')
      setResources(data.data || [])
    } catch { toast.error('Failed to load resources') }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (editId) {
        await axios.patch(`/api/resources/${editId}`, form)
        toast.success('Resource updated!')
      } else {
        await axios.post('/api/resources', form)
        toast.success('Resource added!')
      }
      setShowForm(false); setEditId(null); setForm(defaultForm)
      fetchResources()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Operation failed')
    } finally { setLoading(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this resource?')) return
    try {
      await axios.delete(`/api/resources/${id}`)
      toast.success('Resource removed')
      fetchResources()
    } catch { toast.error('Delete failed') }
  }

  const startEdit = (res: Resource) => {
    setForm({ name: res.name, type: res.type, quantity: res.quantity, unit: res.unit, lowStockThreshold: res.lowStockThreshold, location: { campName: res.location?.campName || '', coordinates: [0, 0] } })
    setEditId(res._id); setShowForm(true)
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--color-bg)', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{ width: 220, background: 'var(--color-surface)', borderRight: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--glass-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ background: '#ef4444', borderRadius: 8, padding: 6 }}><AlertTriangle size={16} color="white" /></div>
            <div><div style={{ fontWeight: 800, fontSize: 15 }}>DisasterLink</div><div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>ADMIN</div></div>
          </div>
        </div>
        <nav style={{ padding: '12px 10px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Link to="/admin" className="nav-link"><AlertTriangle size={16} />Dashboard</Link>
          <Link to="/resources" className="nav-link active"><Package size={16} />Resources</Link>
          <Link to="/" className="nav-link"><MapPin size={16} />Live Map</Link>
        </nav>
        <div style={{ padding: '12px 10px', borderTop: '1px solid var(--glass-border)' }}>
          <button onClick={() => { logout(); navigate('/') }} className="nav-link" style={{ color: '#ef4444', width: '100%', background: 'none', border: 'none', textAlign: 'left' }}>
            <LogOut size={16} />Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800 }}>📦 Resource Inventory</h1>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{resources.length} resources tracked</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ThemeToggle compact />
            <button onClick={() => { setShowForm(true); setEditId(null); setForm(defaultForm) }} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Plus size={16} />Add Resource
            </button>
          </div>
        </div>

        {/* Add/Edit form */}
        {showForm && (
          <div className="glass fade-in" style={{ padding: 24, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>{editId ? 'Edit Resource' : 'Add New Resource'}</h3>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Resource Name *</label>
                  <input className="input-field" placeholder="e.g., Rice" value={form.name} onChange={e => setForm((p: any) => ({ ...p, name: e.target.value }))} required />
                </div>
                <div>
                  <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Type *</label>
                  <select className="input-field" value={form.type} onChange={e => setForm((p: any) => ({ ...p, type: e.target.value }))}>
                    {TYPES.map(t => <option key={t} value={t}>{TYPE_ICONS[t]} {t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Quantity *</label>
                  <input type="number" min={0} className="input-field" value={form.quantity} onChange={e => setForm((p: any) => ({ ...p, quantity: parseInt(e.target.value) || 0 }))} required />
                </div>
                <div>
                  <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Unit *</label>
                  <input className="input-field" placeholder="kg, liters, units" value={form.unit} onChange={e => setForm((p: any) => ({ ...p, unit: e.target.value }))} required />
                </div>
                <div>
                  <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Low Stock Alert At</label>
                  <input type="number" min={0} className="input-field" value={form.lowStockThreshold} onChange={e => setForm((p: any) => ({ ...p, lowStockThreshold: parseInt(e.target.value) || 0 }))} />
                </div>
                <div>
                  <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Camp / Location Name</label>
                  <input className="input-field" placeholder="e.g., Camp Alpha" value={form.location.campName} onChange={e => setForm((p: any) => ({ ...p, location: { ...p.location, campName: e.target.value } }))} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" className="btn-primary" disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Check size={16} />{loading ? 'Saving...' : editId ? 'Update' : 'Add Resource'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        )}

        {/* Resource cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {resources.map(res => {
            const isLow = res.quantity <= res.lowStockThreshold
            return (
              <div key={res._id} className="glass" style={{ padding: 18, position: 'relative', border: isLow ? '1px solid rgba(239,68,68,0.4)' : '1px solid var(--glass-border)' }}>
                {isLow && <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(239,68,68,0.15)', color: '#f87171', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>⚠ LOW STOCK</div>}
                <div style={{ fontSize: 28, marginBottom: 10 }}>{TYPE_ICONS[res.type] || '📦'}</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{res.name}</h3>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12, textTransform: 'capitalize' }}>{res.type}</div>
                <div style={{ fontSize: 30, fontWeight: 900, color: isLow ? '#dc2626' : 'var(--color-text)', marginBottom: 2, letterSpacing: '-0.3px', lineHeight: 1.1 }}>{res.quantity}</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12, fontWeight: 600 }}>{res.unit}</div>
                {res.location?.campName && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 14 }}>
                    <MapPin size={12} />{res.location.campName}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => startEdit(res)} className="btn-secondary" style={{ padding: '6px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Edit2 size={12} />Edit
                  </button>
                  <button onClick={() => handleDelete(res._id)} style={{ padding: '6px 12px', fontSize: 12, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Trash2 size={12} />Delete
                  </button>
                </div>
              </div>
            )
          })}
          {resources.length === 0 && (
            <div className="glass" style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', gridColumn: '1 / -1' }}>
              <Package size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
              <p>No resources added yet. Click "Add Resource" to get started.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
