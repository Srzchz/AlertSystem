// Feature: mobile-remove-auth, Property 2: Device_ID resolution is stable
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
import fc from 'fast-check';
import { DEVICE_ID_KEY, formatUuidV4, isUuidV4, resolveDeviceId } from './deviceId';

// Working in-memory Device_Store that records writes.
function memoryStore(initial) {
  const data = new Map();
  if (initial.present) data.set(DEVICE_ID_KEY, initial.value);
  const writes = [];
  return {
    data,
    writes,
    get: async (key) => (data.has(key) ? data.get(key) : null),
    set: async (key, value) => {
      writes.push([key, value]);
      data.set(key, value);
    },
    del: async (key) => {
      data.delete(key);
    },
  };
}

// Random byte source fed by fast-check; counts how many IDs were generated.
function byteSource(seeds) {
  let i = 0;
  const fn = (n) => {
    const bytes = seeds[i % seeds.length];
    i += 1;
    return bytes.slice(0, n);
  };
  fn.calls = () => i;
  return fn;
}

const bytes16 = fc.uint8Array({ minLength: 16, maxLength: 16 });
const validUuid = bytes16.map((b) => formatUuidV4(b));

const hex = '0123456789abcdef';
const setChar = (s, idx, ch) => s.slice(0, idx) + ch + s.slice(idx + 1);

// Near-miss values that must NOT be treated as a valid stored Device_ID.
const nearMiss = fc.oneof(
  // uppercase UUID (contains at least one letter so it really differs)
  validUuid.map((u) => u.toUpperCase()).filter((u) => /[A-F]/.test(u)),
  // wrong version nibble (index 14)
  fc
    .tuple(validUuid, fc.constantFrom(...hex.replace('4', '').split('')))
    .map(([u, c]) => setChar(u, 14, c)),
  // wrong variant nibble (index 19)
  fc
    .tuple(validUuid, fc.constantFrom(...'01234567cdef'.split('')))
    .map(([u, c]) => setChar(u, 19, c)),
  // whitespace-padded UUID
  fc
    .tuple(validUuid, fc.constantFrom(' ', '\t', '\n', '  '), fc.constantFrom('', ' ', '\n'))
    .map(([u, pre, post]) => pre + u + post)
);

const initialContent = fc.oneof(
  fc.constant({ present: false }),
  fc.constant({ present: true, value: null }),
  validUuid.map((value) => ({ present: true, value })),
  fc.string().map((value) => ({ present: true, value })),
  nearMiss.map((value) => ({ present: true, value }))
);

describe('Property 2: Device_ID resolution is stable', () => {
  it('returns a stored valid UUID v4, reuses valid values, and is stable on re-resolve', async () => {
    await fc.assert(
      fc.asyncProperty(
        initialContent,
        fc.array(bytes16, { minLength: 1, maxLength: 4 }),
        async (initial, seeds) => {
          const store = memoryStore(initial);
          const randomBytes = byteSource(seeds);
          const initialValid = initial.present && isUuidV4(initial.value);

          const first = await resolveDeviceId({ store, randomBytes });

          expect(isUuidV4(first.deviceId)).toBe(true);
          expect(first.persisted).toBe(true);
          expect(store.data.get(DEVICE_ID_KEY)).toBe(first.deviceId);

          if (initialValid) {
            expect(first.deviceId).toBe(initial.value);
            expect(randomBytes.calls()).toBe(0);
            expect(store.writes).toHaveLength(0);
          } else {
            expect(randomBytes.calls()).toBe(1);
            expect(store.writes).toEqual([[DEVICE_ID_KEY, first.deviceId]]);
          }

          const writesBefore = store.writes.length;
          const callsBefore = randomBytes.calls();
          const second = await resolveDeviceId({ store, randomBytes });

          expect(second.deviceId).toBe(first.deviceId);
          expect(second.persisted).toBe(true);
          expect(store.writes).toHaveLength(writesBefore);
          expect(randomBytes.calls()).toBe(callsBefore);
        }
      ),
      { numRuns: 200 }
    );
  });
});
