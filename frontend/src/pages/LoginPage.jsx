import { LockKey, Moon, Sun, ShieldCheck } from '@phosphor-icons/react';
import { useState } from 'react';
import { Logo } from '../components/Logo.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { api } from '../lib/api.js';

export function LoginPage() {
  const { theme, toggle } = useTheme();
  const { refresh } = useAuth();
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function localLogin(event) {
    event.preventDefault();
    setSubmitting(true);
    setLoginError('');
    try {
      await api('/api/auth/local', { method: 'POST', body: credentials });
      await refresh();
    } catch (error) {
      setLoginError(error.message);
    } finally { setSubmitting(false); }
  }
  return (
    <main className="grid min-h-[100dvh] bg-zinc-50 dark:bg-zinc-950 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-zinc-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Logo />
        <div className="relative z-10 max-w-xl">
          <p className="mb-5 text-sm font-bold text-brand-300">REGISTRO DIGITAL DE JORNADA</p>
          <h1 className="text-5xl font-bold leading-[1.05] tracking-tight">Tu parte diario, listo antes de guardar el bolígrafo.</h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-zinc-300">Registra cada trabajo desde el móvil y mantén al equipo sincronizado directamente con Google Sheets.</p>
        </div>
        <div className="h-px bg-zinc-800" />
      </section>
      <section className="relative flex min-h-[100dvh] items-center justify-center px-4 py-10 sm:px-8">
        <button type="button" onClick={toggle} className="absolute right-4 top-4 flex size-12 cursor-pointer items-center justify-center rounded-xl border bg-white text-brand-700 transition hover:bg-zinc-100 focus:outline-none focus:ring-4 focus:ring-brand-400/25 dark:bg-zinc-950 dark:text-brand-400 dark:hover:bg-zinc-900" aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}>{theme === 'dark' ? <Sun size={23} weight="bold" /> : <Moon size={23} weight="bold" />}</button>
        <div className="w-full max-w-md">
          <div className="mb-9 lg:hidden"><Logo /></div>
          <p className="text-sm font-bold text-brand-700 dark:text-brand-300">BIENVENIDO</p>
          <h2 className="mt-3 text-4xl font-bold tracking-tight">Inicia sesión</h2>
          <p className="mt-3 text-base leading-relaxed text-zinc-600 dark:text-zinc-300">Accede con el usuario y la contraseña facilitados por Recursos Humanos.</p>
          <form onSubmit={localLogin} className="mt-8 space-y-4">
            <label><span className="label">Usuario</span><input className="field" autoComplete="username" value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} required /></label>
            <label><span className="label">Contraseña</span><input type="password" className="field" autoComplete="current-password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} minLength="4" required /></label>
            {loginError && <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">{loginError}</p>}
            <button type="submit" className="btn-primary w-full" disabled={submitting}><LockKey size={21} />{submitting ? 'Comprobando acceso' : 'Entrar'}</button>
          </form>
          <button type="button" className="btn-secondary mt-3 w-full" onClick={async () => { await api('/api/auth/demo', { method: 'POST' }); await refresh(); }}>Ver diseño sin iniciar sesión</button>
          <div className="mt-6 flex items-start gap-3 text-sm text-zinc-500 dark:text-zinc-400"><ShieldCheck className="mt-0.5 shrink-0 text-brand-700 dark:text-brand-400" size={21} /><p>Las contraseñas se almacenan cifradas mediante hash. La cuenta de servicio se utiliza únicamente para escribir en Google Sheets.</p></div>
        </div>
      </section>
    </main>
  );
}
