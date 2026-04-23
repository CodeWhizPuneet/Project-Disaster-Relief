import { useEffect, useRef } from 'react'
import type { Socket } from 'socket.io-client'

type TrackingRole = 'user' | 'volunteer'

interface UseLiveLocationTrackingParams {
  socket: Socket | null
  enabled: boolean
  role: TrackingRole
  incidentId?: string | null
  intervalMs?: number
  minDistanceMeters?: number
  onLocationUpdate?: (location: { lat: number; lng: number }) => void
}

const distanceMetersBetween = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
) => {
  const earthRadiusM = 6371000
  const toRadians = (value: number) => (value * Math.PI) / 180

  const dLat = toRadians(to.lat - from.lat)
  const dLng = toRadians(to.lng - from.lng)
  const lat1 = toRadians(from.lat)
  const lat2 = toRadians(to.lat)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusM * c
}

export const useLiveLocationTracking = ({
  socket,
  enabled,
  role,
  incidentId,
  intervalMs = 4000,
  minDistanceMeters = 15,
  onLocationUpdate,
}: UseLiveLocationTrackingParams) => {
  const watchIdRef = useRef<number | null>(null)
  const lastSentAtRef = useRef(0)
  const lastSentLocationRef = useRef<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (!enabled || !socket) return
    if (!('geolocation' in navigator)) return

    const eventName = role === 'volunteer' ? 'volunteerLocationUpdate' : 'userLocationUpdate'

    const sendLocation = (latitude: number, longitude: number) => {
      const now = Date.now()
      if (now - lastSentAtRef.current < intervalMs) return

      const nextPoint = { lat: latitude, lng: longitude }
      if (lastSentLocationRef.current) {
        const movedDistance = distanceMetersBetween(lastSentLocationRef.current, nextPoint)
        if (movedDistance < minDistanceMeters) return
      }

      lastSentAtRef.current = now
      lastSentLocationRef.current = nextPoint
      socket.emit(eventName, {
        incidentId,
        latitude,
        longitude,
        status: role === 'volunteer' ? (incidentId ? 'assigned' : 'available') : undefined,
      })
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      position => {
        onLocationUpdate?.({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        })
        sendLocation(position.coords.latitude, position.coords.longitude)
      },
      () => {
        // silently ignore location errors in background tracking
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 3000,
      }
    )

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [enabled, socket, role, incidentId, intervalMs, minDistanceMeters, onLocationUpdate])
}