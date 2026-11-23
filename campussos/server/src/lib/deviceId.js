// Anonymous mobile Device_ID validation, shared by incident create/list and socket auth.

export const DEVICE_ID_MAX = 128;

// Returns the trimmed Device_ID when it is a string of 1..DEVICE_ID_MAX characters
// after trimming, otherwise null. The typeof check also blocks Mongo operator
// injection such as { "$ne": null } reaching a query.
export function normalizeDeviceId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > DEVICE_ID_MAX) return null;
  return trimmed;
}
