import { useEffect, useRef, useState } from 'react'

interface LatLng {
  lat: number
  lng: number
}

interface UseOrsRouteParams {
  from: LatLng | null
  to: LatLng | null
  enabled: boolean
  throttleMs?: number
  cacheKey?: string | null
  maxDistanceKm?: number
  retryOnError?: boolean
}

interface RouteMeta {
  distanceKm: number
  durationMinutes: number
}

export const useOrsRoute = ({
  from,
  to,
  enabled,
  throttleMs = 15000,
  cacheKey,
  maxDistanceKm = 800,
  retryOnError = false,
}: UseOrsRouteParams) => {
  const [routePath, setRoutePath] = useState<Array<{ lat: number; lng: number }> | null>(null)
  const [meta, setMeta] = useState<RouteMeta | null>(null)
  const [error, setError] = useState<string | null>(null)

  const lastFetchAtRef = useRef(0)
  const timeoutRef = useRef<number | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const routeCacheRef = useRef<Map<string, { path: Array<{ lat: number; lng: number }>; meta: RouteMeta }>>(new Map())
  const failedCacheRef = useRef<Map<string, string>>(new Map())

  const isValidCoord = (point: LatLng | null) =>
    Boolean(
      point &&
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lng) &&
        Math.abs(point.lat) <= 90 &&
        Math.abs(point.lng) <= 180
    )

  const distanceKmBetween = (a: LatLng, b: LatLng) => {
    const toRadians = (value: number) => (value * Math.PI) / 180
    const earthRadiusKm = 6371

    const dLat = toRadians(b.lat - a.lat)
    const dLng = toRadians(b.lng - a.lng)
    const lat1 = toRadians(a.lat)
    const lat2 = toRadians(b.lat)

    const haversineA =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)

    const c = 2 * Math.atan2(Math.sqrt(haversineA), Math.sqrt(1 - haversineA))
    return earthRadiusKm * c
  }

  useEffect(() => {
    if (!enabled || !from || !to) {
      setRoutePath(null)
      setMeta(null)
      setError(null)
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      abortControllerRef.current?.abort()
      return
    }

    if (!isValidCoord(from) || !isValidCoord(to)) {
      setRoutePath(null)
      setMeta(null)
      setError('Invalid coordinates')
      return
    }

    const routeDistanceKm = distanceKmBetween(from, to)
    if (!Number.isFinite(routeDistanceKm) || routeDistanceKm <= 0 || routeDistanceKm > maxDistanceKm) {
      setRoutePath(null)
      setMeta(null)
      setError(`Route distance out of bounds (${routeDistanceKm.toFixed(1)} km)`)
      return
    }

    const resolvedCacheKey =
      cacheKey?.trim() ||
      `${from.lat.toFixed(5)},${from.lng.toFixed(5)}->${to.lat.toFixed(5)},${to.lng.toFixed(5)}`

    const cachedRoute = routeCacheRef.current.get(resolvedCacheKey)
    if (cachedRoute) {
      setRoutePath(cachedRoute.path)
      setMeta(cachedRoute.meta)
      setError(null)
      return
    }

    if (!retryOnError && failedCacheRef.current.has(resolvedCacheKey)) {
      setRoutePath(null)
      setMeta(null)
      setError(failedCacheRef.current.get(resolvedCacheKey) || 'Route fetch failed')
      return
    }

    const runFetch = async () => {
      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller

      console.debug('[RouteHook] Request payload [lat,lng]', {
        start: from,
        end: to,
        cacheKey: resolvedCacheKey,
      })

      try {
        const token = localStorage.getItem('token')
        const response = await fetch('/api/route', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ start: from, end: to }),
        })

        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          throw new Error(payload?.message || `Route API error ${response.status}`)
        }

        const payload = await response.json()
        const routeData = payload?.data

        if (!routeData?.path || !Array.isArray(routeData.path) || routeData.path.length < 2) {
          throw new Error('Route response missing valid path')
        }

        setRoutePath(routeData.path)
        const nextMeta = {
          distanceKm: Number(routeData.distanceKm),
          durationMinutes: Number(routeData.durationMinutes),
        }
        setMeta(nextMeta)
        setError(null)
        lastFetchAtRef.current = Date.now()
        routeCacheRef.current.set(resolvedCacheKey, { path: routeData.path, meta: nextMeta })
        failedCacheRef.current.delete(resolvedCacheKey)

        console.debug('[RouteHook] API response summary', {
          distanceKm: routeData.distanceKm,
          durationMinutes: routeData.durationMinutes,
          pathPoints: routeData.path.length,
        })
      } catch (fetchError: any) {
        if (fetchError?.name === 'AbortError') return

        const message = fetchError?.message || 'Route fetch failed'
        setError(message)
        setRoutePath(null)
        setMeta(null)
        failedCacheRef.current.set(resolvedCacheKey, message)
        console.error('[RouteHook] Route fetch failed', message)
      }
    }

    const now = Date.now()
    const elapsed = now - lastFetchAtRef.current

    if (elapsed >= throttleMs) {
      runFetch()
    } else {
      const remaining = throttleMs - elapsed
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = window.setTimeout(() => {
        runFetch()
      }, remaining)
    }

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [enabled, from?.lat, from?.lng, to?.lat, to?.lng, throttleMs, cacheKey, maxDistanceKm, retryOnError])

  return {
    routePath,
    routeMeta: meta,
    routeError: error,
  }
}
