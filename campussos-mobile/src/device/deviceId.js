// Anonymous Device_ID logic. Pure JavaScript: no React Native or Expo imports,
// so it can be unit/property tested in isolation. The caller injects the
// storage wrapper and the random byte source.

export const DEVICE_ID_KEY = 'deviceId';

export const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidV4(value) {
  return typeof value === 'string' && UUID_V4_RE.test(value);
}

// Formats 16 random bytes as a lowercase UUID v4 (8-4-4-4-12).
// Works on a copy, so the caller's array is never modified.
export function formatUuidV4(bytes) {
  if (!bytes || bytes.length !== 16) {
    throw new TypeError('formatUuidV4 needs exactly 16 bytes');
  }
  const b = Array.from(bytes, (x) => x & 0xff);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Local timeout helper (storage.js imports react-native, so it is not reused here).
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject({ timeout: true }), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

// Resolves the Device_ID for this installation.
// - valid stored UUID v4 -> reused as is
// - missing/invalid -> new ID generated and written to the store
// - read or write throws or exceeds timeoutMs -> fresh in-memory ID, persisted: false
export async function resolveDeviceId({ store, randomBytes, timeoutMs = 3000 }) {
  const generate = () => formatUuidV4(randomBytes(16));

  let stored;
  try {
    stored = await withTimeout(store.get(DEVICE_ID_KEY), timeoutMs);
  } catch {
    return { deviceId: generate(), persisted: false };
  }

  if (isUuidV4(stored)) {
    return { deviceId: stored, persisted: true };
  }

  const deviceId = generate();
  try {
    await withTimeout(store.set(DEVICE_ID_KEY, deviceId), timeoutMs);
  } catch {
    return { deviceId, persisted: false };
  }
  return { deviceId, persisted: true };
}
