import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import * as Crypto from 'expo-crypto';
import { store } from './storage';
import { formatUuidV4, resolveDeviceId } from './device/deviceId';

// Old login flow key. Deleted on every launch, never read.
const LEGACY_SESSION_KEY = 'session';

const DeviceContext = createContext(null);

// getRandomValues works on any origin, unlike randomUUID on plain-http web.
const randomBytes = (n) => Crypto.getRandomValues(new Uint8Array(n));

export function DeviceProvider({ children }) {
  // One resolution per provider instance. Refs survive StrictMode's
  // double-run of effects, so the guards below keep it to a single call.
  const deviceIdPromise = useRef(null);
  const sessionCleared = useRef(false);

  const getDeviceId = useCallback(() => {
    if (!deviceIdPromise.current) {
      // resolveDeviceId handles storage errors and timeouts itself and always
      // resolves; the catch is a last guard so callers never see a rejection.
      deviceIdPromise.current = resolveDeviceId({ store, randomBytes })
        .then((r) => r.deviceId)
        .catch(() => formatUuidV4(randomBytes(16)));
    }
    return deviceIdPromise.current;
  }, []);

  useEffect(() => {
    getDeviceId();
    if (!sessionCleared.current) {
      sessionCleared.current = true;
      // Best effort; a failure is ignored and retried on the next launch.
      try {
        Promise.resolve(store.del(LEGACY_SESSION_KEY)).catch(() => {});
      } catch {
        // store.del threw synchronously; ignore.
      }
    }
  }, [getDeviceId]);

  const value = useMemo(() => ({ getDeviceId }), [getDeviceId]);
  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice() {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error('useDevice must be used inside DeviceProvider');
  return ctx;
}
