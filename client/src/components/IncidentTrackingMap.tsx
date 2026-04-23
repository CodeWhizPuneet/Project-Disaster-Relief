import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

interface MarkerData {
  lat: number
  lng: number
  label: string
  color: string
}

interface IncidentTrackingMapProps {
  center: { lat: number; lng: number } | null
  /** 🔴 Actual victim GPS location (SOS filed here) */
  primaryMarker: MarkerData | null
  /** 🟢 Volunteer live position */
  secondaryMarker?: MarkerData | null
  /**
   * 🟡 Road-snapped navigation destination (OSRM nearest point).
   * When present:
   *   - A solid line is drawn: volunteer → road point
   *   - A dotted line is drawn: road point → victim (final walk)
   * When absent, the single `guidePath` dashed line is used.
   */
  routeMarker?: MarkerData | null
  /** Straight-line reference path drawn as a dashed polyline. Set once at journey start — never re-fetched. */
  guidePath?: Array<{ lat: number; lng: number }>
  highlightPrimary?: boolean
  height?: number
}

const MAP_TILE = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'

export const IncidentTrackingMap = ({
  center,
  primaryMarker,
  secondaryMarker,
  routeMarker,
  guidePath,
  highlightPrimary = false,
  height = 250,
}: IncidentTrackingMapProps) => {
  const [pulseRadius, setPulseRadius] = useState(14)

  const guidePathKey = useMemo(
    () => (guidePath || []).map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|'),
    [guidePath]
  )

  useEffect(() => {
    if (!highlightPrimary || !primaryMarker) return
    const timer = window.setInterval(() => {
      const t = Date.now() / 260
      setPulseRadius(12 + ((Math.sin(t) + 1) / 2) * 7)
    }, 80)
    return () => window.clearInterval(timer)
  }, [highlightPrimary, primaryMarker?.lat, primaryMarker?.lng])

  const mapCenter = useMemo<[number, number]>(() => {
    if (center) return [center.lat, center.lng]
    if (primaryMarker) return [primaryMarker.lat, primaryMarker.lng]
    if (secondaryMarker) return [secondaryMarker.lat, secondaryMarker.lng]
    return [20.5937, 78.9629]
  }, [center, primaryMarker, secondaryMarker])

  // Derived path segments when routeMarker is present
  const drivingPath = useMemo<[number, number][] | null>(() => {
    if (!routeMarker || !secondaryMarker) return null
    return [
      [secondaryMarker.lat, secondaryMarker.lng],
      [routeMarker.lat,     routeMarker.lng],
    ]
  }, [routeMarker, secondaryMarker])

  const walkingPath = useMemo<[number, number][] | null>(() => {
    if (!routeMarker || !primaryMarker) return null
    return [
      [routeMarker.lat,  routeMarker.lng],
      [primaryMarker.lat, primaryMarker.lng],
    ]
  }, [routeMarker, primaryMarker])

  return (
    <div style={{ height, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--glass-border)' }}>
      <MapContainer
        center={mapCenter}
        zoom={primaryMarker || secondaryMarker ? 13 : 5}
        scrollWheelZoom
        worldCopyJump
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer url={MAP_TILE} attribution="&copy; OpenStreetMap &copy; CARTO" noWrap={false} />

        {/* ── Route lines ── */}

        {/* Case A: routeMarker present — show two segments */}
        {routeMarker && drivingPath && (
          // Solid line: volunteer → road point (driveable)
          <Polyline
            positions={drivingPath}
            pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.85 }}
          />
        )}
        {routeMarker && walkingPath && (
          // Dotted line: road point → victim (walking/foot)
          <Polyline
            positions={walkingPath}
            pathOptions={{ color: '#f97316', weight: 2.5, opacity: 0.7, dashArray: '6 6' }}
          />
        )}

        {/* Case B: no routeMarker — fallback to simple guide path */}
        {!routeMarker && guidePath && guidePath.length >= 2 && (
          <Polyline
            key={guidePathKey}
            positions={guidePath.map(p => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: '#dc2626', weight: 3, opacity: 0.75, dashArray: '10 8' }}
          />
        )}

        {/* ── Markers ── */}

        {/* 🔴 Victim SOS location (pulsing halo) */}
        {primaryMarker && highlightPrimary && (
          <CircleMarker
            center={[primaryMarker.lat, primaryMarker.lng]}
            radius={pulseRadius}
            pathOptions={{ color: primaryMarker.color, fillColor: primaryMarker.color, fillOpacity: 0.14, weight: 0 }}
          />
        )}
        {primaryMarker && (
          <CircleMarker
            center={[primaryMarker.lat, primaryMarker.lng]}
            radius={9}
            pathOptions={{ color: primaryMarker.color, fillColor: primaryMarker.color, fillOpacity: 0.8, weight: 2 }}
          >
            <Tooltip>{primaryMarker.label}</Tooltip>
          </CircleMarker>
        )}

        {/* 🟡 Road-snapped route endpoint */}
        {routeMarker && (
          <CircleMarker
            center={[routeMarker.lat, routeMarker.lng]}
            radius={8}
            pathOptions={{ color: routeMarker.color, fillColor: routeMarker.color, fillOpacity: 0.85, weight: 2 }}
          >
            <Tooltip>{routeMarker.label}</Tooltip>
          </CircleMarker>
        )}

        {/* 🟢 Volunteer position */}
        {secondaryMarker && (
          <CircleMarker
            center={[secondaryMarker.lat, secondaryMarker.lng]}
            radius={7}
            pathOptions={{ color: secondaryMarker.color, fillColor: secondaryMarker.color, fillOpacity: 0.7, weight: 2 }}
          >
            <Tooltip>{secondaryMarker.label}</Tooltip>
          </CircleMarker>
        )}
      </MapContainer>
    </div>
  )
}
