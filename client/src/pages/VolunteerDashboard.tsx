import { useMemo, useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSocket } from '../hooks/useSocket'
import { useNavigate, Link } from 'react-router-dom'
import axios from 'axios'
import toast from 'react-hot-toast'
import {
  AlertTriangle,
  MapPin,
  Clock,
  CheckCircle,
  Truck,
  LogOut,
  ToggleLeft,
  ToggleRight,
  Navigation,
  ExternalLink,
} from 'lucide-react'
import { useLiveLocationTracking } from '../hooks/useLiveLocationTracking'
import { ThemeToggle } from '../components/ThemeToggle'
import { useSmoothedLocation } from '../hooks/useSmoothedLocation'
import { IncidentTrackingMap } from '../components/IncidentTrackingMap'
import { useGoogleMapsNavigation } from '../hooks/useGoogleMapsNavigation'
import { DispatchNotification, type DispatchPayload } from '../components/DispatchNotification'
import { timeAgo, formatExactDate } from '../utils/timeAgo'

interface Task {
  _id: string
  status: 'assigned' | 'accepted' | 'in_progress' | 'en_route' | 'completed' | 'cancelled'
  notes: string
  requestId: {
    _id: string
    type: string
    urgency: string
    description: string
    location: { coordinates: [number, number]; address: string }
    /** Road-snapped navigation destination (OSRM nearest).  May be undefined on old incidents. */
    routeLocation?: { coordinates: [number, number] }
    /** Metadata about the road snap — distance gap, road name */
    roadSnap?: { distanceMeters: number; roadName: string; snapped: boolean }
    submittedBy?: { name: string; phone: string }
  }
  createdAt: string
}

interface LatLng {
  lat: number
  lng: number
}

// ── Status flow & labels ──────────────────────────────────────────
const STATUS_FLOW = ['assigned', 'accepted', 'in_progress', 'completed']
const STATUS_LABELS: Record<string, string> = {
  assigned: 'Accept Task',
  accepted: 'Start Journey',        // ← opens Google Maps + sets in_progress
  in_progress: 'Mark Arrived & Complete',
  en_route: 'Mark Arrived & Complete',
  completed: 'Completed',
}
const STATUS_COLORS: Record<string, string> = {
  assigned: '#3b82f6',
  accepted: '#f97316',
  in_progress: '#a855f7',
  en_route: '#a855f7',
  completed: '#22c55e',
  cancelled: '#6b7280',
}



// Straight-line Haversine distance
const haversineKm = (a: LatLng, b: LatLng) => {
  const R = 6371
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinA =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(sinA), Math.sqrt(1 - sinA))
}

export default function VolunteerDashboard() {
  const { user, logout } = useAuth()
  const { socket, connected } = useSocket(user)
  const navigate = useNavigate()

  const normalizeTaskStatus = (status: Task['status']) =>
    status === 'en_route' ? 'in_progress' : status

  const [tasks, setTasks] = useState<Task[]>([])
  const [isAvailable, setIsAvailable] = useState(user?.isAvailable ?? true)
  const [updating, setUpdating] = useState<string | null>(null)

  // Incoming dispatch notifications from auto-dispatch system
  const [dispatchNotifications, setDispatchNotifications] = useState<DispatchPayload[]>([])

  // Live positions received via Socket.io
  const [trackedUserLocation, setTrackedUserLocation] = useState<{
    lat: number
    lng: number
    incidentId: string
  } | null>(null)
  const [trackedVolunteerLocation, setTrackedVolunteerLocation] = useState<LatLng | null>(null)

  /**
   * Journey snapshot — set ONCE when volunteer clicks "Start Journey".
   * The straight-line polyline is drawn from this snapshot and NEVER updated.
   * No ORS / routing API is called at any point.
   *
   * IMPORTANT: snapshot.to always uses sosLocation (stored SOS coords),
   * never the civilian's live device position. This prevents the destination
   * shifting when the civilian opens their dashboard from a different device.
   */
  const [journeySnapshot, setJourneySnapshot] = useState<{
    taskId: string
    from: LatLng   // volunteer position at journey start
    to: LatLng     // stored SOS location (static, never mutated by live tracking)
  } | null>(null)

  // Whether journey has been started for a given task
  const journeyStartedForRef = useRef<Record<string, boolean>>({})

  // ── Smoothed locations for display ──────────────────────────────
  const smoothUserLocation = useSmoothedLocation(
    trackedUserLocation ? { lat: trackedUserLocation.lat, lng: trackedUserLocation.lng } : null,
    2400
  )
  const smoothVolunteerLocation = useSmoothedLocation(trackedVolunteerLocation, 2000)

  // ── Active task helpers ─────────────────────────────────────────
  const activeIncidentId =
    tasks.find(t => t.status !== 'completed' && t.status !== 'cancelled')?.requestId?._id || null

  const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled')
  const completedTasks = tasks.filter(t => t.status === 'completed')

  const guidanceTask = useMemo(
    () => activeTasks.find(t => t.status === 'assigned' || t.status === 'in_progress' || t.status === 'accepted') || null,
    [activeTasks]
  )

  const volunteerLocation = useMemo(() => smoothVolunteerLocation || null, [smoothVolunteerLocation])

  /**
   * sosLocation — the ORIGINAL stored SOS coordinates from the incident document.
   * This is the source of truth for:
   *   - Google Maps navigation destination (never changes)
   *   - Journey snapshot polyline endpoint
   *   - "View victim on map" link
   *
   * It is NOT affected by useLiveLocationTracking or socket updates.
   */
  const sosLocation = useMemo<LatLng | null>(() => {
    const coords = guidanceTask?.requestId?.location?.coordinates
    if (Array.isArray(coords) && coords.length === 2 && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
      return { lat: coords[1], lng: coords[0] } // GeoJSON is [lng, lat]
    }
    return null
  }, [guidanceTask])

  /**
   * routeLocation — OSRM road-snapped destination for Google Maps navigation.
   * Computed server-side at SOS creation. Falls back to sosLocation when:
   *   a) Not yet computed (new incident, OSRM still running)
   *   b) distanceMeters === 0 (victim is already on/near a road)
   *   c) Older incidents without this field
   */
  const routeLocation = useMemo<LatLng | null>(() => {
    const rc = guidanceTask?.requestId?.routeLocation?.coordinates
    if (Array.isArray(rc) && rc.length === 2 && Number.isFinite(rc[0]) && Number.isFinite(rc[1])) {
      return { lat: rc[1], lng: rc[0] }
    }
    return sosLocation
  }, [guidanceTask, sosLocation])

  /** Metres between road-snap point and actual victim GPS (shown in guidance panel) */
  const roadToVictimMeters = guidanceTask?.requestId?.roadSnap?.distanceMeters ?? 0
  const nearestRoadName    = guidanceTask?.requestId?.roadSnap?.roadName ?? ''

  /**
   * victimLiveLocation — the civilian's live GPS position received via Socket.io.
   * Used ONLY for the moving marker on the mini-map so the volunteer can see
   * if the victim is moving. Does NOT affect navigation or Google Maps links.
   */
  const victimLiveLocation = useMemo<LatLng | null>(() => {
    if (trackedUserLocation) return { lat: trackedUserLocation.lat, lng: trackedUserLocation.lng }
    return sosLocation // fall back to stored coords so map always has a marker
  }, [trackedUserLocation, sosLocation])

  // Keep victimLocation as an alias for backward compat (map display only)
  const victimLocation = victimLiveLocation

  const showGuidance = Boolean(guidanceTask && volunteerLocation && sosLocation)

  const straightDistanceKm = useMemo(() => {
    if (!volunteerLocation || !sosLocation) return null
    return haversineKm(volunteerLocation, sosLocation).toFixed(2)
  }, [volunteerLocation, sosLocation])

  // ── Google Maps navigation ────────────────────────────────────────
  // Uses routeLocation (road-snapped) so Google Maps never fails with off-road coords
  const { openInGoogleMaps, canNavigate } = useGoogleMapsNavigation({
    from: volunteerLocation,
    to: routeLocation,     // ← road-snapped, falls back to sosLocation
  })

  // Polyline drawn ONCE at journey start — endpoint is sosLocation, never live
  const snapshotPolyline = useMemo<LatLng[]>(() => {
    if (!journeySnapshot) return []
    return [journeySnapshot.from, journeySnapshot.to]
  }, [journeySnapshot])

  // ── Data fetching ───────────────────────────────────────────────
  const fetchTasks = async () => {
    try {
      const { data } = await axios.get('/api/tasks/my-tasks')
      setTasks(
        (data.data || []).map((task: Task) => ({
          ...task,
          status: normalizeTaskStatus(task.status) as Task['status'],
        }))
      )
    } catch {
      toast.error('Failed to load tasks')
    }
  }

  useEffect(() => { fetchTasks() }, [])

  // ── Socket.io listeners ─────────────────────────────────────────
  useEffect(() => {
    if (!socket) return

    socket.on('task_assigned', (data: any) => {
      toast.success(`New task assigned: ${data.request?.type}`)
      if (data?.incidentId) socket.emit('join_incident_room', { incidentId: data.incidentId })
      fetchTasks()
    })

    socket.on('status_updated', ({ taskId, status }: any) => {
      setTasks(prev =>
        prev.map(t =>
          t._id === taskId
            ? { ...t, status: normalizeTaskStatus(status as Task['status']) as Task['status'] }
            : t
        )
      )
    })

    // Receive victim/user location update via Socket.io — just move marker, no route recalc
    socket.on('user_location_updated', (payload: any) => {
      if (!payload?.incidentId || !payload?.location) return
      if (activeIncidentId && payload.incidentId !== activeIncidentId) return
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

    // ── Auto-dispatch events ─────────────────────────────────────────
    socket.on('dispatch_request', (payload: DispatchPayload) => {
      // Deduplicate: don't show same request twice
      setDispatchNotifications(prev => {
        if (prev.some(n => n.requestId === payload.requestId)) return prev
        return [...prev, payload]
      })
    })

    socket.on('dispatch_already_assigned', ({ requestId }: { requestId: string }) => {
      // Remove the notification and show message
      setDispatchNotifications(prev => prev.filter(n => n.requestId !== requestId))
      toast.error('⚡ This task was already taken by another volunteer.', { duration: 4000 })
    })

    socket.on('dispatch_error', ({ message }: { message: string }) => {
      toast.error(`Assignment failed: ${message}`)
    })

    return () => {
      socket.off('task_assigned')
      socket.off('status_updated')
      socket.off('user_location_updated')
      socket.off('incident_assignment_signal')
      socket.off('dispatch_request')
      socket.off('dispatch_already_assigned')
      socket.off('dispatch_error')
    }
  }, [socket, activeIncidentId])

  useEffect(() => {
    if (!socket || !activeIncidentId) return
    socket.emit('join_incident_room', { incidentId: activeIncidentId })
  }, [socket, activeIncidentId])

  // ── Live location tracking (Socket.io only, no routing API) ────
  useLiveLocationTracking({
    socket,
    enabled: Boolean(socket && user && (isAvailable || activeIncidentId)),
    role: 'volunteer',
    incidentId: activeIncidentId,
    intervalMs: 4000,
    onLocationUpdate: setTrackedVolunteerLocation,
  })

  // ── Status update handler ───────────────────────────────────────
  /**
   * When status is `accepted`, clicking "Start Journey":
   *  1. Opens Google Maps for real turn-by-turn navigation
   *  2. Snapshots current positions for the mini-map polyline
   *  3. Advances task status to in_progress
   *
   * All other statuses follow the normal STATUS_FLOW.
   */
  const updateStatus = async (taskId: string, currentStatus: string) => {
    const idx = STATUS_FLOW.indexOf(currentStatus)
    if (idx === STATUS_FLOW.length - 1) return

    const isStartJourney = currentStatus === 'accepted'

    if (isStartJourney) {
      // Open Google Maps — always uses sosLocation as destination (stored SOS coords)
      if (canNavigate) {
        openInGoogleMaps()
      } else {
        toast.error('Your location is not yet available. Please allow location access and try again.')
        if (!volunteerLocation) return
      }

      // Snapshot once for visual polyline: destination = sosLocation (never live position)
      if (volunteerLocation && sosLocation && !journeyStartedForRef.current[taskId]) {
        setJourneySnapshot({ taskId, from: volunteerLocation, to: sosLocation })
        journeyStartedForRef.current[taskId] = true
      }
    }

    const nextStatus = STATUS_FLOW[idx + 1]
    setUpdating(taskId)
    try {
      await axios.patch(`/api/tasks/${taskId}/status`, { status: nextStatus })
      setTasks(prev =>
        prev.map(t => (t._id === taskId ? { ...t, status: nextStatus as Task['status'] } : t))
      )
      toast.success(
        nextStatus === 'completed'
          ? '✅ Task completed!'
          : isStartJourney
          ? '🗺️ Journey started — follow Google Maps for navigation'
          : `Status updated to ${nextStatus}`
      )
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Update failed')
    } finally {
      setUpdating(null)
    }
  }

  const handleAcceptDispatch = (requestId: string) => {
    if (!socket) { toast.error('Not connected'); return }
    socket.emit('volunteer_accept_dispatch', { requestId })
    // Notification auto-removes on task_assigned event which refetches tasks
    setDispatchNotifications(prev => prev.filter(n => n.requestId !== requestId))
    toast.loading('Claiming task…', { id: `accept-${requestId}`, duration: 5000 })
  }

  const handleRejectDispatch = (requestId: string) => {
    if (socket) socket.emit('volunteer_reject_dispatch', { requestId })
    setDispatchNotifications(prev => prev.filter(n => n.requestId !== requestId))
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

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--color-bg)', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{ width: 220, background: 'var(--color-surface)', borderRight: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--glass-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div style={{ background: '#22c55e', borderRadius: 8, padding: 6 }}>
              <AlertTriangle size={16} color="white" />
            </div>
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
              width: '100%', padding: '10px 14px', borderRadius: 8,
              display: 'flex', alignItems: 'center', gap: 8,
              background: isAvailable ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.15)',
              border: `1px solid ${isAvailable ? 'rgba(34,197,94,0.4)' : 'rgba(107,114,128,0.4)'}`,
              color: isAvailable ? '#4ade80' : '#9ca3af', cursor: 'pointer', fontWeight: 600, fontSize: 13,
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
            <span className="conn-dot" style={{ background: connected ? '#22c55e' : '#ef4444' }} />
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{connected ? 'Live' : 'Offline'}</span>
          </div>
          <button onClick={() => { logout(); navigate('/') }} className="nav-link" style={{ color: '#ef4444', width: '100%', background: 'none', border: 'none', textAlign: 'left' }}>
            <LogOut size={16} />Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

        {/* ── Dispatch Notifications panel ── */}
        {dispatchNotifications.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
              fontSize: 13, fontWeight: 800, letterSpacing: '-0.2px',
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: '#ef4444',
                boxShadow: '0 0 8px #ef4444',
                display: 'inline-block',
                animation: 'ping 1s cubic-bezier(0,0,0.2,1) infinite',
              }} />
              Emergency Requests Nearby
              <span style={{
                padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
                color: '#f87171',
              }}>
                {dispatchNotifications.length}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {dispatchNotifications.map(n => (
                <DispatchNotification
                  key={n.requestId}
                  notification={n}
                  onAccept={handleAcceptDispatch}
                  onReject={handleRejectDispatch}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Live Rescue Guidance panel ── */}
        {showGuidance && guidanceTask && volunteerLocation && victimLocation && (
          <div className="glass" style={{ padding: 16, marginBottom: 16, border: '1px solid rgba(59,130,246,0.35)' }}>
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>🚨 Live Rescue Guidance</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Incident #{String(guidanceTask.requestId._id).slice(-6).toUpperCase()}
                </div>
              </div>

              {/* Status badge */}
              {journeySnapshot?.taskId === guidanceTask._id && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20, background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 6px #a855f7', display: 'block' }} />
                  <span style={{ fontSize: 12, color: '#c084fc', fontWeight: 700 }}>On the way 🚗</span>
                </div>
              )}
            </div>

            {/* Stats row */}
            <div style={{ display: 'flex', gap: 20, marginBottom: 12, fontSize: 12, color: 'var(--color-text-muted)', flexWrap: 'wrap' }}>
              <span>📍 Distance to SOS: <strong style={{ color: 'var(--color-text)' }}>{straightDistanceKm} km</strong></span>
              {sosLocation && <span>🎯 SOS coords: {sosLocation.lat.toFixed(5)}, {sosLocation.lng.toFixed(5)}</span>}
              {victimLocation && trackedUserLocation && (
                <span style={{ color: '#fbbf24' }}>
                  ⚡ Victim live: {victimLocation.lat.toFixed(5)}, {victimLocation.lng.toFixed(5)}
                </span>
              )}
            </div>

            {/* Road-snap info banner — shown only if victim is not on a road */}
            {roadToVictimMeters > 20 && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '10px 14px', borderRadius: 10, marginBottom: 12,
                background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.35)',
              }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>🚑</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#fb923c', marginBottom: 2 }}>
                    Drive to nearest accessible point, then proceed on foot
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    Distance from road to victim: <strong style={{ color: '#fdba74' }}>~{roadToVictimMeters} m</strong>
                    {nearestRoadName && <span> · Road: <em>{nearestRoadName}</em></span>}
                  </div>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  if (!canNavigate) {
                    toast.error('Location unavailable. Allow location access and try again.')
                    return
                  }
                  // Snapshot once: destination is routeLocation (road-snapped) so the
                  // polyline endpoint is the road point, not a field/building
                  if (volunteerLocation && routeLocation && !journeyStartedForRef.current[guidanceTask._id]) {
                    setJourneySnapshot({ taskId: guidanceTask._id, from: volunteerLocation, to: routeLocation })
                    journeyStartedForRef.current[guidanceTask._id] = true
                  }
                  openInGoogleMaps()
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #1a73e8, #1557b0)',
                  color: 'white', fontWeight: 700, fontSize: 13,
                  boxShadow: '0 2px 12px rgba(26,115,232,0.4)',
                }}
              >
                <Navigation size={14} />
                Open in Google Maps
                {roadToVictimMeters > 20 && (
                  <span style={{ fontSize: 10, opacity: 0.75, marginLeft: 2 }}>(road point)</span>
                )}
              </button>

              {/* View on map always uses stored SOS location — not live device position */}
              {sosLocation && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${sosLocation.lat},${sosLocation.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 14px', borderRadius: 8,
                    border: '1px solid var(--glass-border)',
                    background: 'var(--glass-bg)', color: 'var(--color-text)',
                    fontSize: 12, textDecoration: 'none', fontWeight: 500,
                  }}
                >
                  <ExternalLink size={13} />
                  View SOS location
                </a>
              )}
            </div>

            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10 }}>
              ℹ️ Google Maps handles navigation. The line below is a visual reference only — no routing API is used.
            </div>

            {/* Mini tracking map — 3 markers + dual-path lines */}
            {/* 🔴 SOS location (victim actual) */}
            {/* 🟡 Road-snapped navigation endpoint */}
            {/* 🟢 Volunteer live position */}
            <IncidentTrackingMap
              center={sosLocation || volunteerLocation}
              primaryMarker={
                sosLocation
                  ? { lat: sosLocation.lat, lng: sosLocation.lng, label: '🆘 SOS Location', color: '#ef4444' }
                  : null
              }
              routeMarker={
                routeLocation && routeLocation !== sosLocation && roadToVictimMeters > 20
                  ? { lat: routeLocation.lat, lng: routeLocation.lng, label: '🛣️ Drive to here', color: '#f59e0b' }
                  : null
              }
              secondaryMarker={
                volunteerLocation
                  ? { lat: volunteerLocation.lat, lng: volunteerLocation.lng, label: '🚗 You (volunteer)', color: '#22c55e' }
                  : null
              }
              guidePath={
                !(routeLocation && routeLocation !== sosLocation && roadToVictimMeters > 20) &&
                snapshotPolyline.length >= 2
                  ? snapshotPolyline
                  : undefined
              }
              highlightPrimary
              height={240}
            />
          </div>
        )}

        {/* ── Stat cards ── */}
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

        {/* ── Active tasks list ── */}
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
                        <span style={{ color: STATUS_COLORS[task.status], fontWeight: 700, fontSize: 12, textTransform: 'capitalize' }}>
                          {task.status.replace('_', ' ')}
                        </span>
                      </div>
                      <span className={`badge badge-${task.requestId?.urgency}`}>{task.requestId?.urgency}</span>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }} title={formatExactDate(task.createdAt)}>{timeAgo(task.createdAt)}</span>
                  </div>

                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, textTransform: 'capitalize' }}>
                    {task.requestId?.type} Request
                  </h3>
                  {task.requestId?.description && (
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
                      {task.requestId.description}
                    </p>
                  )}

                  <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--color-text-muted)' }}>
                      <MapPin size={14} />
                      {task.requestId?.location?.address || 'Location pinned on map'}
                    </div>
                    {task.requestId?.submittedBy && (
                      <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                        User: {task.requestId.submittedBy.name}
                        {task.requestId.submittedBy.phone && ` | Phone: ${task.requestId.submittedBy.phone}`}
                      </div>
                    )}
                  </div>

                  {task.status !== 'completed' && task.status !== 'cancelled' && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        onClick={() => updateStatus(task._id, task.status)}
                        disabled={updating === task._id}
                        className="btn-primary"
                        style={{
                          background: STATUS_COLORS[task.status],
                          display: 'flex', alignItems: 'center', gap: 8,
                        }}
                      >
                        {task.status === 'in_progress' || task.status === 'en_route'
                          ? <CheckCircle size={16} />
                          : task.status === 'accepted'
                          ? <Navigation size={16} />
                          : <Truck size={16} />}
                        {updating === task._id ? 'Updating...' : STATUS_LABELS[task.status]}
                      </button>

                      {/* Google Maps link uses sosLocation (stored SOS coords) as destination */}
                      {(task.status === 'accepted' || task.status === 'in_progress') && sosLocation && (
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&origin=${volunteerLocation?.lat ?? ''},${volunteerLocation?.lng ?? ''}&destination=${sosLocation.lat},${sosLocation.lng}&travelmode=driving`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '8px 14px', borderRadius: 8,
                            border: '1px solid rgba(26,115,232,0.4)',
                            background: 'rgba(26,115,232,0.1)',
                            color: '#60a5fa', fontSize: 12, textDecoration: 'none', fontWeight: 600,
                          }}
                        >
                          <ExternalLink size={13} />
                          Google Maps
                        </a>
                      )}
                    </div>
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
