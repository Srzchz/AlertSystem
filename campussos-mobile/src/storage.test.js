import * as SecureStore from 'expo-secure-store';
import { store, withTimeout } from './storage';

beforeEach(() => SecureStore.__reset());

describe('store (native)', () => {
  it('sets, gets, and deletes a value through SecureStore', async () => {
    expect(await store.get('deviceId')).toBeNull();
    await store.set('deviceId', 'abc');
    expect(await store.get('deviceId')).toBe('abc');
    await store.del('deviceId');
    expect(await store.get('deviceId')).toBeNull();
  });

  it('passes SecureStore errors through to the caller', async () => {
    SecureStore.getItemAsync.mockRejectedValueOnce(new Error('boom'));
    await expect(store.get('deviceId')).rejects.toThrow('boom');
  });
});

describe('withTimeout', () => {
  afterEach(() => jest.useRealTimers());

  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 100)).resolves.toBe(42);
  });

  it('passes through rejections from the promise', async () => {
    await expect(withTimeout(Promise.reject(new Error('nope')), 100)).rejects.toThrow('nope');
  });

  it('rejects with { timeout: true } after ms', async () => {
    jest.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 3000);
    jest.advanceTimersByTime(3000);
    await expect(p).rejects.toEqual({ timeout: true });
  });
});
