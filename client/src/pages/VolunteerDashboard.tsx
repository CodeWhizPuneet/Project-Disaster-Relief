import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSocket } from '../hooks/useSocket'
import { useNavigate, Link } from 'react-router-dom'
import axios from 'axios'
import toast from 'react-hot-toast'
import { AlertTriangle, MapPin, Clock, CheckCircle, Truck, LogOut, ToggleLeft, ToggleRight } from 'lucide-react'
import { useLiveLocationTracking } from '../hooks/useLiveLocationTracking'
import { ThemeToggle } from '../components/ThemeToggle'

interface Task {
  _id: string
  status: 'assigned' | 'accepted' | 'en_route' | 'completed' | 'cancelled'
  notes: string
  requestId: {
    _id: string
    type: string
    urgency: string
    description: string
    location: { coordinates: [number, number]; address: string }
    submittedBy?: { name: string; phone: string }
  }
  createdAt: string
}

const STATUS_FLOW = ['assigned', 'accepted', 'en_route', 'completed']
const STATUS_LABELS: Record<string, string> = {
  assigned: 'Accept Task',
  accepted: 'Start Journey',
  en_route: 'Mark Arrived & Complete',
  completed: 'Completed',
}
const STATUS_COLORS: Record<string, string> = {
  assigned: '#3b82f6',
  accepted: '#f97316',
  en_route: '#a855f7',
  completed: '#22c55e',
  cancelled: '#6b7280',
}

const timeAgo = (d: string) => {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  return diff < 1 ? 'Just now' : diff < 60 ? `${diff}m ago` : `${Math.floor(diff / 60)}h ago`
}

export default function VolunteerDashboard() {
  const { user, logout } = useAuth()
  const { socket, connected } = useSocket(user)
  const navigate = useNavigate()

  const [tasks, setTasks] = useState<Task[]>([])
  const [isAvailable, setIsAvailable] = useState(user?.isAvailable ?? true)
  const [updating, setUpdating] = useState<string | null>(null)
  const [trackedUserLocation, setTrackedUserLocation] = useState<{ lat: number; lng: number; incidentId: string } | null>(null)

  const activeIncidentId = tasks.find(t => t.status !== 'completed' && t.status !== 'cancelled')?.requestId?._id || null

  const fetchTasks = async () => {
    try {
      const { data } = await axios.get('/api/tasks/my-tasks')
      setTasks(data.data || [])
    } catch {
      toast.error('Failed to load tasks')
    }
  }

  useEffect(() => {
    fetchTasks()
  }, [])

  useEffect(() => {
    if (!socket) return

    socket.on('task_assigned', (data: any) => {
      toast.success(`New task assigned: ${data.request?.type}`)
      if (data?.incidentId) socket.emit('join_incident_room', { incidentId: data.incidentId })
      fetchTasks()
    })

    socket.on('status_updated', ({ taskId, status }: any) => {
      setTasks(prev => prev.map(t => (t._id === taskId ? { ...t, status } : t)))
    })

    socket.on('user_location_updated', (payload: any) => {
      if (!payload?.incidentId || !payload?.location) return
      setTrackedUserLocation({
        incidentId: payload.incidentId,
        lat: payload.location.lat,
        lng: payload.location.lng,
      })
    })

    socket.on('incident_assignment_signal', ({ incidentId }: { incidentId?: string }) => {
      if (incidentId) socket.emit('join_incident_room', { incidentId })
      fetchTasks()
    })

    return () => {
      socket.off('task_assigned')
      socket.off('status_updated')
      socket.off('user_location_updated')
      socket.off('incident_assignment_signal')
    }
  }, [socket])

  useEffect(() => {
    if (!socket || !activeIncidentId) return
    socket.emit('join_incident_room', { incidentId: activeIncidentId })
  }, [socket, activeIncidentId])

  useLiveLocationTracking({
    socket,
    enabled: Boolean(socket && user && (isAvailable || activeIncidentId)),
    role: 'volunteer',
    incidentId: activeIncidentId,
    intervalMs: 4000,
  })

  const updateStatus = async (taskId: string, currentStatus: string) => {
    const idx = STATUS_FLOW.indexOf(currentStatus)
    if (idx === STATUS_FLOW.length - 1) return

    const nextStatus = STATUS_FLOW[idx + 1]
    setUpdating(taskId)
    try {
      await axios.patch(`/api/tasks/${taskId}/status`, { status: nextStatus })
      setTasks(prev => prev.map(t => (t._id === taskId ? { ...t, status: nextStatus as Task['status'] } : t)))
      toast.success(nextStatus === 'completed' ? 'Task completed' : `Status updated to ${nextStatus}`)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Update failed')
    } finally {
      setUpdating(null)
    }
  }

  const toggleAvailability = async () => {
    try {
      await axios.patch('/api/auth/availability', { isAvailable: !isAvailable })
      setIsAvailable(!isAvailable)
      socket?.emit('volunteer_available', { volunteerId: user?._id, available: !isAvailable })
      toast.success(`You are now ${!isAvailable ? 'available' : 'unavailable'}`)
    } catch {
      toast.error('Failed to update availability')
    }
  }

  const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled')
  const completedTasks = tasks.filter(t => t.status === 'completed')

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--color-bg)', overflow: 'hidden' }}>
      <aside style={{ width: 220, background: 'var(--color-surface)', borderRight: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--glass-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div style={{ background: '#22c55e', borderRadius: 8, padding: 6 }}><AlertTriangle size={16} color="white" /></div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>DisasterLink</div>
              <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>VOLUNTEER</div>
            </div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.name}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{user?.email}</div>
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-start' }}>
            <ThemeToggle compact />
          </div>
        </div>

        <div style={{ padding: '16px', borderBottom: '1px solid var(--glass-border)' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>Availability Status</div>
          <button
            onClick={toggleAvailability}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: isAvailable ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.15)',
              border: `1px solid ${isAvailable ? 'rgba(34,197,94,0.4)' : 'rgba(107,114,128,0.4)'}`,
              color: isAvailable ? '#4ade80' : '#9ca3af',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {isAvailable ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
            {isAvailable ? 'Available' : 'Unavailable'}
          </button>
        </div>

        <nav style={{ padding: '12px 10px', flex: 1 }}>
          <Link to="/" className="nav-link"><MapPin size={16} />Live Map</Link>
        </nav>

        <div style={{ padding: '12px 10px', borderTop: '1px solid var(--glass-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span className="conn-dot" style={{ background: connected ? '#22c55e' : '#ef4444' }}></span>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{connected ? 'Live' : 'Offline'}</span>
          </div>
          <button onClick={() => { logout(); navigate('/') }} className="nav-link" style={{ color: '#ef4444', width: '100%', background: 'none', border: 'none', textAlign: 'left' }}>
            <LogOut size={16} />Logout
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {trackedUserLocation && (
          <div className="glass" style={{ padding: 12, marginBottom: 14, border: '1px solid rgba(59,130,246,0.35)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Live User Tracking</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              Incident: {trackedUserLocation.incidentId} | Lat: {trackedUserLocation.lat.toFixed(5)} | Lng: {trackedUserLocation.lng.toFixed(5)}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 28 }}>
          {[
            { label: 'Active Tasks', value: activeTasks.length, icon: Clock, color: '#f97316' },
            { label: 'Completed', value: completedTasks.length, icon: CheckCircle, color: '#22c55e' },
            { label: 'Total Assigned', value: tasks.length, icon: AlertTriangle, color: '#3b82f6' },
          ].map(s => {
            const Icon = s.icon
            return (
              <div key={s.label} className="stat-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 500 }}>{s.label}</span>
                  <Icon size={16} color={s.color} />
                </div>
                <div style={{ fontSize: 32, fontWeight: 800, color: s.color }}>{s.value}</div>
              </div>
            )
          })}
        </div>

        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Active Tasks</h2>
          {activeTasks.length === 0 ? (
            <div className="glass" style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
              <AlertTriangle size={40} color="#374151" style={{ margin: '0 auto 12px' }} />
              <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No active tasks</p>
              <p style={{ fontSize: 13 }}>You will be notified when a task is assigned</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {activeTasks.map(task => (
                <div key={task._id} className="glass fade-in" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div style={{ background: `${STATUS_COLORS[task.status]}20`, borderRadius: 8, padding: '4px 10px', border: `1px solid ${STATUS_COLORS[task.status]}40` }}>
                        <span style={{ color: STATUS_COLORS[task.status], fontWeight: 700, fontSize: 12, textTransform: 'capitalize' }}>{task.status.replace('_', ' ')}</span>
                      </div>
                      <span className={`badge badge-${task.requestId?.urgency}`}>{task.requestId?.urgency}</span>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{timeAgo(task.createdAt)}</span>
                  </div>

                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, textTransform: 'capitalize' }}>{task.requestId?.type} Request</h3>
                  {task.requestId?.description && <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12, lineHeight: 1.5 }}>{task.requestId.description}</p>}

                  <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--color-text-muted)' }}>
                      <MapPin size={14} />{task.requestId?.location?.address || 'Location pinned on map'}
                    </div>
                    {task.requestId?.submittedBy && (
                      <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                        User: {task.requestId.submittedBy.name}
                        {task.requestId.submittedBy.phone && ` | Phone: ${task.requestId.submittedBy.phone}`}
                      </div>
                    )}
                  </div>

                  {task.status !== 'completed' && task.status !== 'cancelled' && (
                    <button
                      onClick={() => updateStatus(task._id, task.status)}
                      disabled={updating === task._id}
                      className="btn-primary"
                      style={{ background: STATUS_COLORS[task.status], display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      {task.status === 'en_route' ? <CheckCircle size={16} /> : <Truck size={16} />}
                      {updating === task._id ? 'Updating...' : STATUS_LABELS[task.status]}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
