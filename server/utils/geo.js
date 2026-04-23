const toRadians = (degrees) => (degrees * Math.PI) / 180;

const haversineDistanceKm = (pointA, pointB) => {
  const [lng1, lat1] = pointA;
  const [lng2, lat2] = pointB;

  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
};

/**
 * Finds the nearest point on the road network to the given coordinates.
 *
 * Uses the OSRM (Open Source Routing Machine) nearest API — completely free,
 * no API key required, works globally via the public demo server.
 *
 * URL: https://router.project-osrm.org/nearest/v1/driving/{lng},{lat}
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} [timeoutMs=4000]  Abort if API takes longer than this.
 * @returns {Promise<{ lat: number, lng: number, distanceMeters: number, roadName: string }>}
 *          Falls back to original coords if the request fails.
 */
const findNearestRoadPoint = async (lat, lng, timeoutMs = 4000) => {
  const fallback = { lat, lng, distanceMeters: 0, roadName: '' };

  try {
    // Try the candidate coords — original first, then small offsets if desired.
    // OSRM already snaps to the nearest road automatically, so one call is enough.
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);

    const url = `https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=1`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timerId);

    if (!res.ok) {
      console.warn(`[geo] OSRM nearest returned HTTP ${res.status} — using original coords`);
      return fallback;
    }

    const json = await res.json();
    if (json.code !== 'Ok' || !json.waypoints?.length) {
      console.warn('[geo] OSRM nearest: no waypoints returned — using original coords');
      return fallback;
    }

    const [roadLng, roadLat] = json.waypoints[0].location;
    const distanceMeters = json.waypoints[0].distance ?? 0;
    const roadName = json.waypoints[0].name ?? '';

    return {
      lat: Number(roadLat.toFixed(7)),
      lng: Number(roadLng.toFixed(7)),
      distanceMeters: Math.round(distanceMeters),
      roadName,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[geo] OSRM nearest timed out — using original coords');
    } else {
      console.warn('[geo] OSRM nearest error:', err.message, '— using original coords');
    }
    return fallback;
  }
};

module.exports = { haversineDistanceKm, findNearestRoadPoint };