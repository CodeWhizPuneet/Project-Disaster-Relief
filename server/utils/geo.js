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

module.exports = { haversineDistanceKm };