import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { deviceId, deviceSessionId, workDayStorageKey } from '../lib/device.js';

export function PresenceHeartbeat() {
  const { user } = useAuth();

  useEffect(() => {
    let mounted = true;
    let sequence = 0;
    const key = workDayStorageKey(user.email);

    async function discoverWorkDay() {
      try {
        const { workDay } = await api('/api/work-days/current');
        if (workDay?.id) localStorage.setItem(key, workDay.id);
        else localStorage.removeItem(key);
        return workDay?.id || null;
      } catch { return localStorage.getItem(key); }
    }

    async function sync() {
      if (!mounted) return;
      const workDayId = localStorage.getItem(key) || await discoverWorkDay();
      sequence += 1;
      try {
        await api('/api/presence', { method: 'PUT', body: {
          deviceId: deviceId(), sessionId: deviceSessionId(), workDayId,
          clientSequence: sequence, disconnected: false,
        } });
      } catch { /* La jornada permanece en el servidor; el siguiente latido reintentará la conexión. */ }
    }

    const handleVisibility = () => { if (document.visibilityState === 'visible') sync(); };
    sync();
    const interval = window.setInterval(sync, 20_000);
    window.addEventListener('serendipia-presence-change', sync);
    window.addEventListener('serendipia-offline-flushed', discoverWorkDay);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener('serendipia-presence-change', sync);
      window.removeEventListener('serendipia-offline-flushed', discoverWorkDay);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user.email]);

  return null;
}
