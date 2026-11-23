import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Persistent key-value storage (the Device_Store).
// SecureStore does not exist on web, so fall back to localStorage there.
// SecureStore keys may only contain alphanumerics, ".", "-", and "_".
const isWeb = () => Platform.OS === 'web';

export const store = {
  get: async (key) => (isWeb() ? window.localStorage.getItem(key) : SecureStore.getItemAsync(key)),
  set: async (key, value) => {
    if (isWeb()) window.localStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  },
  del: async (key) => {
    if (isWeb()) window.localStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  },
};

// Resolves or rejects like `promise`, but rejects with { timeout: true } if it
// has not settled within `ms` milliseconds.
export function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject({ timeout: true }), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}
