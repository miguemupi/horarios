import { Buildings, CheckCircle, FileXls, FloppyDisk, Plus, SlidersHorizontal, Trash, UsersThree } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Toast } from '../components/Toast.jsx';
import { AdminDashboard } from '../components/AdminDashboard.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';

export function AdminPage() {
  const { user: currentUser } = useAuth();
  const [config, setConfig] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', username: '', password: '', role: 'employee', active: true });
  const [newBusiness, setNewBusiness] = useState({ name: '', active: true });

  const load = () => api('/api/admin/config').then(setConfig);
  useEffect(() => { load().catch((error) => setToast({ type: 'error', title: 'No se pudo cargar la configuración', message: error.message })); }, []);

  async function action(operation, success) {
    setBusy(true);
    try { await operation(); await load(); setToast({ type: 'success', title: success, message: 'Los cambios ya están activos.' }); }
    catch (error) { setToast({ type: 'error', title: 'No se pudo guardar', message: error.message }); }
    finally { setBusy(false); }
  }

  if (!config) return <div className="panel h-96 animate-pulse bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-900" />;
  const updateSettings = (field, value) => setConfig((current) => ({ ...current, settings: { ...current.settings, [field]: value } }));
  const updateSheet = (field, value) => setConfig((current) => ({ ...current, settings: { ...current.settings, sheets: { ...current.settings.sheets, [field]: value } } }));
  const updateUserDraft = (email, changes) => setConfig((current) => ({ ...current, users: current.users.map((item) => item.email === email ? { ...item, ...changes } : item) }));
  const updateBusinessDraft = (id, changes) => setConfig((current) => ({ ...current, businesses: current.businesses.map((item) => item.id === id ? { ...item, ...changes } : item) }));
  const removeUser = (item) => {
    if (!window.confirm(`¿Eliminar a ${item.name}? Sus partes históricos se conservarán en Google Sheets.`)) return;
    action(() => api(`/api/admin/users/${encodeURIComponent(item.email)}`, { method: 'DELETE' }), 'Usuario eliminado');
  };
  const removeBusiness = (item) => {
    if (!window.confirm(`¿Eliminar el negocio “${item.name}”? Los partes históricos se conservarán.`)) return;
    action(() => api(`/api/admin/businesses/${item.id}`, { method: 'DELETE' }), 'Negocio eliminado');
  };

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <div><p className="text-sm font-bold text-brand-700 dark:text-brand-300">RECURSOS HUMANOS</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Control y configuración</h1><p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">Revisa la actividad, exporta datos y administra personas, negocios y Google Sheets.</p></div>
      <AdminDashboard onToast={setToast} />
      <div className="mt-7 grid gap-6 xl:grid-cols-2">
        <section className="panel p-5 sm:p-6">
          <div className="flex items-center gap-3"><UsersThree className="text-brand-700 dark:text-brand-300" size={27} /><h2 className="text-xl font-bold">Usuarios autorizados</h2></div>
          <form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); action(() => api('/api/admin/users', { method: 'POST', body: newUser }), 'Usuario añadido'); setNewUser({ name: '', username: '', password: '', role: 'employee', active: true }); }}>
            <label><span className="label">Nombre completo</span><input className="field" value={newUser.name} onChange={(event) => setNewUser({ ...newUser, name: event.target.value })} autoComplete="off" required /></label>
            <label><span className="label">Nombre de usuario</span><input className="field" value={newUser.username} onChange={(event) => setNewUser({ ...newUser, username: event.target.value.toLowerCase() })} autoComplete="off" placeholder="Por ejemplo: antonio" pattern="[a-z0-9._-]+" required /></label>
            <label><span className="label">Contraseña inicial</span><input type="password" className="field" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} autoComplete="new-password" minLength="12" required /><span className="mt-1.5 block text-xs text-zinc-500 dark:text-zinc-400">Mínimo 12 caracteres; deberá cambiarla al entrar.</span></label>
            <label><span className="label">Rol</span><select className="field" value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}><option value="employee">Trabajador</option><option value="manager">Jefe</option><option value="admin">Administrador (RR. HH.)</option></select></label>
            <button className="btn-primary sm:col-span-2 sm:justify-self-start" disabled={busy}><Plus size={20} />Añadir usuario</button>
          </form>
          <div className="mt-6 space-y-3">{config.users.map((item) => <div key={item.email} className="rounded-xl border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="label">Nombre completo</span><input className="field min-h-11 py-2 text-sm" value={item.name} disabled={busy} onChange={(event) => updateUserDraft(item.email, { name: event.target.value })} /></label>
              <label><span className="label">Usuario</span><input className="field min-h-11 py-2 text-sm" value={item.username || ''} disabled readOnly /></label>
              <label><span className="label">Nueva contraseña</span><input type="password" className="field min-h-11 py-2 text-sm" value={item.password || ''} disabled={busy} onChange={(event) => updateUserDraft(item.email, { password: event.target.value })} autoComplete="new-password" minLength="4" placeholder="Dejar vacía para conservarla" /></label>
              <label><span className="label">Rol</span><select className="field min-h-11 py-2 text-sm" value={item.role} disabled={busy} onChange={(event) => updateUserDraft(item.email, { role: event.target.value })}><option value="employee">Trabajador</option><option value="manager">Jefe</option><option value="admin">Administrador (RR. HH.)</option></select></label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4"><button type="button" className="btn-primary min-h-11 py-2 text-sm" disabled={busy} onClick={() => action(() => api(`/api/admin/users/${encodeURIComponent(item.email)}`, { method: 'PUT', body: { name: item.name, role: item.role, ...(item.password ? { password: item.password } : {}) } }), 'Usuario actualizado')}><FloppyDisk size={18} />Guardar</button><button type="button" className="btn-secondary min-h-11 py-2 text-sm" disabled={busy} onClick={() => action(() => api(`/api/admin/users/${encodeURIComponent(item.email)}`, { method: 'PUT', body: { active: !item.active } }), item.active ? 'Usuario desactivado' : 'Usuario activado')}>{item.active ? 'Desactivar' : 'Activar'}</button><button type="button" className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-300 px-4 py-2 text-sm font-bold text-red-700 transition hover:bg-red-50 focus:outline-none focus:ring-4 focus:ring-red-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40" disabled={busy || item.email === currentUser.email} title={item.email === currentUser.email ? 'No puedes eliminar tu propia cuenta' : undefined} onClick={() => removeUser(item)}><Trash size={18} />Eliminar</button></div>
          </div>)}</div>
        </section>

        <section className="panel p-5 sm:p-6">
          <div className="flex items-center gap-3"><Buildings className="text-brand-700 dark:text-brand-300" size={27} /><h2 className="text-xl font-bold">Negocios</h2></div>
          <form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); action(() => api('/api/admin/businesses', { method: 'POST', body: newBusiness }), 'Negocio añadido'); setNewBusiness({ name: '', active: true }); }}><label className="flex-1"><span className="label">Nombre del negocio</span><input className="field" value={newBusiness.name} onChange={(event) => setNewBusiness({ ...newBusiness, name: event.target.value })} required /></label><button className="btn-primary self-end" disabled={busy}><Plus size={20} />Añadir</button></form>
          <div className="mt-6 space-y-3">{config.businesses.map((item) => <div key={item.id} className="rounded-xl border p-4"><label><span className="label">Nombre del negocio</span><input className="field min-h-11 py-2 text-sm" value={item.name} disabled={busy} onChange={(event) => updateBusinessDraft(item.id, { name: event.target.value })} /></label><div className="mt-4 flex flex-wrap gap-2 border-t pt-4"><button type="button" className="btn-primary min-h-11 py-2 text-sm" disabled={busy} onClick={() => action(() => api(`/api/admin/businesses/${item.id}`, { method: 'PUT', body: { name: item.name } }), 'Nombre del negocio actualizado')}><FloppyDisk size={18} />Guardar nombre</button><button type="button" className="btn-secondary min-h-11 py-2 text-sm" disabled={busy} onClick={() => action(() => api(`/api/admin/businesses/${item.id}`, { method: 'PUT', body: { active: !item.active } }), item.active ? 'Negocio desactivado' : 'Negocio activado')}>{item.active ? 'Desactivar' : 'Activar'}</button><button type="button" className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-300 px-4 py-2 text-sm font-bold text-red-700 transition hover:bg-red-50 focus:outline-none focus:ring-4 focus:ring-red-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40" disabled={busy} onClick={() => removeBusiness(item)}><Trash size={18} />Eliminar</button></div></div>)}</div>
        </section>

        <section className="panel p-5 sm:p-6 xl:col-span-2">
          <div className="flex items-center gap-3"><SlidersHorizontal className="text-brand-700 dark:text-brand-300" size={27} /><h2 className="text-xl font-bold">Google Sheets</h2></div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2"><label><span className="label">Spreadsheet ID</span><input className="field font-mono text-sm" value={config.settings.spreadsheetId} onChange={(event) => updateSettings('spreadsheetId', event.target.value)} /></label><label><span className="label">Zona horaria</span><input className="field" value={config.settings.timezone} onChange={(event) => updateSettings('timezone', event.target.value)} /></label><label><span className="label">Hoja donde se vuelcan los partes</span><input className="field" value={config.settings.sheets.detail} onChange={(event) => updateSheet('detail', event.target.value)} placeholder="Datos Diarios" required /><span className="mt-1.5 block text-xs text-zinc-500 dark:text-zinc-400">Puedes cambiar aquí la pestaña de destino del documento.</span></label><label><span className="label">Pestaña de resumen diario</span><input className="field" value={config.settings.sheets.dailySummary} onChange={(event) => updateSheet('dailySummary', event.target.value)} /></label><label><span className="label">Pestaña de resumen por negocio</span><input className="field" value={config.settings.sheets.businessSummary} onChange={(event) => updateSheet('businessSummary', event.target.value)} /></label></div>
          <div className="mt-6 flex flex-col gap-3 border-t pt-5 sm:flex-row"><button type="button" className="btn-primary" disabled={busy} onClick={() => action(() => api('/api/admin/settings', { method: 'PUT', body: config.settings }), 'Configuración guardada')}><CheckCircle size={21} />Guardar configuración</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => action(() => api('/api/admin/initialize-sheet', { method: 'POST' }), 'Pestañas preparadas')}><FileXls size={21} />Crear o verificar pestañas</button></div>
        </section>
      </div>
    </>
  );
}
