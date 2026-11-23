import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api } from './api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

// SecureStore does not exist on web, so fall back to localStorage there
const store = {
  get: async (k) => (Platform.OS === 'web' ? window.localStorage.getItem(k) : SecureStore.getItemAsync(k)),
  set: async (k, v) => (Platform.OS === 'web' ? window.localStorage.setItem(k, v) : SecureStore.setItemAsync(k, v)),
  del: async (k) => (Platform.OS === 'web' ? window.localStorage.removeItem(k) : SecureStore.deleteItemAsync(k)),
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null); // { token, user }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await store.get('session');
        if (raw) {
          const saved = JSON.parse(raw);
          try {
            const { user } = await api('/auth/me', { token: saved.token });
            setSession({ token: saved.token, user });
          } catch (e) {
            // Keep the saved login if we are only offline, so SOS still works
            if (e.offline) setSession(saved);
            else await store.del('session');
          }
        }
      } catch {
        // ignore storage errors, user just logs in again
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function authenticate(path, body) {
    const data = await api(path, { method: 'POST', body });
    if (data.user.role !== 'user') throw new Error('Staff accounts use the web dashboard');
    await store.set('session', JSON.stringify(data));
    setSession(data);
  }

  const value = {
    user: session?.user,
    token: session?.token,
    loading,
    login: (email, password) => authenticate('/auth/login', { email, password }),
    register: (form) => authenticate('/auth/register', form),
    logout: async () => { await store.del('session'); setSession(null); },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}