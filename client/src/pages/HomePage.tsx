import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Globe from 'react-globe.gl'
import * as THREE from 'three'
import {
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { ThemeToggle } from '../components/ThemeToggle'
import { useSocket } from '../hooks/useSocket'
import axios from 'axios'
import toast from 'react-hot-toast'
import {
  AlertTriangle,
  Clock,
  Filter,
  LayoutDashboard,
  LogIn,
  MapPin,
  UserPlus,
  X,
} from 'lucide-react'

interface IncidentData {
  _id: string
  entityType?: 'incident'
  type: string
  urgency: 'critical' | 'high' | 'medium' | 'low' | string
  description: string
  status: string
  location: { coordinates: [number, number]; address: string }
  submittedBy?: { name: string; phone: string }
  createdAt: string
  numberOfPeople?: number
}

interface ActorData {
  _id: string
  name: string
  role: 'admin' | 'volunteer' | 'user' | string
  isAvailable?: boolean
  trackingStatus?: 'offline' | 'available' | 'assigned' | string
  assignedIncidentId?: string | null
  locationUpdatedAt?: string | null
  location?: { coordinates?: [number, number] }
}

interface GlobePoint {
  lat: number
  lng: number
  size: number
  color: string
  request: IncidentData
}

const URGENCY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
}

const TYPE_LABELS: Record<string, string> = {
  food: 'Food',
  water: 'Water',
  medical: 'Medical',
  rescue: 'Rescue',
  shelter: 'Shelter',
}

const EARTH_TEXTURE = 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg'
const BACKGROUND_STARS = 'https://unpkg.com/three-globe/example/img/night-sky.png'
const INDIA_CENTER: [number, number] = [20.5937, 78.9629]
const MAP_TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const MAP_TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'

const timeAgo = (date: string) => {
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 60000)
  if (diff < 1) return 'Just now'
  if (diff < 60) return `${diff}m ago`
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`
  return `${Math.floor(diff / 1440)}d ago`
}

const getPointSize = (urgency: string) => {
  if (urgency === 'critical') return 0.55
  if (urgency === 'high') return 0.42
  if (urgency === 'medium') return 0.34
  return 0.28
}

const getLatLng = (coords?: [number, number]) => {
  if (!coords || coords.length !== 2) return null
  const [lng, lat] = coords
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat === 0 && lng === 0) return null
  return [lat, lng] as [number, number]
}

const FlyToSelection = ({ target }: { target: [number, number] | null }) => {
  const map = useMap()

  useEffect(() => {
    if (!target) return
    map.flyTo(target, Math.max(map.getZoom(), 6), { duration: 0.8 })
  }, [map, target])

  return null
}

export default function HomePage() {
  const { user, logout } = useAuth()
  const { theme } = useTheme()
  const navigate = useNavigate()
  const { socket, connected } = useSocket(user)

  const globeRef = useRef<any>(null)
  const globeViewportRef = useRef<HTMLDivElement | null>(null)

  const [requests, setRequests] = useState<IncidentData[]>([])
  const [actors, setActors] = useState<ActorData[]>([])
  const [filterUrgency, setFilterUrgency] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [showFilters, setShowFilters] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [viewMode, setViewMode] = useState<'globe' | 'map'>('globe')
  const [globeSize, setGlobeSize] = useState({ width: 1200, height: 700 })
  const [selectedRequest, setSelectedRequest] = useState<IncidentData | null>(null)

  const normalizeIncident = useCallback((raw: any): IncidentData | null => {
    if (!raw) return null
    const incidentId = raw._id || raw.requestId
    if (!incidentId) return null

    return {
      _id: String(incidentId),
      entityType: 'incident',
      type: String(raw.type || 'rescue'),
      urgency: String(raw.urgency || 'medium'),
      description: String(raw.description || ''),
      status: String(raw.status || 'pending'),
      location: raw.location || { coordinates: [0, 0], address: '' },
      submittedBy: raw.submittedBy,
      createdAt: raw.createdAt || new Date().toISOString(),
      numberOfPeople: typeof raw.numberOfPeople === 'number' ? raw.numberOfPeople : undefined,
    }
  }, [])

  const upsertIncident = useCallback((prev: IncidentData[], next: IncidentData) => {
    const existingIdx = prev.findIndex(item => item._id === next._id)
    if (existingIdx === -1) return [next, ...prev]

    const merged = [...prev]
    merged[existingIdx] = { ...merged[existingIdx], ...next }
    return merged
  }, [])

  useEffect(() => {
    if (!globeViewportRef.current) return

    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      setGlobeSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })

    observer.observe(globeViewportRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!globeRef.current || viewMode !== 'globe') return

    const controls = globeRef.current.controls()
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.45
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 130
    controls.maxDistance = 420
    globeRef.current.pointOfView({ lat: 22, lng: 78, altitude: 2.2 }, 900)

    const scene = globeRef.current.scene() as THREE.Scene
    const existingCustomLights = scene.children.filter((child: THREE.Object3D) => child.userData && child.userData.customGlobeLight)
    existingCustomLights.forEach((light: THREE.Object3D) => scene.remove(light))

    const ambientLight = new THREE.AmbientLight(theme === 'dark' ? 0xffffff : 0xf8fbff, theme === 'dark' ? 0.72 : 0.82)
    ambientLight.userData.customGlobeLight = true

    const keyLight = new THREE.DirectionalLight(0xffffff, theme === 'dark' ? 0.95 : 1.05)
    keyLight.position.set(180, 140, 220)
    keyLight.userData.customGlobeLight = true

    const fillLight = new THREE.DirectionalLight(0x9ec8ff, theme === 'dark' ? 0.48 : 0.4)
    fillLight.position.set(-150, -100, -180)
    fillLight.userData.customGlobeLight = true

    scene.add(ambientLight)
    scene.add(keyLight)
    scene.add(fillLight)
  }, [theme, viewMode])

  const fetchRequests = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/requests?limit=300')
      const incidents = (data.data || [])
        .map((item: any) => normalizeIncident(item))
        .filter(Boolean) as IncidentData[]
      setRequests(incidents)
    } catch {
      // guest view
    }
  }, [normalizeIncident])

  const fetchActors = useCallback(async () => {
    if (!user || user.role !== 'admin') {
      setActors([])
      return
    }

    try {
      const { data } = await axios.get('/api/users')
      setActors(data.data || [])
    } catch {
      setActors([])
    }
  }, [user])

  useEffect(() => {
    if (user) {
      fetchRequests()
      fetchActors()
    }
  }, [user, fetchRequests, fetchActors])

  useEffect(() => {
    if (!socket) return

    const handleNewRequest = (req: any) => {
      const incident = normalizeIncident(req)
      if (!incident) return

      setRequests(prev => upsertIncident(prev, incident))
      toast(`New incident: ${incident.type} (${incident.urgency})`, { duration: 4500 })
    }

    const handleStatusUpdate = ({ requestId, status }: { requestId: string; status: string }) => {
      setRequests(prev => prev.map(r => (r._id === requestId ? { ...r, status } : r)))
      setSelectedRequest(prev => (prev && prev._id === requestId ? { ...prev, status } : prev))
    }

    const handleVolunteerUpdate = (payload?: {
      volunteerId?: string
      available?: boolean
      trackingStatus?: string
      incidentId?: string | null
      location?: { lat: number; lng: number } | null
      locationUpdatedAt?: string | null
    }) => {
      if (!payload?.volunteerId) {
        fetchActors()
        return
      }

      setActors(prev =>
        prev.map(actor => {
          if (actor._id !== payload.volunteerId) return actor

          return {
            ...actor,
            isAvailable: typeof payload.available === 'boolean' ? payload.available : actor.isAvailable,
            trackingStatus: payload.trackingStatus || actor.trackingStatus,
            assignedIncidentId: payload.incidentId || null,
            locationUpdatedAt: payload.locationUpdatedAt || actor.locationUpdatedAt || null,
            location:
              payload.location && Number.isFinite(payload.location.lat) && Number.isFinite(payload.location.lng)
                ? {
                    ...(actor.location || {}),
                    coordinates: [payload.location.lng, payload.location.lat] as [number, number],
                  }
                : actor.location,
          }
        })
      )
    }

    const handleVolunteerLocationUpdated = (payload: {
      volunteerId: string
      location?: { lat: number; lng: number }
      status?: string
      incidentId?: string | null
      timestamp?: string
    }) => {
      if (!payload?.volunteerId || !payload.location) return
      const location = payload.location
      setActors(prev =>
        prev.map(actor =>
          actor._id === payload.volunteerId
            ? {
                ...actor,
                isAvailable: payload.status ? payload.status === 'available' : actor.isAvailable,
                trackingStatus: payload.status || actor.trackingStatus,
                assignedIncidentId: payload.incidentId || null,
                locationUpdatedAt: payload.timestamp || actor.locationUpdatedAt,
                location: {
                  ...(actor.location || {}),
                  coordinates: [location.lng, location.lat] as [number, number],
                },
              }
            : actor
        )
      )
    }

    socket.on('new_request', handleNewRequest)
    socket.on('request_status_updated', handleStatusUpdate)
    socket.on('volunteer_status_update', handleVolunteerUpdate)
    socket.on('volunteer_location_updated', handleVolunteerLocationUpdated)
    socket.on('volunteer_assignment_updated', handleVolunteerUpdate)
    socket.on('incident_assignment_updated', handleVolunteerUpdate)

    return () => {
      socket.off('new_request', handleNewRequest)
      socket.off('request_status_updated', handleStatusUpdate)
      socket.off('volunteer_status_update', handleVolunteerUpdate)
      socket.off('volunteer_location_updated', handleVolunteerLocationUpdated)
      socket.off('volunteer_assignment_updated', handleVolunteerUpdate)
      socket.off('incident_assignment_updated', handleVolunteerUpdate)
    }
  }, [socket, fetchActors, normalizeIncident, upsertIncident])

  const getDashboardLink = () => {
    if (!user) return '/login'
    if (user.role === 'admin') return '/admin'
    if (user.role === 'volunteer') return '/volunteer'
    return '/my-requests'
  }

  const filteredRequests = useMemo(
    () =>
      requests.filter(r => {
        // Never show resolved or cancelled incidents on the public map
        if (r.status === 'resolved' || r.status === 'cancelled') return false
        if (filterUrgency !== 'all' && r.urgency !== filterUrgency) return false
        if (filterType !== 'all' && r.type !== filterType) return false
        return true
      }),
    [requests, filterUrgency, filterType]
  )

  const globePoints = useMemo<GlobePoint[]>(
    () =>
      filteredRequests
        .map(r => {
          const latLng = getLatLng(r.location?.coordinates)
          if (!latLng) return null
          return {
            lat: latLng[0],
            lng: latLng[1],
            size: getPointSize(r.urgency),
            color: URGENCY_COLORS[r.urgency] || '#60a5fa',
            request: r,
          }
        })
        .filter(Boolean) as GlobePoint[],
    [filteredRequests]
  )

  const volunteerMarkers = useMemo(
    () =>
      actors
        .filter(actor => actor.role === 'volunteer')
        .map(actor => ({ actor, latLng: getLatLng(actor.location?.coordinates) }))
        .filter(item => item.latLng) as { actor: ActorData; latLng: [number, number] }[],
    [actors]
  )

  const volunteerIcon = useMemo(
    () =>
      L.divIcon({
        className: 'volunteer-marker-icon',
        html: '<span class="volunteer-marker-glyph">&#128100;</span>',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      }),
    []
  )

  const selectedLatLng = selectedRequest ? getLatLng(selectedRequest.location?.coordinates) : null
  const criticalCount = requests.filter(r => r.urgency === 'critical' && r.status === 'pending').length

  const panelBg = theme === 'dark' ? 'rgba(10,15,30,0.82)' : 'rgba(255,255,255,0.84)'
  const panelBorder = theme === 'dark' ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(15,23,42,0.2)'
  const panelText = theme === 'dark' ? '#f3f4f6' : '#111827'
  const panelMuted = theme === 'dark' ? '#9ca3af' : '#334155'
  const activeToggleBg = theme === 'dark' ? '#1d4ed8' : '#2563eb'
  const activeToggleText = '#ffffff'
  const inactiveToggleBg = theme === 'dark' ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.08)'
  const inactiveToggleText = theme === 'dark' ? '#dbeafe' : '#1e293b'

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 20px',
          background: theme === 'dark' ? 'rgba(10,15,30,0.96)' : 'rgba(255,255,255,0.92)',
          borderBottom: '1px solid var(--glass-border)',
          backdropFilter: 'blur(20px)',
          zIndex: 1001,
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ background: 'linear-gradient(135deg,#ef4444,#b91c1c)', borderRadius: 10, padding: '7px 8px', display: 'flex' }}>
            <AlertTriangle size={18} color="white" />
          </div>
          <div>
            <span style={{ fontWeight: 900, fontSize: 18, letterSpacing: '-0.5px', color: panelText }}>DisasterLink</span>
            <span style={{ color: panelMuted, fontSize: 11, display: 'block', lineHeight: 1, marginTop: 1 }}>Global Relief Command</span>
          </div>
          {criticalCount > 0 && (
            <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 20, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', display: 'block' }}></span>
              <span style={{ fontSize: 12, color: '#f87171', fontWeight: 700 }}>{criticalCount} Critical</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ThemeToggle compact />
          {user ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', background: 'var(--glass-bg)', borderRadius: 20, border: '1px solid var(--glass-border)' }}>
                <span className="conn-dot" style={{ background: connected ? '#22c55e' : '#ef4444', boxShadow: connected ? '0 0 6px #22c55e' : 'none' }}></span>
                <span style={{ fontSize: 12, color: panelMuted }}>{connected ? 'Live' : 'Offline'}</span>
              </div>
              <span style={{ fontSize: 13, color: panelMuted }}>
                Hi, <strong style={{ color: panelText }}>{user.name.split(' ')[0]}</strong>
              </span>
              <Link to={getDashboardLink()} className="btn-primary" style={{ textDecoration: 'none', padding: '7px 14px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
                <LayoutDashboard size={13} />Dashboard
              </Link>
              <button onClick={logout} className="btn-secondary" style={{ padding: '7px 12px', fontSize: 13 }}>
                Logout
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn-secondary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', fontSize: 13 }}>
                <LogIn size={13} />Login
              </Link>
              <Link to="/register" className="btn-primary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', fontSize: 13 }}>
                <UserPlus size={13} />Register
              </Link>
            </>
          )}
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        <div style={{ flex: 1, position: 'relative', padding: 14 }}>
          <div
            style={{
              position: 'relative',
              height: '100%',
              borderRadius: 18,
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 18px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)',
              background: theme === 'dark' ? '#050816' : '#dbeafe',
            }}
          >
            <div ref={globeViewportRef} style={{ width: '100%', height: '100%' }}>
              {viewMode === 'globe' && globeSize.width > 0 && globeSize.height > 0 && (
                <Globe
                  ref={globeRef}
                  width={globeSize.width}
                  height={globeSize.height}
                  globeImageUrl={EARTH_TEXTURE}
                  backgroundImageUrl={theme === 'dark' ? BACKGROUND_STARS : undefined}
                  backgroundColor={theme === 'dark' ? '#050816' : '#dbeafe'}
                  showAtmosphere
                  atmosphereColor={theme === 'dark' ? '#60a5fa' : '#1d4ed8'}
                  atmosphereAltitude={0.22}
                  pointsData={globePoints}
                  pointLat={(d: object) => (d as GlobePoint).lat}
                  pointLng={(d: object) => (d as GlobePoint).lng}
                  pointAltitude={(d: object) => (d as GlobePoint).size}
                  pointRadius={(d: object) => (d as GlobePoint).size}
                  pointColor={(d: object) => (d as GlobePoint).color}
                  pointsMerge={false}
                  pointLabel={(d: object) => {
                    const item = (d as GlobePoint).request
                    const label = TYPE_LABELS[item.type] || item.type
                    return `
                      <div style="padding:8px 10px;background:#0f172a;color:#f8fafc;border-radius:8px;border:1px solid rgba(255,255,255,0.2)">
                        <div style="font-weight:700;text-transform:capitalize;margin-bottom:4px">${label} - ${item.urgency}</div>
                        <div style="font-size:12px;opacity:.9">${item.location.address || 'Coordinates only'}</div>
                        <div style="font-size:11px;opacity:.75;margin-top:4px">${item.status.replace('_', ' ')} | ${timeAgo(item.createdAt)}</div>
                      </div>
                    `
                  }}
                  onPointClick={(d: object) => {
                    const req = (d as GlobePoint).request
                    setSelectedRequest(req)
                    globeRef.current?.pointOfView({ lat: (d as GlobePoint).lat, lng: (d as GlobePoint).lng, altitude: 1.8 }, 700)
                    setViewMode('map')
                  }}
                />
              )}

              {viewMode === 'map' && (
                <MapContainer center={selectedLatLng || INDIA_CENTER} zoom={selectedLatLng ? 6 : 4} minZoom={3} maxZoom={18} zoomControl={false} worldCopyJump style={{ width: '100%', height: '100%' }}>
                  <TileLayer
                    key={`tiles-${theme}`}
                    url={theme === 'dark' ? MAP_TILE_DARK : MAP_TILE_LIGHT}
                    attribution="&copy; OpenStreetMap &copy; CARTO"
                    noWrap={false}
                  />
                  <ZoomControl position="bottomright" />
                  <FlyToSelection target={selectedLatLng} />

                  {filteredRequests.map(req => {
                    const latLng = getLatLng(req.location?.coordinates)
                    if (!latLng) return null
                    const color = URGENCY_COLORS[req.urgency] || '#60a5fa'
                    const isCritical = req.urgency === 'critical'
                    return (
                      <CircleMarker
                        key={req._id}
                        center={latLng}
                        radius={isCritical ? 11 : 8}
                        pathOptions={{ color, fillColor: color, fillOpacity: 0.8, weight: isCritical ? 3 : 2, className: isCritical ? 'incident-circle incident-pulse' : 'incident-circle' }}
                        eventHandlers={{ click: () => setSelectedRequest(req) }}
                      >
                        <Tooltip>{`${TYPE_LABELS[req.type] || req.type} | ${req.urgency.toUpperCase()} | ${req.status.replace('_', ' ')}`}</Tooltip>
                        <Popup>
                          <div>
                            <div style={{ fontWeight: 700, textTransform: 'capitalize' }}>{TYPE_LABELS[req.type] || req.type}</div>
                            <div style={{ fontSize: 12, marginTop: 4 }}>{req.location.address || 'Coordinates only'}</div>
                            <div style={{ fontSize: 12, marginTop: 2 }}>{req.status.replace('_', ' ')}</div>
                          </div>
                        </Popup>
                      </CircleMarker>
                    )
                  })}

                  {volunteerMarkers.map(({ actor, latLng }) => (
                    <Marker
                      key={`vol-${actor._id}`}
                      position={latLng}
                      icon={volunteerIcon}
                    >
                      <Tooltip>{`Volunteer: ${actor.name} (${actor.trackingStatus || 'offline'})`}</Tooltip>
                    </Marker>
                  ))}

                </MapContainer>
              )}
            </div>

            <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 500, display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ background: panelBg, border: panelBorder, borderRadius: 10, padding: '8px 12px', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 8px #ef4444', display: 'block' }}></span>
                <span style={{ fontSize: 13, fontWeight: 700, color: panelText }}>{filteredRequests.length} Active Incidents</span>
              </div>

              <div style={{ background: panelBg, border: panelBorder, borderRadius: 10, padding: 4, backdropFilter: 'blur(14px)', display: 'flex', gap: 4 }}>
                <button
                  onClick={() => setViewMode('globe')}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: viewMode === 'globe' ? '1px solid rgba(255,255,255,0.25)' : '1px solid transparent',
                    cursor: 'pointer',
                    background: viewMode === 'globe' ? activeToggleBg : inactiveToggleBg,
                    color: viewMode === 'globe' ? activeToggleText : inactiveToggleText,
                    boxShadow: viewMode === 'globe' ? '0 6px 16px rgba(37,99,235,0.35)' : 'none',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  Globe View
                </button>
                <button
                  onClick={() => setViewMode('map')}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: viewMode === 'map' ? '1px solid rgba(255,255,255,0.25)' : '1px solid transparent',
                    cursor: 'pointer',
                    background: viewMode === 'map' ? activeToggleBg : inactiveToggleBg,
                    color: viewMode === 'map' ? activeToggleText : inactiveToggleText,
                    boxShadow: viewMode === 'map' ? '0 6px 16px rgba(37,99,235,0.35)' : 'none',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  Map View
                </button>
              </div>

              <button onClick={() => setShowFilters(p => !p)} style={{ background: panelBg, border: panelBorder, borderRadius: 10, padding: '8px 12px', backdropFilter: 'blur(14px)', cursor: 'pointer', color: showFilters ? '#60a5fa' : panelText, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500 }}>
                <Filter size={14} />Filters
              </button>
            </div>

            {showFilters && (
              <div style={{ position: 'absolute', top: 60, left: 12, zIndex: 500, background: panelBg, border: panelBorder, borderRadius: 10, padding: 10, backdropFilter: 'blur(12px)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <select value={filterUrgency} onChange={e => setFilterUrgency(e.target.value)} className="input-field" style={{ width: 'auto', fontSize: 12, padding: '6px 10px' }}>
                  <option value="all">All urgency</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>

                <select value={filterType} onChange={e => setFilterType(e.target.value)} className="input-field" style={{ width: 'auto', fontSize: 12, padding: '6px 10px' }}>
                  <option value="all">All types</option>
                  <option value="rescue">Rescue</option>
                  <option value="medical">Medical</option>
                  <option value="food">Food</option>
                  <option value="water">Water</option>
                  <option value="shelter">Shelter</option>
                </select>

                {(filterUrgency !== 'all' || filterType !== 'all') && (
                  <button onClick={() => { setFilterUrgency('all'); setFilterType('all') }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 3 }}>
                    <X size={13} />Clear
                  </button>
                )}
              </div>
            )}

            <div style={{ position: 'absolute', bottom: 16, left: 12, zIndex: 500, background: panelBg, border: panelBorder, borderRadius: 10, padding: '10px 12px', backdropFilter: 'blur(14px)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: panelMuted, letterSpacing: 1, marginBottom: 7, textTransform: 'uppercase' }}>Urgency</div>
              {Object.entries(URGENCY_COLORS).map(([level, color]) => (
                <div key={level} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}88`, display: 'block' }}></span>
                  <span style={{ fontSize: 12, textTransform: 'capitalize', color: panelText }}>{level}</span>
                </div>
              ))}
              {user?.role === 'admin' && (
                <>
                  <div style={{ marginTop: 8, fontSize: 11, color: panelMuted, fontWeight: 700, textTransform: 'uppercase' }}>Actors</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4 }}>
                    <span className="volunteer-marker-icon" style={{ width: 18, height: 18, minWidth: 18 }}>
                      <span className="volunteer-marker-glyph" style={{ fontSize: 11 }}>&#128100;</span>
                    </span>
                    <span style={{ fontSize: 12, color: panelText }}>Volunteers</span>
                  </div>
                </>
              )}
            </div>

            {selectedRequest && (
              <div style={{ position: 'absolute', right: 12, bottom: 16, zIndex: 520, width: 300, background: panelBg, border: panelBorder, borderRadius: 12, backdropFilter: 'blur(14px)', boxShadow: '0 12px 24px rgba(0,0,0,0.3)', padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: panelText, textTransform: 'capitalize' }}>
                    {TYPE_LABELS[selectedRequest.type] || selectedRequest.type} incident
                  </div>
                  <button onClick={() => setSelectedRequest(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: panelMuted }}>
                    <X size={14} />
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, marginBottom: 8 }}>
                  <span className={`badge badge-${selectedRequest.urgency}`}>{selectedRequest.urgency}</span>
                  <span className={`badge badge-${selectedRequest.status}`}>{selectedRequest.status.replace('_', ' ')}</span>
                </div>
                {selectedRequest.description && <p style={{ color: panelMuted, fontSize: 12, lineHeight: 1.5, marginBottom: 8 }}>{selectedRequest.description}</p>}
                <div style={{ fontSize: 12, color: panelMuted, display: 'flex', gap: 5, alignItems: 'center' }}>
                  <MapPin size={12} />{selectedRequest.location.address || 'Coordinates only'}
                </div>
                <div style={{ fontSize: 11, color: panelMuted, marginTop: 6 }}>{timeAgo(selectedRequest.createdAt)}</div>
              </div>
            )}

            {!user && (
              <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 500, background: panelBg, border: panelBorder, borderRadius: 12, padding: '12px 16px', textAlign: 'center', backdropFilter: 'blur(14px)', minWidth: 320 }}>
                <p style={{ fontSize: 13, color: panelMuted, marginBottom: 10 }}>
                  Global disaster monitoring in real-time
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <Link to="/register?role=user" className="btn-primary" style={{ textDecoration: 'none', padding: '7px 14px', fontSize: 12 }}>Need Help?</Link>
                  <Link to="/register?role=volunteer" className="btn-secondary" style={{ textDecoration: 'none', padding: '7px 14px', fontSize: 12 }}>Volunteer</Link>
                  <Link to="/login" className="btn-secondary" style={{ textDecoration: 'none', padding: '7px 14px', fontSize: 12 }}>Login</Link>
                </div>
              </div>
            )}
          </div>
        </div>

        {user && sidebarOpen && (
          <div style={{ width: 300, background: 'var(--color-surface)', borderLeft: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div>
                <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Active Incidents</h2>
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{filteredRequests.length} active (resolved hidden)</p>
              </div>
              <button onClick={() => setSidebarOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredRequests.length === 0 ? (
                <div style={{ padding: 28, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                  No active incidents
                </div>
              ) : (
                filteredRequests.map(req => (
                  <button
                    key={req._id}
                    onClick={() => {
                      setSelectedRequest(req)
                      if (viewMode === 'globe') {
                        const latLng = getLatLng(req.location?.coordinates)
                        if (latLng) globeRef.current?.pointOfView({ lat: latLng[0], lng: latLng[1], altitude: 1.9 }, 900)
                      } else {
                        setViewMode('map')
                      }
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '12px 14px',
                      border: 'none',
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s',
                      borderLeft: `3px solid ${URGENCY_COLORS[req.urgency] || 'transparent'}`,
                      background: selectedRequest?._id === req._id ? 'rgba(59,130,246,0.12)' : 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ fontWeight: 600, fontSize: 14, textTransform: 'capitalize' }}>{TYPE_LABELS[req.type] || req.type}</span>
                      <span className={`badge badge-${req.urgency}`}>{req.urgency}</span>
                    </div>

                    {req.description && (
                      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 5, lineHeight: 1.4 }}>
                        {req.description.slice(0, 70)}
                        {req.description.length > 70 ? '...' : ''}
                      </p>
                    )}

                    <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 5, display: 'flex', gap: 4, alignItems: 'center' }}>
                      <MapPin size={10} />{req.location.address || 'Coordinates only'}
                    </p>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className={`badge badge-${req.status}`}>{req.status.replace('_', ' ')}</span>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{timeAgo(req.createdAt)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {user && !sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            style={{
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 600,
              background: 'var(--color-surface)',
              border: '1px solid var(--glass-border)',
              borderRight: 'none',
              borderRadius: '8px 0 0 8px',
              padding: '12px 6px',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
            }}
          >
            <span style={{ fontSize: 10, writingMode: 'vertical-rl', color: 'var(--color-text-muted)', letterSpacing: 1 }}>INCIDENTS</span>
          </button>
        )}
      </div>
    </div>
  )
}
