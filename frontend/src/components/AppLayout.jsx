import { ClipboardText, ClockCounterClockwise, GearSix, SignOut, UsersThree } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext.jsx';
import { AppLink } from '../context/RouterContext.jsx';
import { Logo } from './Logo.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';
import { PresenceHeartbeat } from './PresenceHeartbeat.jsx';
import { PasswordChangePanel } from './PasswordChangePanel.jsx';
import { ConnectivityStatus } from './ConnectivityStatus.jsx';

const navClass = ({ isActive }) => `flex min-h-12 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-4 focus:ring-brand-400/20 ${isActive ? 'bg-brand-50 text-brand-800 dark:bg-brand-400/15 dark:text-brand-300' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900'}`;

export function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const canViewTeam = ['admin', 'manager'].includes(user.role);
  const canCreateTimesheet = user.role !== 'admin';
  const historyLabel = canViewTeam ? 'Todos los partes' : 'Mis partes';
  const mobileColumns = ['admin', 'manager'].includes(user.role) ? 'grid-cols-3' : 'grid-cols-2';
  const homePath = user.role === 'admin' ? '/equipo' : '/';
  return (
    <div className="min-h-[100dvh] bg-zinc-50 dark:bg-zinc-950">
      <PresenceHeartbeat />
      {user.mustChangePassword && <PasswordChangePanel />}
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-brand-400 focus:px-4 focus:py-3 focus:font-bold focus:text-zinc-950">Saltar al contenido</a>
      <header className="sticky top-0 z-40 border-b bg-zinc-50/95 backdrop-blur dark:bg-zinc-950/95">
        <div className="mx-auto flex h-20 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <AppLink to={homePath} aria-label={user.role === 'admin' ? 'Ir al estado del equipo' : 'Ir al nuevo parte'}><Logo compact /></AppLink>
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Sesión activa</p><p className="truncate font-bold">Hola, {user.name}</p></div>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Navegación principal">
            {canCreateTimesheet && <AppLink to="/" end className={navClass}><ClipboardText size={21} />Nuevo parte</AppLink>}
            {canViewTeam && <AppLink to="/equipo" className={navClass}><UsersThree size={21} />Equipo</AppLink>}
            <AppLink to="/partes" className={navClass}><ClockCounterClockwise size={21} />{historyLabel}</AppLink>
            {user.role === 'admin' && <AppLink to="/admin" className={navClass}><GearSix size={21} />Administración</AppLink>}
          </nav>
          <ThemeToggle />
          <button type="button" onClick={logout} className="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border bg-white transition hover:bg-zinc-100 focus:outline-none focus:ring-4 focus:ring-brand-400/25 dark:bg-zinc-950 dark:hover:bg-zinc-900" aria-label="Cerrar sesión"><SignOut size={22} /></button>
        </div>
      </header>
      <ConnectivityStatus />
      {user.demo && <div className="border-b border-brand-200 bg-brand-50 px-4 py-2.5 text-center text-sm font-semibold text-brand-900 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-200" role="status">Modo demostración: puedes explorar y simular acciones, pero no se modifica Google Sheets.</div>}
      <main id="contenido" className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 md:pb-10 md:pt-8">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur dark:bg-zinc-950/95 md:hidden" aria-label="Navegación móvil">
        <div className={`mx-auto grid max-w-lg ${mobileColumns} gap-2`}>
          {canCreateTimesheet && <AppLink to="/" end className={navClass}><ClipboardText size={22} /><span>Nuevo</span></AppLink>}
          {canViewTeam && <AppLink to="/equipo" className={navClass}><UsersThree size={22} /><span>Equipo</span></AppLink>}
          <AppLink to="/partes" className={navClass}><ClockCounterClockwise size={22} /><span>{canViewTeam ? 'Partes' : 'Mis partes'}</span></AppLink>
          {user.role === 'admin' && <AppLink to="/admin" className={navClass}><GearSix size={22} /><span>Admin</span></AppLink>}
        </div>
      </nav>
    </div>
  );
}
