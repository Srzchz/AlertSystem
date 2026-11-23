import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as SMS from 'expo-sms';
import NetInfo from '@react-native-community/netinfo';
import { io } from 'socket.io-client';
import fc from 'fast-check';

describe('Jest setup and native mocks', () => {
  test('expo-secure-store keeps values in memory', async () => {
    await SecureStore.setItemAsync('deviceId', 'abc');
    expect(await SecureStore.getItemAsync('deviceId')).toBe('abc');
    await SecureStore.deleteItemAsync('deviceId');
    expect(await SecureStore.getItemAsync('deviceId')).toBeNull();
  });

  test('expo-crypto fills a byte array with random values', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 64 }), (n) => {
        const bytes = Crypto.getRandomValues(new Uint8Array(n));
        return bytes instanceof Uint8Array && bytes.length === n;
      }),
      { numRuns: 100 },
    );
  });

  test('expo-sms and netinfo resolve to available / online', async () => {
    expect(await SMS.isAvailableAsync()).toBe(true);
    const state = await NetInfo.fetch();
    expect(state.isConnected).toBe(true);
  });

  test('socket.io-client records handshake options and delivers events', () => {
    const socket = io('http://server', { auth: { deviceId: 'd1' } });
    expect(io).toHaveBeenCalledWith('http://server', { auth: { deviceId: 'd1' } });
    const handler = jest.fn();
    socket.on('incident:update', handler);
    socket.__serverEmit('incident:update', { _id: 'x', status: 'ACKNOWLEDGED' });
    expect(handler).toHaveBeenCalledWith({ _id: 'x', status: 'ACKNOWLEDGED' });
  });
});
