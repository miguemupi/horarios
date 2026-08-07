import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { deviceId, deviceSessionId } from '../lib/device.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  useEffect(() => { api('/api/auth/me').then(({ user: current }) => setUser(current)).catch(() => setUser(null)); }, []);
  const value = useMemo(() => ({
    user,
    refresh: () => api('/api/auth/me').then(({ user: current }) => setUser(current)),
    changePassword: async (currentPassword, newPassword) => {
      const { user: current } = await api('/api/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      setUser(current);
      return current;
    },
    logout: async () => {
      try { await api('/api/presence', { method: 'PUT', body: { deviceId: deviceId(), sessionId: deviceSessionId(), clientSequence: Date.now(), disconnected: true } }); } catch { /* La conexión caduca automáticamente. */ }
      await api('/api/auth/logout', { method: 'POST' });
      setUser(null);
    },
  }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
