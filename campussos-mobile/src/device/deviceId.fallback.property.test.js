// Feature: mobile-remove-auth, Property 3: Storage failure falls back to one in-memory Device_ID
// **Validates: Requirements 3.5**
import React from 'react';
import fc from 'fast-check';
import { render } from '@testing-library/react-native';
import { resolveDeviceId, isUuidV4, DEVICE_ID_KEY } from './deviceId';
import { DeviceProvider, useDevice } from '../DeviceContext';
import { store as appStore } from '../storage';

const nodeCrypto = require('crypto');
const randomBytes = (n) => new Uint8Array(nodeCrypto.randomBytes(n));

const TIMEOUT_MS = 3000;
const never = () => new Promise(() => {});

// Values the store may hold before the write step: missing or not a valid UUID v4.
const nonUuidStored = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.string().filter((s) => !isUuidV4(s)),
  fc.uuid({ version: 4 }).map((u) => u.toUpperCase())
);

// One storage failure mode, with the value the read returns when the read itself works.
const failureMode = fc.oneof(
  fc.record({ kind: fc.constantFrom('readThrowsSync', 'readRejects', 'readHangs') }),
  fc.record({
    kind: fc.constantFrom('writeThrowsSync', 'writeRejects', 'writeHangs'),
    stored: nonUuidStored,
  })
);

// Builds a store object implementing the given failure mode.
function failingStore(mode) {
  const err = new Error('storage unavailable');
  const get = jest.fn(() => {
    switch (mode.kind) {
      case 'readThrowsSync':
        throw err;
      case 'readRejects':
        return Promise.reject(err);
      case 'readHangs':
        return never();
      default:
        return Promise.resolve(mode.stored);
    }
  });
  const set = jest.fn(() => {
    switch (mode.kind) {
      case 'writeThrowsSync':
        throw err;
      case 'writeRejects':
        return Promise.reject(err);
      case 'writeHangs':
        return never();
      default:
        return Promise.resolve();
    }
  });
  const del = jest.fn(() => Promise.resolve());
  return { get, set, del };
}

// Lets read and write timeouts fire (each is bounded by TIMEOUT_MS).
async function flushStorageTimeouts() {
  await jest.advanceTimersByTimeAsync(TIMEOUT_MS);
  await jest.advanceTimersByTimeAsync(TIMEOUT_MS);
}

describe('Property 3: Storage failure falls back to one in-memory Device_ID', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('resolveDeviceId returns a valid UUID v4 with persisted: false for every failure mode', async () => {
    await fc.assert(
      fc.asyncProperty(failureMode, async (mode) => {
        const store = failingStore(mode);
        const pending = resolveDeviceId({ store, randomBytes });
        await flushStorageTimeouts();
        const result = await pending;

        expect(result.persisted).toBe(false);
        expect(isUuidV4(result.deviceId)).toBe(true);
        expect(store.get).toHaveBeenCalledWith(DEVICE_ID_KEY);
      }),
      { numRuns: 200 }
    );
  });

  // Rendering the provider is slower, so this part runs 30 times instead of 100+.
  test('every getDeviceId() call in one session returns the same valid ID when storage fails', async () => {
    await fc.assert(
      fc.asyncProperty(failureMode, fc.integer({ min: 1, max: 20 }), async (mode, n) => {
        const failing = failingStore(mode);
        jest.spyOn(appStore, 'get').mockImplementation(failing.get);
        jest.spyOn(appStore, 'set').mockImplementation(failing.set);
        jest.spyOn(appStore, 'del').mockImplementation(failing.del);

        let ctx = null;
        function Capture() {
          ctx = useDevice();
          return null;
        }

        const screen = await render(
          <DeviceProvider>
            <Capture />
          </DeviceProvider>
        );

        // Some calls before the storage timeouts fire, the rest after.
        const before = Math.ceil(n / 2);
        const calls = [];
        for (let i = 0; i < before; i++) calls.push(ctx.getDeviceId());
        await flushStorageTimeouts();
        for (let i = before; i < n; i++) calls.push(ctx.getDeviceId());

        const ids = await Promise.all(calls);
        expect(ids).toHaveLength(n);
        expect(isUuidV4(ids[0])).toBe(true);
        for (const id of ids) expect(id).toBe(ids[0]);

        // One resolution per session: storage was read at most once.
        expect(appStore.get).toHaveBeenCalledTimes(1);

        await screen.unmount();
        jest.restoreAllMocks();
      }),
      { numRuns: 30 }
    );
  });
});
