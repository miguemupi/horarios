import { CloudCheck, CloudSlash } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { flushCommands } from '../lib/offline-store.js';

export function ConnectivityStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [recovered, setRecovered] = useState(false);
  useEffect(() => {
    const connected = async () => {
      setOnline(true);
      const processed = await flushCommands().catch(() => 0);
      if (processed) { setRecovered(true); window.setTimeout(() => setRecovered(false), 5000); }
    };
    const disconnected = () => setOnline(false);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    if (navigator.onLine) connected();
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); };
  }, []);
  if (online && !recovered) return null;
  return <div className={`border-b px-4 py-2.5 text-center text-sm font-semibold ${online ? 'border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-200' : 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100'}`} role="status">{online ? <><CloudCheck className="mr-2 inline" size={18} />Cambios pendientes sincronizados</> : <><CloudSlash className="mr-2 inline" size={18} />Sin conexión · el borrador continúa protegido en este dispositivo</>}</div>;
}
