/**
 * Lightweight Geohash Base32 utility for 2D spatial indexing.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Encodes latitude and longitude into a Base32 geohash string.
 * @param {number} lat - Latitude (-90 to 90)
 * @param {number} lng - Longitude (-180 to 180)
 * @param {number} precision - Length of geohash string (default 7, ~153m x 153m cell)
 * @returns {string} Geohash string
 */
export function encodeGeohash(lat, lng, precision = 7) {
  let isEven = true;
  let latMin = -90.0;
  let latMax = 90.0;
  let lngMin = -180.0;
  let lngMax = 180.0;
  let bit = 0;
  let ch = 0;
  let geohash = '';

  while (geohash.length < precision) {
    if (isEven) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        ch |= (1 << (4 - bit));
        lngMin = mid;
      } else {
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch |= (1 << (4 - bit));
        latMin = mid;
      } else {
        latMax = mid;
      }
    }

    isEven = !isEven;
    if (bit < 4) {
      bit++;
    } else {
      geohash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return geohash;
}

/**
 * Decodes a geohash string into lat/lng bounding box.
 * @param {string} geohash 
 * @returns {{ latMin: number, latMax: number, lngMin: number, lngMax: number }}
 */
export function decodeGeohashBounds(geohash) {
  let isEven = true;
  let latMin = -90.0;
  let latMax = 90.0;
  let lngMin = -180.0;
  let lngMax = 180.0;

  for (let i = 0; i < geohash.length; i++) {
    const c = geohash[i];
    const cd = BASE32.indexOf(c);
    if (cd === -1) continue;

    for (let j = 4; j >= 0; j--) {
      const mask = 1 << j;
      if (isEven) {
        const mid = (lngMin + lngMax) / 2;
        if (cd & mask) {
          lngMin = mid;
        } else {
          lngMax = mid;
        }
      } else {
        const mid = (latMin + latMax) / 2;
        if (cd & mask) {
          latMin = mid;
        } else {
          latMax = mid;
        }
      }
      isEven = !isEven;
    }
  }

  return { latMin, latMax, lngMin, lngMax };
}
