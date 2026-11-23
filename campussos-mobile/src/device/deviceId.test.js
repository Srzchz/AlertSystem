import {
  DEVICE_ID_KEY,
  formatUuidV4,
  isUuidV4,
  resolveDeviceId,
} from './deviceId';

const bytes = (fill) => new Uint8Array(16).fill(fill);
const randomBytes = (n) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
};

function memoryStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: jest.fn(async (k) => (k in data ? data[k] : null)),
    set: jest.fn(async (k, v) => {
      data[k] = v;
    }),
    del: jest.fn(async (k) => {
      delete data[k];
    }),
  };
}

describe('formatUuidV4', () => {
  it('formats all-0xff bytes with version and variant bits set', () => {
    expect(formatUuidV4(bytes(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('formats all-zero bytes as a valid v4 UUID', () => {
    const id = formatUuidV4(bytes(0));
    expect(id).toBe('00000000-0000-4000-8000-000000000000');
    expect(isUuidV4(id)).toBe(true);
  });

  it('does not mutate the input', () => {
    const input = bytes(0xff);
    formatUuidV4(input);
    expect(Array.from(input)).toEqual(Array(16).fill(0xff));
  });

  it('rejects input that is not 16 bytes', () => {
    expect(() => formatUuidV4(new Uint8Array(15))).toThrow(TypeError);
  });
});

describe('isUuidV4', () => {
  it('rejects uppercase, wrong version, and non-strings', () => {
    expect(isUuidV4('FFFFFFFF-FFFF-4FFF-BFFF-FFFFFFFFFFFF')).toBe(false);
    expect(isUuidV4('ffffffff-ffff-1fff-bfff-ffffffffffff')).toBe(false);
    expect(isUuidV4(null)).toBe(false);
    expect(isUuidV4(42)).toBe(false);
  });
});

describe('resolveDeviceId', () => {
  it('generates and stores an ID when none exists', async () => {
    const store = memoryStore();
    const res = await resolveDeviceId({ store, randomBytes });
    expect(isUuidV4(res.deviceId)).toBe(true);
    expect(res.persisted).toBe(true);
    expect(store.data[DEVICE_ID_KEY]).toBe(res.deviceId);
  });

  it('reuses a valid stored ID without writing', async () => {
    const existing = '3f2b8c1e-9a4d-4c7e-b2f1-0d6e5a7c9b13';
    const store = memoryStore({ [DEVICE_ID_KEY]: existing });
    const gen = jest.fn(randomBytes);
    const res = await resolveDeviceId({ store, randomBytes: gen });
    expect(res).toEqual({ deviceId: existing, persisted: true });
    expect(gen).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it('overwrites an invalid stored value', async () => {
    const store = memoryStore({ [DEVICE_ID_KEY]: 'not-a-uuid' });
    const res = await resolveDeviceId({ store, randomBytes });
    expect(isUuidV4(res.deviceId)).toBe(true);
    expect(store.data[DEVICE_ID_KEY]).toBe(res.deviceId);
  });

  it('returns the same ID on a second launch', async () => {
    const store = memoryStore();
    const a = await resolveDeviceId({ store, randomBytes });
    const b = await resolveDeviceId({ store, randomBytes });
    expect(b.deviceId).toBe(a.deviceId);
  });

  it('falls back to an in-memory ID when the read throws', async () => {
    const store = memoryStore();
    store.get.mockRejectedValueOnce(new Error('boom'));
    const res = await resolveDeviceId({ store, randomBytes });
    expect(isUuidV4(res.deviceId)).toBe(true);
    expect(res.persisted).toBe(false);
    expect(store.set).not.toHaveBeenCalled();
  });

  it('falls back when the write throws', async () => {
    const store = memoryStore();
    store.set.mockRejectedValueOnce(new Error('boom'));
    const res = await resolveDeviceId({ store, randomBytes });
    expect(isUuidV4(res.deviceId)).toBe(true);
    expect(res.persisted).toBe(false);
  });

  it('falls back when the read takes longer than the timeout', async () => {
    jest.useFakeTimers();
    try {
      const store = memoryStore();
      store.get.mockReturnValueOnce(new Promise(() => {}));
      const p = resolveDeviceId({ store, randomBytes, timeoutMs: 3000 });
      jest.advanceTimersByTime(3000);
      const res = await p;
      expect(isUuidV4(res.deviceId)).toBe(true);
      expect(res.persisted).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
