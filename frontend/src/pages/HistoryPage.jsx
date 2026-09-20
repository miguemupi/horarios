import { CalendarBlank, CaretDown, CheckCircle, MagnifyingGlass, NotePencil, Rows, Trash } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { EditDayDatePanel } from '../components/EditDayDatePanel.jsx';
import { EditRecordPanel } from '../components/EditRecordPanel.jsx';
import { Toast } from '../components/Toast.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api, queryString } from '../lib/api.js';
import { daysAgoDate, formatDuration, formatTime } from '../lib/time.js';

export function HistoryPage() {
  const { user } = useAuth();
  const canViewTeam = ['admin', 'manager'].includes(user.role);
  const canEdit = (row) => user.role === 'admin' || row.employeeUsername === (user.username || user.email) || row.employeeEmail === user.email;
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ businesses: [] });
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({ dateFrom: daysAgoDate(30), dateTo: '', employee: '', business: '' });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [movingDay, setMovingDay] = useState(null);
  const [saving, setSaving] = useState(false);
  const [movingDaySaving, setMovingDaySaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [deletingDay, setDeletingDay] = useState(null);
  const [signing, setSigning] = useState(null);
  const [toast, setToast] = useState(null);
  const [expandedParts, setExpandedParts] = useState(() => new Set());

  async function load(currentFilters = filters) {
    setLoading(true);
    try {
      const { rows: records } = await api(`/api/timesheets${queryString(currentFilters)}`);
      setRows(records);
    } catch (error) { setToast({ type: 'error', title: 'No se pudieron cargar los partes', message: error.message }); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    const requests = [api('/api/timesheets/meta')];
    if (canViewTeam) requests.push(api('/api/timesheets/employees'));
    Promise.all(requests).then(([metadata, directory]) => { setMeta(metadata); if (directory) setUsers(directory.users); });
    load();
  }, []);

  const totalMinutes = useMemo(() => rows.reduce((total, row) => total + row.totalHours, 0) * 60, [rows]);
  const parts = useMemo(() => {
    const grouped = new Map();
    rows.forEach((row) => {
      const key = row.workDayId || `${row.date}::${row.employeeUsername || row.employeeEmail || row.employeeName}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          date: row.date,
          employeeName: row.employeeName,
          employeeUsername: row.employeeUsername || row.employeeEmail,
          employeeRole: row.employeeRole,
          workDayId: row.workDayId,
          employeeSignature: row.employeeSignature,
          managerSignature: row.managerSignature,
          dayStart: row.dayStart,
          dayEnd: row.dayEnd,
          declaredHours: row.declaredHours ?? null,
          totalHours: 0,
          businesses: new Set(),
          entries: [],
        });
      }
      const part = grouped.get(key);
      part.entries.push(row);
      part.totalHours += Number(row.totalHours || 0);
      part.businesses.add(row.business);
    });
    return [...grouped.values()].map((part) => ({
      ...part,
      businesses: [...part.businesses],
      entries: part.entries.sort((a, b) => a.startTime.localeCompare(b.startTime)),
    }));
  }, [rows]);

  function togglePart(key) {
    setExpandedParts((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function saveEdit(form) {
    setSaving(true);
    try {
      const { row, storage } = await api(`/api/timesheets/${encodeURIComponent(editing.recordId)}`, { method: 'PATCH', body: form });
      setRows((current) => current.map((item) => item.recordId === row.recordId ? row : item));
      setEditing(null);
      setToast({ type: 'success', title: 'Tarea actualizada', message: storage === 'google-sheets-fallback' ? 'PostgreSQL no estaba disponible; la corrección se guardó directamente en Google Sheets.' : 'La corrección se ha guardado en PostgreSQL y pasará a Google Sheets en la exportación programada.' });
    } catch (error) { setToast({ type: 'error', title: 'No se pudo actualizar la fila', message: error.message }); }
    finally { setSaving(false); }
  }

  async function deleteTask(row) {
    const confirmed = window.confirm(`¿Eliminar la tarea «${row.work}» y sus horas?\n\nEsta acción no se puede deshacer.`);
    if (!confirmed) return;
    setDeleting(row.recordId);
    try {
      await api(`/api/timesheets/${encodeURIComponent(row.recordId)}`, { method: 'DELETE' });
      setRows((current) => current.filter((item) => item.recordId !== row.recordId));
      if (editing?.recordId === row.recordId) setEditing(null);
      setToast({ type: 'success', title: 'Horas eliminadas', message: 'La tarea se ha borrado de PostgreSQL y su fila se limpiará de Google Sheets en el próximo volcado.' });
    } catch (error) {
      setToast({ type: 'error', title: 'No se pudieron borrar las horas', message: error.message });
    } finally { setDeleting(null); }
  }

  async function saveDayDate({ date, correctionReason }) {
    setMovingDaySaving(true);
    try {
      const anchorRecordId = movingDay.entries[0].recordId;
      const { row } = await api(`/api/timesheets/${encodeURIComponent(anchorRecordId)}`, { method: 'PATCH', body: { date, correctionReason } });
      setRows((current) => current.map((item) => item.workDayId === movingDay.workDayId ? { ...item, date: row.date } : item));
      setMovingDay(null);
      setToast({ type: 'success', title: 'Día movido', message: `El parte de ${movingDay.employeeName} pasa al ${date}.` });
    } catch (error) {
      setToast({ type: 'error', title: 'No se pudo mover el día', message: error.message });
    } finally { setMovingDaySaving(false); }
  }

  async function deleteDay(part) {
    const confirmed = window.confirm(`¿Eliminar TODO el parte de ${part.employeeName} del ${part.date} (${part.entries.length} ${part.entries.length === 1 ? 'tarea' : 'tareas'})?\n\nEsta acción no se puede deshacer.`);
    if (!confirmed) return;
    setDeletingDay(part.workDayId);
    try {
      await api(`/api/timesheets/work-days/${encodeURIComponent(part.workDayId)}`, { method: 'DELETE' });
      setRows((current) => current.filter((item) => item.workDayId !== part.workDayId));
      if (editing?.workDayId === part.workDayId) setEditing(null);
      setToast({ type: 'success', title: 'Parte eliminado', message: `Se ha borrado el día completo de ${part.employeeName}.` });
    } catch (error) {
      setToast({ type: 'error', title: 'No se pudo borrar el parte', message: error.message });
    } finally { setDeletingDay(null); }
  }

  async function signPart(part, signed) {
    setSigning(part.workDayId);
    try {
      const result = await api(`/api/timesheets/work-days/${encodeURIComponent(part.workDayId)}/manager-signature`, { method: 'PATCH', body: { signed } });
      setRows((current) => current.map((row) => row.workDayId === part.workDayId ? { ...row, managerSignature: result.managerSignature } : row));
      setToast(signed
        ? { type: 'success', title: 'Parte firmado', message: `Has validado el parte de ${part.employeeName}.` }
        : { type: 'success', title: 'Firma retirada', message: `El parte de ${part.employeeName} vuelve a quedar pendiente.` });
    } catch (error) {
      setToast({ type: 'error', title: 'No se pudo actualizar la firma', message: error.message });
    } finally { setSigning(null); }
  }

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      {editing && <EditRecordPanel record={editing} businesses={meta.businesses} onSave={saveEdit} onClose={() => setEditing(null)} saving={saving} />}
      {movingDay && <EditDayDatePanel part={movingDay} onSave={saveDayDate} onClose={() => setMovingDay(null)} saving={movingDaySaving} />}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-bold text-brand-700 dark:text-brand-300">HISTORIAL</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{canViewTeam ? 'Todos los partes' : 'Mis partes'}</h1><p className="mt-2 text-zinc-600 dark:text-zinc-300">{user.demo ? 'Datos de ejemplo visibles únicamente para este usuario.' : canViewTeam ? user.role === 'admin' ? 'RR. HH. puede consultar, corregir y borrar horas de todo el equipo.' : 'Puedes consultar las tareas del equipo. Solo cada trabajador o RR. HH. puede corregirlas.' : 'Solo puedes ver y corregir tus propios registros.'}</p></div><div className="rounded-2xl border bg-white px-5 py-3 dark:bg-zinc-950"><p className="text-xs font-semibold text-zinc-500">RESULTADO</p><p className="mt-1 font-bold tabular-nums">{parts.length} partes · {rows.length} tareas · {formatDuration(totalMinutes)}</p></div></div>
      <form onSubmit={(event) => { event.preventDefault(); load(); }} className="panel mt-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
        <label><span className="label">Desde</span><input type="date" className="field" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} /></label>
        <label><span className="label">Hasta</span><input type="date" className="field" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} /></label>
        {canViewTeam && <label><span className="label">Empleado</span><select className="field" value={filters.employee} onChange={(event) => setFilters({ ...filters, employee: event.target.value })}><option value="">Todos</option>{users.map((item) => <option key={item.username || item.email} value={item.username || item.email}>{item.name}</option>)}</select></label>}
        <label><span className="label">Negocio</span><select className="field" value={filters.business} onChange={(event) => setFilters({ ...filters, business: event.target.value })}><option value="">Todos</option>{meta.businesses.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
        <button className="btn-primary self-end" type="submit"><MagnifyingGlass size={21} weight="bold" />Filtrar</button>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 sm:col-span-2 lg:col-span-5">Se muestran los últimos 30 días por defecto. Amplía el rango para editar partes más antiguos.</p>
      </form>

      <section className="mt-6">
        {loading ? <div className="panel h-64 animate-pulse bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-900" /> : rows.length === 0 ? <div className="panel px-6 py-14 text-center"><Rows className="mx-auto text-zinc-400" size={42} /><h2 className="mt-4 text-xl font-bold">No hay partes con estos filtros</h2><p className="mt-2 text-zinc-500 dark:text-zinc-400">Amplía el rango de fechas o cambia el negocio.</p></div> : <div className="space-y-4">
          {parts.map((part) => {
            const expanded = expandedParts.has(part.key);
            const canManagerSign = user.role === 'manager' && part.employeeRole === 'employee' && Boolean(part.workDayId);
            const detailId = `part-${part.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
            const dateLabel = new Date(`${part.date}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
            return <article key={part.key} className="panel overflow-hidden">
              <button type="button" className="group flex w-full cursor-pointer flex-col gap-4 p-5 text-left transition hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-inset focus:ring-brand-400/25 dark:hover:bg-zinc-900/70 sm:flex-row sm:items-center sm:justify-between sm:p-6" onClick={() => togglePart(part.key)} aria-expanded={expanded} aria-controls={detailId}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3"><span className="rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-brand-800 dark:bg-brand-400/15 dark:text-brand-300">{part.entries.length} {part.entries.length === 1 ? 'tarea' : 'tareas'}</span>{canViewTeam && <span className="truncate text-sm font-bold text-zinc-600 dark:text-zinc-300">{part.employeeName}</span>}{canManagerSign && <span className={`rounded-lg px-2.5 py-1 text-xs font-bold ${part.managerSignature ? 'bg-brand-100 text-brand-800 dark:bg-brand-400/15 dark:text-brand-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300'}`}>{part.managerSignature ? 'Firmado' : 'Pendiente de firma'}</span>}</div>
                  <h2 className="mt-3 text-lg font-bold capitalize sm:text-xl">{dateLabel}</h2>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400"><span className="tabular-nums">Jornada: {formatTime(part.dayStart)} a {formatTime(part.dayEnd)}</span><span aria-hidden="true"> · </span>{part.businesses.join(', ')}</p>
                </div>
                <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end">
                  <div className="sm:text-right"><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Total de tareas</p><p className="mt-1 whitespace-nowrap font-bold tabular-nums text-brand-800 dark:text-brand-300">{formatDuration(part.totalHours * 60)}</p>{part.declaredHours != null && <p className="mt-1 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">Declaradas: <span className="font-semibold tabular-nums">{part.declaredHours} h</span></p>}</div>
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 transition group-hover:bg-brand-100 dark:bg-zinc-800 dark:text-zinc-200 dark:group-hover:bg-brand-400/20"><CaretDown className={`transition-transform duration-200 motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} size={21} weight="bold" /></span>
                </div>
              </button>
              {user.role === 'admin' && part.workDayId && <div className="flex flex-wrap justify-end gap-3 border-t bg-zinc-50/70 px-4 py-3 dark:bg-black/20 sm:px-6"><button type="button" className="btn-secondary" onClick={() => setMovingDay(part)}><CalendarBlank size={20} weight="bold" />Editar día</button><button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 font-bold text-red-800 transition hover:bg-red-100 focus:outline-none focus:ring-4 focus:ring-red-400/25 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950" onClick={() => deleteDay(part)} disabled={deletingDay === part.workDayId}><Trash size={20} weight="bold" />{deletingDay === part.workDayId ? 'Borrando día…' : 'Eliminar día'}</button></div>}
              {canManagerSign && <div className="border-t bg-zinc-50/70 px-4 py-4 dark:bg-black/20 sm:px-6"><span className="label">Firma del encargado</span><label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border bg-white px-4 py-3 transition hover:border-brand-400 dark:bg-zinc-950"><input type="checkbox" className="size-5 accent-brand-400" checked={Boolean(part.managerSignature)} disabled={signing === part.workDayId} onChange={(event) => signPart(part, event.target.checked)} /><span className="text-sm">{signing === part.workDayId ? 'Guardando firma…' : part.managerSignature ? <><strong>{part.managerSignature}</strong> ha firmado este parte</> : <>Firmar el parte de <strong>{part.employeeName}</strong></>}</span>{part.managerSignature && <CheckCircle className="ml-auto shrink-0 text-brand-700 dark:text-brand-300" size={23} weight="fill" />}</label></div>}
              {expanded && <div id={detailId} className="border-t bg-zinc-50/70 p-4 dark:bg-black/20 sm:p-6">
                <h3 className="sr-only">Tareas del {dateLabel}</h3>
                <ol className="space-y-3">{part.entries.map((row, index) => <li key={row.recordId} className="rounded-2xl border bg-white p-4 dark:bg-zinc-950 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">TAREA {index + 1}</span><span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold dark:bg-zinc-800">{row.business}</span>{row.overtime && <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">Horas extra</span>}</div><p className="mt-3 leading-relaxed">{row.work}</p></div>
                    <div className="shrink-0 sm:text-right"><p className="whitespace-nowrap text-sm font-semibold tabular-nums">{formatTime(row.startTime)} a {formatTime(row.endTime)}</p><p className="mt-1 whitespace-nowrap text-sm font-bold tabular-nums text-brand-800 dark:text-brand-300">{formatDuration(row.totalHours * 60)}</p></div>
                  </div>
                  {canEdit(row) && <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row">
                    <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => setEditing(row)}><NotePencil size={20} />Editar tarea</button>
                    {user.role === 'admin' && <button type="button" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 font-bold text-red-800 transition hover:bg-red-100 focus:outline-none focus:ring-4 focus:ring-red-400/25 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950 sm:w-auto" onClick={() => deleteTask(row)} disabled={deleting === row.recordId}><Trash size={20} weight="bold" />{deleting === row.recordId ? 'Borrando…' : 'Borrar horas'}</button>}
                  </div>}
                </li>)}</ol>
              </div>}
            </article>;
          })}
        </div>}
      </section>
    </>
  );
}
