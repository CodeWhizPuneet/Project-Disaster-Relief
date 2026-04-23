interface LatLng {
  lat: number
  lng: number
}

type TravelMode = 'driving' | 'walking' | 'bicycling' | 'transit'

interface UseGoogleMapsNavigationParams {
  from: LatLng | null
  to: LatLng | null
  mode?: TravelMode
}

/**
 * Builds a Google Maps deep-link URL for navigation.
 *
 * On desktop — opens Google Maps in a new tab.
 * On mobile — opens the native Maps app if installed.
 *
 * IMPORTANT: This replaces all ORS route API calls for the volunteer flow.
 * No routing API is called; Google Maps handles the actual navigation.
 */
export const useGoogleMapsNavigation = ({
  from,
  to,
  mode = 'driving',
}: UseGoogleMapsNavigationParams) => {
  const isValid =
    from &&
    to &&
    Number.isFinite(from.lat) &&
    Number.isFinite(from.lng) &&
    Number.isFinite(to.lat) &&
    Number.isFinite(to.lng)

  const buildUrl = (): string | null => {
    if (!isValid || !from || !to) return null
    return (
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${from.lat},${from.lng}` +
      `&destination=${to.lat},${to.lng}` +
      `&travelmode=${mode}`
    )
  }

  /**
   * Opens Google Maps with turn-by-turn navigation from `from` to `to`.
   * Returns `true` if the URL was opened, `false` if coordinates are invalid.
   */
  const openInGoogleMaps = (): boolean => {
    const url = buildUrl()
    if (!url) return false
    window.open(url, '_blank', 'noopener,noreferrer')
    return true
  }

  return {
    /** Whether origin and destination coordinates are valid */
    canNavigate: Boolean(isValid),
    /** Opens Google Maps / native app. Returns false if coords invalid. */
    openInGoogleMaps,
    /** The raw URL (useful for an <a href> or share button) */
    mapsUrl: buildUrl(),
  }
}
