const isValidLat = (value) => Number.isFinite(value) && Math.abs(value) <= 90;
const isValidLng = (value) => Number.isFinite(value) && Math.abs(value) <= 180;

const toPathFromGeoJson = (geoJson) => {
  const coords = geoJson?.features?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;

  return coords
    .filter(point => Array.isArray(point) && point.length >= 2)
    .map(point => ({ lat: Number(point[1]), lng: Number(point[0]) }));
};

const getRoute = async (req, res) => {
  try {
    const { start, end } = req.body || {};

    if (
      !start ||
      !end ||
      !isValidLat(Number(start.lat)) ||
      !isValidLng(Number(start.lng)) ||
      !isValidLat(Number(end.lat)) ||
      !isValidLng(Number(end.lng))
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates. Expected start/end with lat/lng.',
      });
    }

    const orsApiKey = (process.env.ORS_API_KEY || process.env.OPENROUTESERVICE_API_KEY || '').trim();
    if (!orsApiKey) {
      return res.status(500).json({
        success: false,
        message: 'OpenRouteService API key is not configured on server.',
      });
    }

    const coordinates = [
      [Number(start.lng), Number(start.lat)],
      [Number(end.lng), Number(end.lat)],
    ];

    const orsResponse = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      headers: {
        Authorization: orsApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        coordinates,
        radiuses: [1000, 1000],
      }),
    });

    const payload = await orsResponse.json().catch(() => null);

    if (!orsResponse.ok) {
      const errorMessage = payload?.error?.message || payload?.message || 'Route fetch failed';
      console.error('[RouteAPI] ORS error', {
        status: orsResponse.status,
        message: errorMessage,
      });

      return res.status(502).json({
        success: false,
        message: errorMessage,
      });
    }

    const summary = payload?.features?.[0]?.properties?.summary;
    const path = toPathFromGeoJson(payload);

    if (!summary || !path || path.length < 2) {
      console.error('[RouteAPI] Invalid ORS response shape');
      return res.status(502).json({
        success: false,
        message: 'Invalid route response from OpenRouteService',
      });
    }

    console.debug('[RouteAPI] ORS response summary', {
      distanceMeters: summary.distance,
      durationSeconds: summary.duration,
      pathPoints: path.length,
    });

    return res.json({
      success: true,
      data: {
        path,
        distanceKm: Number((summary.distance / 1000).toFixed(2)),
        durationMinutes: Math.max(1, Math.round(summary.duration / 60)),
      },
    });
  } catch (error) {
    console.error('[RouteAPI] Unexpected error', error.message || error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch route',
    });
  }
};

module.exports = { getRoute };
