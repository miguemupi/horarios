import { ArrowClockwise, CheckCircle, Clock, Power, UserFocus, UsersThree, Warning } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Toast } from '../components/Toast.jsx';
import { api } from '../lib/api.js';
import { formatTime } from '../lib/time.js';
import { useAuth } from '../context/AuthContext.jsx';

const statusContent = {
  working: { label: 'Jornada activa', style: 'border-brand-300 bg-brand-50 text-brand-900 dark:border-brand-800 dark:bg-brand-950/60 dark:text-brand-200' },
  between_tasks: { label: 'Jornada activa · entre tareas', style: 'border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200' },
  planned: { label: 'Tarea planificada', style: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200' },
  offline: { label: 'Sin jornada activa', style: 'border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300' },
};

function lastContactLabel(seconds) {
  if (seconds == null) return 'Sin contacto registrado';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'Último contacto hace menos de 1 minuto';
  return `Último contacto hace ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
}

export function TeamStatusPage() {
  const { user } = useAuth();
  const [members, setMembers] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [disconnecting, setDisconnecting] = useState('');

  async function load(showLoader = false) {
    if (showLoader) setLoading(true);
    try {
      const [data, incidentData] = await Promise.all([api('/api/presence'), api('/api/incidents')]);
      setMembers(data.members);
      setIncidents(incidentData.incidents);
    } catch (error) {
      setToast({ type: 'error', title: 'No se pudo consultar el equipo', message: error.message });
    } finally { setLoading(false); }
  }

  useEffect(() => {
    load(true);
    const interval = window.setInterval(() => load(false), 60_000);
    const stream = new EventSource('/api/presence/stream', { withCredentials: true });
    stream.addEventListener('change', () => load(false));
    return () => { window.clearInterval(interval); stream.close(); };
  }, []);

  async function disconnect(member) {
    if (!window.confirm(`¿Marcar a ${member.name} como desconectado?`)) return;
    setDisconnecting(member.email);
    try {
      await api(`/api/presence/${encodeURIComponent(member.email)}`, { method: 'DELETE' });
      setMembers((current) => current.map((item) => item.email === member.email ? { ...item, connectionState: 'offline', connectionFresh: false, deviceCount: 0 } : item));
      setToast({ type: 'success', title: 'Conexiones descartadas', message: `La jornada de ${member.name} se conserva, pero sus conexiones anteriores ya no figuran como activas.` });
    } catch (error) { setToast({ type: 'error', title: 'No se pudo corregir el estado', message: error.message }); }
    finally { setDisconnecting(''); }
  }

  async function resolveIncident(incident) {
    try {
      await api(`/api/incidents/${incident.id}`, { method: 'PATCH', body: { status: 'resolved', note: 'Revisada desde el panel de equipo.' } });
      setIncidents((current) => current.filter((item) => item.id !== incident.id));
      setToast({ type: 'success', title: 'Incidencia revisada', message: 'Marcar como revisada no cambia horas por sí sola; corrige el parte desde el historial si hace falta.' });
    } catch (error) { setToast({ type: 'error', title: 'No se pudo resolver', message: error.message }); }
  }

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-sm font-bold text-brand-700 dark:text-brand-300">EQUIPO EN DIRECTO</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Estado del equipo</h1><p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">Consulta todo el equipo y el estado actual de la jornada de cada persona.</p></div>
        <button type="button" onClick={() => load(true)} className="btn-secondary" disabled={loading}><ArrowClockwise size={20} className={loading ? 'animate-spin motion-reduce:animate-none' : ''} />Actualizar</button>
      </div>

      <section className="mt-6">
        {loading && members.length === 0 ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="panel h-44 animate-pulse bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-900" />)}</div> : members.length === 0 ? <div className="panel px-6 py-14 text-center"><UsersThree className="mx-auto text-zinc-400" size={44} /><h2 className="mt-4 text-xl font-bold">No hay personas en el equipo</h2><p className="mt-2 text-zinc-500 dark:text-zinc-400">RR. HH. puede añadirlas desde Administración.</p></div> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{members.map((member) => {
          const content = statusContent[member.status];
          return <article key={member.email} className="panel p-5"><div className="flex items-start gap-4"><div className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${member.status === 'working' ? 'bg-brand-100 text-brand-800 dark:bg-brand-400/15 dark:text-brand-300' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400'}`}>{member.status === 'working' ? <UserFocus size={25} weight="duotone" /> : <Clock size={25} weight="duotone" />}</div><div className="min-w-0 flex-1"><h2 className="truncate text-lg font-bold">{member.name}</h2><p className="truncate text-sm text-zinc-500 dark:text-zinc-400">{member.role === 'manager' ? 'Jefe' : 'Trabajador'}</p></div></div><div className={`mt-5 rounded-xl border px-4 py-3 ${content.style}`}><p className="font-bold">{content.label}</p>{member.status !== 'offline' && <><p className="mt-1 text-sm">{member.status === 'planned' ? `Comienza a las ${formatTime(member.taskStart)}` : member.activeTask ? `Tarea actual desde las ${formatTime(member.taskStart)} · Jornada desde las ${formatTime(member.dayStart)}` : `Entre tareas · Jornada desde las ${formatTime(member.dayStart)}`}</p><p className="mt-2 text-xs opacity-70">{member.connectionState !== 'online' && 'Móvil sin conexión reciente. '}{lastContactLabel(member.secondsSinceLastSeen)}{member.connectionState === 'online' ? ` · ${member.deviceCount || 1} dispositivo(s).` : '.'}</p></>}</div>{member.status !== 'offline' && <button type="button" className="btn-secondary mt-3 min-h-10 w-full py-2 text-sm" disabled={disconnecting === member.email} onClick={() => disconnect(member)}><Power size={18} />{disconnecting === member.email ? 'Desconectando' : 'Descartar conexiones'}</button>}</article>;
        })}</div>}
      </section>

      <section className="mt-8">
        <div className="flex items-center gap-3"><Warning className="text-amber-600 dark:text-amber-400" size={25} /><div><h2 className="text-xl font-bold">Incidencias para revisar</h2><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Las jornadas olvidadas se cierran solas a las 22:00 y quedan aquí para revisión; la aplicación nunca inventa el negocio ni la descripción de una tarea abandonada.</p></div></div>
        {incidents.length === 0 ? <div className="panel mt-4 flex items-center gap-3 p-5"><CheckCircle className="text-brand-700 dark:text-brand-300" size={24} /><p className="font-semibold">No hay incidencias abiertas.</p></div> : <div className="mt-4 grid gap-4 sm:grid-cols-2">{incidents.map((incident) => <article className="panel p-5" key={incident.id}><p className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">{incident.type.replaceAll('_', ' ')}</p><h3 className="mt-2 font-bold">{incident.employeeName}</h3><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{incident.date}</p>{user.role === 'admin' && <button type="button" className="btn-secondary mt-4 w-full py-2 text-sm" onClick={() => resolveIncident(incident)}><CheckCircle size={18} />Marcar revisada</button>}</article>)}</div>}
      </section>
    </>
  );
}
