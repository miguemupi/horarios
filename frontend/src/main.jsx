import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AppLayout } from './components/AppLayout.jsx';
import { LoadingScreen } from './components/LoadingScreen.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { RouterProvider, useRouter } from './context/RouterContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { AdminPage } from './pages/AdminPage.jsx';
import { HistoryPage } from './pages/HistoryPage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { TimesheetPage } from './pages/TimesheetPage.jsx';
import { TeamStatusPage } from './pages/TeamStatusPage.jsx';
import './index.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'offline-flushed') window.dispatchEvent(new CustomEvent('serendipia-offline-flushed', { detail: event.data }));
  });
}

function AppRoutes() {
  const { user } = useAuth();
  const { path, navigate } = useRouter();
  const canViewTeam = ['admin', 'manager'].includes(user?.role);
  const authorizedPath = path === '/' || path === '/partes' || (path === '/equipo' && canViewTeam) || (path === '/admin' && user?.role === 'admin');
  useEffect(() => {
    if (user?.role === 'admin' && path === '/') navigate('/equipo', true);
    else if (user && !authorizedPath) navigate('/', true);
  }, [authorizedPath, navigate, path, user]);
  if (user === undefined) return <LoadingScreen />;
  if (!user) return <LoginPage />;
  let page = user.role === 'admin' ? <TeamStatusPage /> : <TimesheetPage />;
  if (path === '/partes') page = <HistoryPage />;
  else if (path === '/equipo' && canViewTeam) page = <TeamStatusPage />;
  else if (path === '/admin' && user.role === 'admin') page = <AdminPage />;
  return <AppLayout>{page}</AppLayout>;
}

createRoot(document.getElementById('root')).render(<StrictMode><ThemeProvider><AuthProvider><RouterProvider><AppRoutes /></RouterProvider></AuthProvider></ThemeProvider></StrictMode>);
