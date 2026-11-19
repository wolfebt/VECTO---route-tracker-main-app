/**
 * Zoom-aware grid clustering for fleet driver pins on Google Maps.
 */

export function clusterDriverMarkers(drivers = [], zoom = 12) {
  if (!Array.isArray(drivers) || drivers.length === 0) return [];

  if (zoom >= 14 || drivers.length <= 1) {
    return drivers.map((driver) => ({
      type: 'driver',
      id: driver.id,
      driver,
      position: {
        lat: driver.location.latitude,
        lng: driver.location.longitude,
      },
    }));
  }

  const cellSizeDeg = (48 / (256 * Math.pow(2, Math.max(1, zoom)))) * 360;
  const buckets = new Map();

  for (const driver of drivers) {
    const lat = driver.location.latitude;
    const lng = driver.location.longitude;
    const row = Math.floor((lat + 90) / cellSizeDeg);
    const col = Math.floor((lng + 180) / cellSizeDeg);
    const key = `${row}:${col}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(driver);
  }

  const results = [];
  for (const [key, group] of buckets.entries()) {
    if (group.length === 1) {
      const driver = group[0];
      results.push({
        type: 'driver',
        id: driver.id,
        driver,
        position: {
          lat: driver.location.latitude,
          lng: driver.location.longitude,
        },
      });
    } else {
      let sumLat = 0;
      let sumLng = 0;
      for (const d of group) {
        sumLat += d.location.latitude;
        sumLng += d.location.longitude;
      }
      results.push({
        type: 'cluster',
        id: `cluster_${key}`,
        drivers: group,
        position: {
          lat: sumLat / group.length,
          lng: sumLng / group.length,
        },
      });
    }
  }

  return results;
}
