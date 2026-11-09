import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api } from './api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null); // { token, user }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync('session');
        if (raw) {
          const saved = JSON.parse(raw);
          try {
            const { user } = await api('/auth/me', { token: saved.token });
            setSession({ token: saved.token, user });
          } catch (e) {
            // Keep the saved login if we are only offline, so SOS still works
            if (e.offline) setSession(saved);
            else await SecureStore.deleteItemAsync('session');
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function authenticate(path, body) {
    const data = await api(path, { method: 'POST', body });
    if (data.user.role !== 'user') throw new Error('Staff accounts use the web dashboard');
    await SecureStore.setItemAsync('session', JSON.stringify(data));
    setSession(data);
  }

  const value = {
    user: session?.user,
    token: session?.token,
    loading,
    login: (email, password) => authenticate('/auth/login', { email, password }),
    register: (form) => authenticate('/auth/register', form),
    logout: async () => { await SecureStore.deleteItemAsync('session'); setSession(null); },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
