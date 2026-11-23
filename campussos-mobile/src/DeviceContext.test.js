import React, { StrictMode } from 'react';
import { Text } from 'react-native';
import { render, screen, act } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { DeviceProvider, useDevice } from './DeviceContext';
import { DEVICE_ID_KEY, isUuidV4 } from './device/deviceId';

// Requirements 3.5, 3.7, 3.8

const SESSION_KEY = 'session';
const STORED_ID = '3f2b8c1e-9a4d-4c7e-b2f1-0d6e5a7c9b13';

// Captures the context value so tests can call getDeviceId() directly.
let ctx;
function Probe() {
  ctx = useDevice();
  return <Text>child rendered</Text>;
}

const callsFor = (fn, key) => fn.mock.calls.filter(([k]) => k === key).length;

// Let pending promise callbacks (store reads/writes, deletes) run.
const flush = () => act(async () => {});

beforeEach(() => {
  ctx = undefined;
  SecureStore.__reset();
  jest.clearAllMocks();
});

describe('DeviceProvider', () => {
  test('deletes the old session key and keeps the stored deviceId', async () => {
    SecureStore.__store.set(SESSION_KEY, JSON.stringify({ token: 't', user: { id: 1 } }));
    SecureStore.__store.set(DEVICE_ID_KEY, STORED_ID);

    await render(<DeviceProvider><Probe /></DeviceProvider>);
    await expect(ctx.getDeviceId()).resolves.toBe(STORED_ID);
    await flush();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SESSION_KEY);
    expect(SecureStore.__store.has(SESSION_KEY)).toBe(false);
    expect(SecureStore.__store.get(DEVICE_ID_KEY)).toBe(STORED_ID);
    expect(callsFor(SecureStore.deleteItemAsync, DEVICE_ID_KEY)).toBe(0);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  test('survives a delete that rejects', async () => {
    SecureStore.deleteItemAsync.mockImplementationOnce(async () => {
      throw new Error('keychain locked');
    });

    await render(<DeviceProvider><Probe /></DeviceProvider>);
    const id = await ctx.getDeviceId();
    await flush();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SESSION_KEY);
    expect(isUuidV4(id)).toBe(true);
    expect(screen.getByText('child rendered')).toBeOnTheScreen();
  });

  test('survives a delete that throws synchronously', async () => {
    SecureStore.deleteItemAsync.mockImplementationOnce(() => {
      throw new Error('native module missing');
    });

    await render(<DeviceProvider><Probe /></DeviceProvider>);
    const id = await ctx.getDeviceId();

    expect(isUuidV4(id)).toBe(true);
    expect(screen.getByText('child rendered')).toBeOnTheScreen();
  });

  test('returns the same ID to repeated getDeviceId() calls and resolves once', async () => {
    await render(<DeviceProvider><Probe /></DeviceProvider>);

    const ids = await Promise.all(Array.from({ length: 5 }, () => ctx.getDeviceId()));
    const later = await ctx.getDeviceId();

    expect(isUuidV4(ids[0])).toBe(true);
    expect(new Set([...ids, later]).size).toBe(1);
    expect(SecureStore.__store.get(DEVICE_ID_KEY)).toBe(ids[0]);
    expect(callsFor(SecureStore.getItemAsync, DEVICE_ID_KEY)).toBe(1);
    expect(callsFor(SecureStore.setItemAsync, DEVICE_ID_KEY)).toBe(1);
  });

  test('returns the same in-memory ID when the store fails', async () => {
    SecureStore.getItemAsync.mockImplementationOnce(async () => {
      throw new Error('read failed');
    });

    await render(<DeviceProvider><Probe /></DeviceProvider>);
    const first = await ctx.getDeviceId();
    const second = await ctx.getDeviceId();

    expect(isUuidV4(first)).toBe(true);
    expect(second).toBe(first);
    expect(SecureStore.__store.has(DEVICE_ID_KEY)).toBe(false);
  });

  test('renders children before the Device_ID resolves', async () => {
    // Hold the store read open so resolution stays pending.
    let releaseRead;
    SecureStore.getItemAsync.mockImplementationOnce(
      () => new Promise((resolve) => { releaseRead = resolve; }),
    );

    await render(<DeviceProvider><Probe /></DeviceProvider>);

    expect(screen.getByText('child rendered')).toBeOnTheScreen();
    let settled = false;
    const pending = ctx.getDeviceId().then(() => { settled = true; });
    await flush();
    expect(settled).toBe(false);

    // Release the read so the 3 s timeout timer is cleared before the test ends.
    releaseRead(STORED_ID);
    await pending;
    expect(settled).toBe(true);
  });

  test('StrictMode does not double-delete or double-resolve', async () => {
    await render(
      <StrictMode>
        <DeviceProvider><Probe /></DeviceProvider>
      </StrictMode>,
    );
    const id = await ctx.getDeviceId();
    await flush();

    expect(isUuidV4(id)).toBe(true);
    expect(callsFor(SecureStore.deleteItemAsync, SESSION_KEY)).toBe(1);
    expect(callsFor(SecureStore.getItemAsync, DEVICE_ID_KEY)).toBe(1);
    expect(callsFor(SecureStore.setItemAsync, DEVICE_ID_KEY)).toBe(1);
  });
});

describe('useDevice', () => {
  test('throws outside DeviceProvider', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(render(<Probe />)).rejects.toThrow('useDevice must be used inside DeviceProvider');
    } finally {
      spy.mockRestore();
    }
  });
});
