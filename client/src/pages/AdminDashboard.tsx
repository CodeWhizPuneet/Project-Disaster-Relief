import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSocket } from '../hooks/useSocket'
import { useNavigate, Link } from 'react-router-dom'
import axios from 'axios'
import toast from 'react-hot-toast'
import { exportCSV } from '../utils/exportCSV'
import { timeAgo, formatExactDate } from '../utils/timeAgo'
import { ThemeToggle } from '../components/ThemeToggle'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts'
import {
  AlertTriangle, Users, CheckCircle, Clock, Package,
  MapPin, Zap, LogOut, BarChart2, Database, X, Bell,
  RefreshCw, UserCheck, Radio, Search, Download
} from 'lucide-react'

interface Incident {
  _id: string; type: string; urgency: string; status: string; description: string
  entityType?: 'incident'
  location: { coordinates: [number, number]; address: string }
  submittedBy?: { name: string; phone: string; _id: string }
  createdAt: string; numberOfPeople?: number; priorityScore?: number
}
interface Volunteer {
  _id: string
  name: string
  email: string
  phone: string
  isAvailable: boolean
  trackingStatus?: 'offline' | 'available' | 'assigned'
  assignedIncidentId?: string | null
  location?: { coordinates?: [number, number] }
  locationUpdatedAt?: string | null
  createdAt: string
}
interface Notification { id: string; msg: string; time: Date; type: 'sos' | 'update' | 'alert' }

const TYPE_EMOJI: Record<string, string> = { food: '🍱', water: '💧', medical: '🏥', rescue: '🚁', shelter: '⛺' }
const STATUS_COLOR: Record<string, string> = { pending: '#eab308', assigned: '#3b82f6', in_progress: '#f97316', resolved: '#22c55e', cancelled: '#6b7280' }
const CHART_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7']
const VOLUNTEER_STATUS_COLOR: Record<string, string> = {
  available: '#22c55e',
  assigned: '#f97316',
  offline: '#64748b',
}



// ─── Assign Modal ───────────────────────────────────────────────
const AssignModal = ({ request, volunteers, onClose, onAssigned }: {
  request: Incident; volunteers: Volunteer[]; onClose: () => void; onAssigned: () => void
}) => {
  const [selectedVol, setSelectedVol] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoAssigning, setAutoAssigning] = useState(false)
  const [suggestions, setSuggestions] = useState<Array<{ _id: string; distanceKm: number; hasLiveLocation?: boolean }>>([])

  useEffect(() => {
    let mounted = true

    const loadSuggestions = async () => {
      try {
        const { data } = await axios.get(`/api/tasks/suggestions/${request._id}`, { params: { limit: 5 } })
        if (!mounted) return
        setSuggestions(data?.data || [])
      } catch {
        if (!mounted) return
        setSuggestions([])
      }
    }

    loadSuggestions()
    return () => {
      mounted = false
    }
  }, [request._id])

  const handleAssign = async () => {
    if (!selectedVol) { toast.error('Select a volunteer'); return }
    setLoading(true)
    try {
      await axios.post('/api/tasks', { requestId: request._id, volunteerId: selectedVol, notes })
      toast.success('✅ Task assigned successfully!')
      onAssigned(); onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Assignment failed')
    } finally { setLoading(false) }
  }

  const handleAutoAssign = async () => {
    setAutoAssigning(true)
    try {
      await axios.post(`/api/tasks/auto-assign/${request._id}`, { notes })
      toast.success('Nearest volunteer auto-assigned')
      onAssigned()
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Auto-assignment failed')
    } finally {
      setAutoAssigning(false)
    }
  }

  const availableVols = volunteers.filter(v => v.isAvailable)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="glass fade-in" style={{ width: '100%', maxWidth: 480, padding: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h3 style={{ fontSize: 17, fontWeight: 700 }}>Assign Volunteer</h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {TYPE_EMOJI[request.type]} {request.type} · <span className={`badge badge-${request.urgency}`}>{request.urgency}</span>
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {/* Request info */}
        <div style={{ background: 'var(--color-surface-2)', borderRadius: 8, padding: '12px 14px', marginBottom: 18 }}>
          {request.description && <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 6 }}>{request.description}</p>}
          <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', gap: 12 }}>
            <span>📍 {request.location.address || 'Location on map'}</span>
            {request.numberOfPeople && <span>👥 {request.numberOfPeople} people</span>}
          </div>
        </div>

        {/* Volunteer selection */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', marginBottom: 8 }}>
            Select Volunteer ({availableVols.length} available)
          </label>
          {availableVols.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13, border: '1px dashed var(--glass-border)', borderRadius: 8 }}>
              No volunteers available right now
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
              {availableVols.map(vol => (
                <button key={vol._id} type="button" onClick={() => setSelectedVol(vol._id)}
                  style={{
                    padding: '10px 14px', borderRadius: 8, textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    border: `2px solid ${selectedVol === vol._id ? '#22c55e' : 'rgba(255,255,255,0.1)'}`,
                    background: selectedVol === vol._id ? 'rgba(34,197,94,0.1)' : 'var(--glass-bg)',
                    transition: 'all 0.15s'
                  }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{vol.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{vol.phone || vol.email}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block', boxShadow: '0 0 6px #22c55e' }}></span>
                    <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 600 }}>Available</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {suggestions.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6, fontWeight: 600 }}>
              Nearest Volunteers
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {suggestions.map(item => {
                const vol = availableVols.find(v => v._id === item._id)
                if (!vol) return null

                return (
                  <button
                    type="button"
                    key={item._id}
                    onClick={() => setSelectedVol(item._id)}
                    style={{
                      borderRadius: 18,
                      border: selectedVol === item._id ? '1px solid rgba(34,197,94,0.7)' : '1px solid var(--glass-border)',
                      background: selectedVol === item._id ? 'rgba(34,197,94,0.14)' : 'var(--glass-bg)',
                      color: 'var(--color-text)',
                      padding: '5px 10px',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {vol.name} · {Number.isFinite(item.distanceKm) ? `${item.distanceKm} km` : 'unknown'}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Notes for Volunteer (optional)</label>
          <textarea className="input-field" rows={2} placeholder="e.g., Bring rescue equipment, access from north gate..." value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: 'none' }} />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleAutoAssign}
            disabled={autoAssigning || loading}
            className="btn-secondary"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <Zap size={16} />{autoAssigning ? 'Assigning...' : 'Auto Assign Nearest'}
          </button>
          <button onClick={handleAssign} disabled={loading || !selectedVol} className="btn-primary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <UserCheck size={16} />{loading ? 'Assigning...' : 'Confirm Assignment'}
          </button>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Dashboard ──────────────────────────────────────────────
export default function AdminDashboard() {
  const { user, logout } = useAuth()
  const { socket, connected } = useSocket(user)
  const navigate = useNavigate()
  const [requests, setRequests] = useState<Incident[]>([])
  const [volunteers, setVolunteers] = useState<Volunteer[]>([])
  const [stats, setStats] = useState<any>({})
  const [activeTab, setActiveTab] = useState<'overview' | 'requests' | 'volunteers'>('overview')
  const [assignTarget, setAssignTarget] = useState<Incident | null>(null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showNotifs, setShowNotifs] = useState(false)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  const normalizeIncident = useCallback((raw: any): Incident | null => {
    if (!raw) return null
    const incidentId = raw._id || raw.requestId
    if (!incidentId) return null

    return {
      _id: String(incidentId),
      entityType: 'incident',
      type: String(raw.type || 'rescue'),
      urgency: String(raw.urgency || 'medium'),
      status: String(raw.status || 'pending'),
      description: String(raw.description || ''),
      location: raw.location || { coordinates: [0, 0], address: '' },
      submittedBy: raw.submittedBy,
      createdAt: raw.createdAt || new Date().toISOString(),
      numberOfPeople: typeof raw.numberOfPeople === 'number' ? raw.numberOfPeople : undefined,
      priorityScore: typeof raw.priorityScore === 'number' ? raw.priorityScore : undefined,
    }
  }, [])

  const upsertIncident = useCallback((prev: Incident[], next: Incident) => {
    const existingIdx = prev.findIndex(item => item._id === next._id)
    if (existingIdx === -1) return [next, ...prev]

    const merged = [...prev]
    merged[existingIdx] = { ...merged[existingIdx], ...next }
    return merged
  }, [])

  const fetchAll = useCallback(async () => {
    try {
      const [reqRes, statsRes, volRes] = await Promise.all([
        axios.get('/api/requests?limit=200'),
        axios.get('/api/requests/stats'),
        axios.get('/api/users/volunteers'),
      ])
      const incidents = (reqRes.data.data || [])
        .map((item: any) => normalizeIncident(item))
        .filter(Boolean) as Incident[]
      setRequests(incidents)
      setStats(statsRes.data.data || {})
      setVolunteers(volRes.data.data || [])
    } catch { toast.error('Failed to load data') }
  }, [normalizeIncident])

  useEffect(() => { fetchAll() }, [fetchAll])

  useEffect(() => {
    if (!socket) return
    socket.on('new_request', (req: any) => {
      const incident = normalizeIncident(req)
      if (!incident) return

      setRequests(p => upsertIncident(p, incident))
      const notif: Notification = { id: Date.now().toString(), msg: `New incident: ${incident.type} (${incident.urgency})`, time: new Date(), type: 'sos' }
      setNotifications(p => [notif, ...p.slice(0, 19)])
      toast(`New incident: ${incident.type}`, { icon: '🚨', duration: 5000 })
    })
    socket.on('status_updated', ({ requestId, status }: any) => {
      setRequests(p => p.map(r => r._id === requestId ? { ...r, status } : r))
      const notif: Notification = { id: Date.now().toString(), msg: `📋 Task status → ${status}`, time: new Date(), type: 'update' }
      setNotifications(p => [notif, ...p.slice(0, 19)])
    })
    socket.on('resource_low', ({ name, quantity, unit }: any) => {
      const notif: Notification = { id: Date.now().toString(), msg: `⚠️ Low stock: ${name} (${quantity} ${unit} left)`, time: new Date(), type: 'alert' }
      setNotifications(p => [notif, ...p.slice(0, 19)])
      toast.error(`⚠️ Low stock: ${name}`, { duration: 6000 })
    })
    socket.on('volunteer_status_update', (payload: any) => {
      if (!payload?.volunteerId) return

      setVolunteers(prev =>
        prev.map(vol =>
          vol._id === payload.volunteerId
            ? {
                ...vol,
                isAvailable: Boolean(payload.available),
                trackingStatus: payload.trackingStatus || (payload.available ? 'available' : 'offline'),
                assignedIncidentId: payload.incidentId || null,
                locationUpdatedAt: payload.locationUpdatedAt || vol.locationUpdatedAt || null,
                location: payload.location
                  ? { coordinates: [payload.location.lng, payload.location.lat] }
                  : vol.location,
              }
            : vol
        )
      )
    })

    socket.on('volunteer_location_updated', (payload: any) => {
      if (!payload?.volunteerId || !payload?.location) return

      setVolunteers(prev =>
        prev.map(vol =>
          vol._id === payload.volunteerId
            ? {
                ...vol,
                trackingStatus: payload.status || vol.trackingStatus,
                isAvailable: payload.status ? payload.status === 'available' : vol.isAvailable,
                assignedIncidentId: payload.incidentId || null,
                locationUpdatedAt: payload.timestamp || vol.locationUpdatedAt || null,
                location: { coordinates: [payload.location.lng, payload.location.lat] },
              }
            : vol
        )
      )
    })

    return () => {
      socket.off('new_request')
      socket.off('status_updated')
      socket.off('resource_low')
      socket.off('volunteer_status_update')
      socket.off('volunteer_location_updated')
    }
  }, [socket, fetchAll, normalizeIncident, upsertIncident])

  // Filtered requests (with search)
  const filteredRequests = requests.filter(r => {
    const matchStatus = filterStatus === 'all' || r.status === filterStatus
    const matchType = filterType === 'all' || r.type === filterType
    const q = searchQuery.toLowerCase().trim()
    const matchSearch = !q || [r.description, r.location.address, r.submittedBy?.name, r.type].some(
      v => v?.toLowerCase().includes(q)
    )
    return matchStatus && matchType && matchSearch
  })

  // Chart data
  const byType = stats.byType?.map((s: any) => ({ name: s._id, count: s.count, emoji: TYPE_EMOJI[s._id] })) || []
  const byStatus = stats.byStatus?.map((s: any) => ({ name: s._id.replace('_', ' '), count: s.count })) || []
  const totalCount = (status: string) => stats.byStatus?.find((s: any) => s._id === status)?.count || 0
  const unreadNotifs = notifications.length

  const statCards = [
    { label: 'Today\'s Incidents', value: stats.totalToday ?? 0, icon: Zap, color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
    { label: 'Pending', value: totalCount('pending'), icon: Clock, color: '#eab308', bg: 'rgba(234,179,8,0.1)' },
    { label: 'In Progress', value: totalCount('in_progress'), icon: AlertTriangle, color: '#f97316', bg: 'rgba(249,115,22,0.1)' },
    { label: 'Resolved', value: totalCount('resolved'), icon: CheckCircle, color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
    { label: 'Volunteers', value: volunteers.length, icon: Users, color: '#a855f7', bg: 'rgba(168,85,247,0.1)' },
    { label: 'Available Now', value: volunteers.filter(v => v.isAvailable).length, icon: Radio, color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
  ]

  const navItems = [
    { key: 'overview', label: 'Overview', icon: BarChart2 },
    { key: 'requests', label: 'Incidents', icon: AlertTriangle },
    { key: 'volunteers', label: 'Volunteers', icon: Users },
  ]

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--color-bg)', overflow: 'hidden' }}>
      {/* Assign Modal */}
      {assignTarget && (
        <AssignModal
          request={assignTarget}
          volunteers={volunteers}
          onClose={() => setAssignTarget(null)}
          onAssigned={fetchAll}
        />
      )}

      {/* Sidebar */}
      <aside style={{ width: 230, background: 'var(--color-surface)', borderRight: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '18px 16px', borderBottom: '1px solid var(--glass-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ background: 'linear-gradient(135deg, #ef4444, #b91c1c)', borderRadius: 8, padding: '6px 8px' }}>
              <AlertTriangle size={16} color="white" />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: '-0.3px' }}>DisasterLink</div>
              <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, letterSpacing: 1 }}>ADMIN CONSOLE</div>
            </div>
          </div>
        </div>

        <nav style={{ padding: '10px 10px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {navItems.map(item => {
            const Icon = item.icon
            return (
              <button key={item.key} onClick={() => setActiveTab(item.key as any)}
                className={`nav-link ${activeTab === item.key ? 'active' : ''}`}
                style={{ background: 'none', border: activeTab === item.key ? undefined : 'none', textAlign: 'left', width: '100%' }}>
                <Icon size={15} />{item.label}
                {item.key === 'requests' && totalCount('pending') > 0 && (
                  <span style={{ marginLeft: 'auto', background: '#ef4444', color: 'white', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{totalCount('pending')}</span>
                )}
              </button>
            )
          })}
          <div style={{ borderTop: '1px solid var(--glass-border)', margin: '8px 0' }} />
          <Link to="/resources" className="nav-link"><Database size={15} />Resources</Link>
          <Link to="/" className="nav-link"><MapPin size={15} />Live Map</Link>
        </nav>

        <div style={{ padding: '12px 10px', borderTop: '1px solid var(--glass-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--glass-bg)', marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #ef4444, #b91c1c)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
              {user?.name[0]}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name}</div>
              <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>Administrator</div>
            </div>
          </div>
          <button onClick={() => { logout(); navigate('/') }} className="nav-link" style={{ color: '#ef4444', width: '100%', background: 'none', border: 'none', textAlign: 'left', fontSize: 13 }}>
            <LogOut size={14} />Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar */}
        <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: 'var(--glass-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="conn-dot" style={{ background: connected ? '#22c55e' : '#ef4444', boxShadow: connected ? '0 0 6px #22c55e' : 'none' }}></span>
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontWeight: 600 }}>{connected ? 'Live — Real-time updates active' : 'Connecting...'}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <ThemeToggle compact />
            <button onClick={fetchAll} className="btn-secondary" style={{ padding: '7px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
              <RefreshCw size={13} />Refresh
            </button>
            <div style={{ position: 'relative' }}>
              <button onClick={() => setShowNotifs(p => !p)} className="btn-secondary" style={{ padding: '7px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, position: 'relative' }}>
                <Bell size={13} />Alerts
                {unreadNotifs > 0 && <span style={{ position: 'absolute', top: -4, right: -4, background: '#ef4444', color: 'white', borderRadius: '50%', width: 16, height: 16, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{unreadNotifs > 9 ? '9+' : unreadNotifs}</span>}
              </button>
              {showNotifs && (
                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 8, width: 320, background: 'var(--color-surface)', border: '1px solid var(--glass-border)', borderRadius: 12, zIndex: 100, boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>Notifications</span>
                    <button onClick={() => { setNotifications([]); setShowNotifs(false) }} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 12 }}>Clear all</button>
                  </div>
                  <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                    {notifications.length === 0 ? (
                      <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>No alerts yet</div>
                    ) : notifications.map(n => (
                      <div key={n.id} style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: n.type === 'sos' ? 'rgba(239,68,68,0.05)' : n.type === 'alert' ? 'rgba(234,179,8,0.05)' : 'transparent' }}>
                        <div style={{ fontSize: 13, marginBottom: 2 }}>{n.msg}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }} title={formatExactDate(n.time.toISOString())}>{timeAgo(n.time.toISOString())}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <main style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

          {/* ── OVERVIEW TAB ── */}
          {activeTab === 'overview' && (
            <div className="fade-in">
              <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' }}>Operations Overview</h1>
                <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginTop: 2 }}>Live disaster relief coordination — {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
              </div>

              {/* Stat cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
                {statCards.map(card => {
                  const Icon = card.icon
                  return (
                    <div key={card.label} className="stat-card" style={{ cursor: 'default' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                        <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 500 }}>{card.label}</span>
                        <div style={{ background: card.bg, borderRadius: 8, padding: 7 }}>
                          <Icon size={15} color={card.color} />
                        </div>
                      </div>
                      <div style={{ fontSize: 36, fontWeight: 900, color: card.color, letterSpacing: '-1px' }}>{card.value}</div>
                    </div>
                  )
                })}
              </div>

              {/* Charts */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
                <div className="glass" style={{ padding: 20 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>📊 Requests by Type</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={byType} barSize={32}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--glass-border)', borderRadius: 8, color: 'var(--color-text)', fontSize: 13 }} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {byType.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="glass" style={{ padding: 20 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>🍩 Requests by Status</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={byStatus} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3}>
                        {byStatus.map((_: any, i: number) => <Cell key={i} fill={Object.values(STATUS_COLOR)[i % 5]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--glass-border)', borderRadius: 8, color: 'var(--color-text)' }} />
                      <Legend formatter={(v) => <span style={{ fontSize: 12, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>{v}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Recent pending incidents */}
              <div className="glass" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700 }}>Pending Incidents — Awaiting Assignment</h3>
                  <button onClick={() => setActiveTab('requests')} style={{ fontSize: 12, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>View All →</button>
                </div>
                <table className="data-table">
                  <thead><tr><th>Type</th><th>Urgency</th><th>Submitted By</th><th>Location</th><th>Time</th><th>Action</th></tr></thead>
                  <tbody>
                    {requests.filter(r => r.status === 'pending').slice(0, 5).map(req => (
                      <tr key={req._id} className="fade-in">
                        <td style={{ fontWeight: 600 }}>{TYPE_EMOJI[req.type]} {req.type}</td>
                        <td><span className={`badge badge-${req.urgency}`}>{req.urgency}</span></td>
                        <td style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{req.submittedBy?.name || '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-muted)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.location.address || 'Map location'}</td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }} title={formatExactDate(req.createdAt)}>{timeAgo(req.createdAt)}</td>
                        <td><button onClick={() => setAssignTarget(req)} className="btn-success" style={{ fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 4 }}><UserCheck size={13} />Assign</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {requests.filter(r => r.status === 'pending').length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', color: '#4ade80', fontSize: 14 }}>✅ All requests are being handled!</div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'requests' && (
            <div className="fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h1 style={{ fontSize: 22, fontWeight: 800 }}>All Incidents</h1>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{filteredRequests.length} of {requests.length} incidents</p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {/* Search */}
                  <div className="search-wrapper">
                    <input
                      className="input-field search-input"
                      placeholder="Search by name, location, type..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      style={{ width: 220, fontSize: 13 }}
                    />
                  </div>
                  <select className="input-field" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: 'auto', cursor: 'pointer', fontSize: 13 }}>
                    <option value="all">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="assigned">Assigned</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                  </select>
                  <select className="input-field" value={filterType} onChange={e => setFilterType(e.target.value)} style={{ width: 'auto', cursor: 'pointer', fontSize: 13 }}>
                    <option value="all">All Types</option>
                    <option value="rescue">Rescue</option>
                    <option value="medical">Medical</option>
                    <option value="food">Food</option>
                    <option value="water">Water</option>
                    <option value="shelter">Shelter</option>
                  </select>
                  <button onClick={fetchAll} className="btn-secondary" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <RefreshCw size={13} />Refresh
                  </button>
                  <button
                    onClick={() => exportCSV(filteredRequests.map(r => ({
                      Type: r.type, Urgency: r.urgency, Status: r.status,
                      Description: r.description, Location: r.location.address,
                      People: r.numberOfPeople, SubmittedBy: r.submittedBy?.name, Phone: r.submittedBy?.phone,
                      Time: new Date(r.createdAt).toLocaleString()
                    })), 'incidents')}
                    className="btn-secondary"
                    style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.3)', color: '#4ade80' }}
                    data-tooltip="Export filtered data as CSV"
                  >
                    <Download size={13} />Export CSV
                  </button>
                </div>
              </div>
              <div className="glass" style={{ overflow: 'hidden' }}>
                <table className="data-table">
                  <thead>
                    <tr><th>#</th><th>Type</th><th>Urgency</th><th>Submitted By</th><th>Location</th><th>People</th><th>Status</th><th>Time</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((req, i) => (
                      <tr key={req._id}>
                        <td style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{TYPE_EMOJI[req.type]} {req.type}</td>
                        <td><span className={`badge badge-${req.urgency}`}>{req.urgency}</span></td>
                        <td style={{ fontSize: 13 }}>{req.submittedBy?.name || '—'}<br /><span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{req.submittedBy?.phone}</span></td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.location.address || `${req.location.coordinates[1]?.toFixed(3)}, ${req.location.coordinates[0]?.toFixed(3)}`}</td>
                        <td style={{ textAlign: 'center' }}>{req.numberOfPeople ?? 1}</td>
                        <td><span className={`badge badge-${req.status}`}>{req.status.replace('_', ' ')}</span></td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }} title={formatExactDate(req.createdAt)}>{timeAgo(req.createdAt)}</td>
                        <td>
                          {req.status === 'pending' && (
                            <button onClick={() => setAssignTarget(req)} className="btn-success" style={{ fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                              <UserCheck size={12} />Assign
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredRequests.length === 0 && (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>No requests match the selected filters</div>
                )}
              </div>
            </div>
          )}

          {/* ── VOLUNTEERS TAB ── */}
          {activeTab === 'volunteers' && (
            <div className="fade-in">
              <div style={{ marginBottom: 20 }}>
                <h1 style={{ fontSize: 22, fontWeight: 800 }}>👥 Volunteer Management</h1>
                <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{volunteers.filter(v => v.isAvailable).length} of {volunteers.length} available</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                {volunteers.map(vol => (
                  <div key={vol._id} className="glass" style={{ padding: 18, border: vol.isAvailable ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--glass-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 40, height: 40, borderRadius: '50%', background: `linear-gradient(135deg, ${vol.isAvailable ? '#22c55e' : '#6b7280'}, ${vol.isAvailable ? '#16a34a' : '#374151'})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16 }}>
                          {vol.name[0]}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15 }}>{vol.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{vol.phone || vol.email}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: VOLUNTEER_STATUS_COLOR[vol.trackingStatus || 'offline'],
                            display: 'inline-block',
                            boxShadow:
                              vol.trackingStatus === 'available'
                                ? '0 0 6px #22c55e'
                                : vol.trackingStatus === 'assigned'
                                  ? '0 0 6px #f97316'
                                  : 'none',
                          }}
                        ></span>
                        <span
                          style={{
                            fontSize: 12,
                            color:
                              vol.trackingStatus === 'available'
                                ? '#4ade80'
                                : vol.trackingStatus === 'assigned'
                                  ? '#fdba74'
                                  : '#9ca3af',
                            fontWeight: 600,
                            textTransform: 'capitalize',
                          }}
                        >
                          {vol.trackingStatus || (vol.isAvailable ? 'available' : 'offline')}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }} title={formatExactDate(vol.createdAt)}>Joined {timeAgo(vol.createdAt)}</div>
                    {vol.location?.coordinates && (
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10 }}>
                        Last known: {vol.location.coordinates[1].toFixed(4)}, {vol.location.coordinates[0].toFixed(4)}
                      </div>
                    )}
                    {vol.assignedIncidentId && (
                      <div style={{ fontSize: 11, color: '#fbbf24', marginBottom: 10 }}>
                        Assigned incident: {String(vol.assignedIncidentId).slice(-8)}
                      </div>
                    )}
                    {vol.isAvailable && (
                      <button
                        onClick={() => {
                          const pending = requests.filter(r => r.status === 'pending')
                          if (pending.length === 0) { toast.error('No pending requests to assign'); return }
                          setAssignTarget(pending[0])
                        }}
                        className="btn-success" style={{ fontSize: 12, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <UserCheck size={13} />Assign Task
                      </button>
                    )}
                  </div>
                ))}
                {volunteers.length === 0 && (
                  <div className="glass" style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', gridColumn: '1 / -1' }}>
                    <Users size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                    <p>No volunteers registered yet</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
