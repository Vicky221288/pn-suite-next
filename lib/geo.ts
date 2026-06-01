/**
 * Geofence evaluation — runs on the DEVICE (client), never the server. The
 * device computes whether it is inside the org's configured fence and sends ONLY
 * the resulting boolean to `record_attendance`. Raw coordinates never leave the
 * device and are never persisted (DPDP posture — M1b / KL note).
 */

/** Great-circle distance in metres (haversine). */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** True if (lat,lng) is within `radiusM` of the fence centre. */
export function withinGeofence(
  centerLat: number,
  centerLng: number,
  radiusM: number,
  lat: number,
  lng: number,
): boolean {
  return distanceMeters(centerLat, centerLng, lat, lng) <= radiusM;
}
