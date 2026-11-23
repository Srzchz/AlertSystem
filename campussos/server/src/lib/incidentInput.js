// Validates and shapes an anonymous mobile SOS submission (POST /api/incidents).
// Pure: no I/O. Only allowed fields are copied, so clients cannot set status,
// reporter, handledBy, source, or timestamps.

import { CATEGORIES } from '../models/Incident.js';
import { normalizeDeviceId } from './deviceId.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Copies the listed keys that are present (and not undefined) on a plain object.
function pick(source, keys) {
  const out = {};
  if (!isObject(source)) return out;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
      out[key] = source[key];
    }
  }
  return out;
}

export function buildAppIncident(body) {
  const input = isObject(body) ? body : {};

  const deviceId = normalizeDeviceId(input.deviceId);
  if (deviceId === null) return { ok: false, error: 'Device ID is missing or invalid' };

  if (!CATEGORIES.includes(input.category)) return { ok: false, error: 'Choose an alert category' };

  const { location } = input;
  if (!isObject(location) || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    return { ok: false, error: 'Location is required' };
  }

  const doc = {
    deviceId,
    forSelf: input.forSelf !== false,
    patient: pick(input.patient, ['name', 'sex', 'age']),
    nature: input.nature,
    category: input.category,
    patientStatus: input.patientStatus,
    location: pick(location, ['lat', 'lng', 'accuracy', 'description']),
    source: 'APP',
    status: 'PENDING',
  };

  return { ok: true, doc };
}
