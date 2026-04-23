import { useEffect, useRef, useState } from 'react'

interface Coordinate {
  lat: number
  lng: number
}

const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

export const useSmoothedLocation = (target: Coordinate | null, durationMs = 2200) => {
  const [current, setCurrent] = useState<Coordinate | null>(target)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    if (!target) {
      setCurrent(null)
      return
    }

    if (!current) {
      setCurrent(target)
      return
    }

    if (current.lat === target.lat && current.lng === target.lng) {
      return
    }

    const from = { ...current }
    const to = { ...target }
    const startedAt = performance.now()

    const animate = (now: number) => {
      const rawProgress = Math.min(1, (now - startedAt) / durationMs)
      const progress = easeInOutQuad(rawProgress)

      setCurrent({
        lat: from.lat + (to.lat - from.lat) * progress,
        lng: from.lng + (to.lng - from.lng) * progress,
      })

      if (rawProgress < 1) {
        frameRef.current = requestAnimationFrame(animate)
      }
    }

    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
    }

    frameRef.current = requestAnimationFrame(animate)

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [target?.lat, target?.lng, durationMs])

  return current
}
