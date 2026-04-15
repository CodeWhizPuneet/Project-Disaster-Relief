import { useEffect, useRef } from 'react'
import type { Socket } from 'socket.io-client'

type TrackingRole = 'user' | 'volunteer'

interface UseLiveLocationTrackingParams {
  socket: Socket | null
  enabled: boolean
  role: TrackingRole
  incidentId?: string | null
  intervalMs?: number
}

export const useLiveLocationTracking = ({
  socket,
  enabled,
  role,
  incidentId,
  intervalMs = 4000,
}: UseLiveLocationTrackingParams) => {
  const watchIdRef = useRef<number | null>(null)
  const lastSentAtRef = useRef(0)

  useEffect(() => {
    if (!enabled || !socket) return
    if (!('geolocation' in navigator)) return

    const eventName = role === 'volunteer' ? 'volunteerLocationUpdate' : 'userLocationUpdate'

    const sendLocation = (latitude: number, longitude: number) => {
      const now = Date.now()
      if (now - lastSentAtRef.current < intervalMs) return

      lastSentAtRef.current = now
      socket.emit(eventName, {
        incidentId,
        latitude,
        longitude,
        status: role === 'volunteer' ? (incidentId ? 'assigned' : 'available') : undefined,
      })
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      position => {
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
  }, [enabled, socket, role, incidentId, intervalMs])
}