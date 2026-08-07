import { ArrowClockwise, ChartBar, Clock, CloudArrowUp, DownloadSimple, ListChecks, UsersThree } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { api, queryString } from '../lib/api.js';
import { currentDate, daysAgoDate, formatDuration } from '../lib/time.js';

function Metric({ label, value, detail, icon: Icon, featured = false }) {
  return (
    <div className={featured ? 'rounded-2xl bg-zinc-950 p-5 text-white dark:bg-white dark:text-zinc-950 sm:col-span-2 sm:p-6' : 'rounded-2xl border bg-zinc-50 p-5 dark:bg-zinc-950'}>
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-wide opacity-60">{label}</p><p className={`${featured ? 'text-3xl sm:text-4xl' : 'text-2xl'} mt-3 font-bold tabular-nums`}>{value}</p>{detail && <p className="mt-2 text-sm opacity-65">{detail}</p>}</div>
        <Icon size={featured ? 30 : 25} weight="duotone" className={featured ? 'text-brand-300 dark:text-brand-700' : 'text-brand-700 dark:text-brand-300'} />
      </div>
    </div>
  );
}

function Ranking({ title, rows, empty }) {
  const max = Math.max(1, ...rows.map((row) => row.totalSeconds));
  return (
    <section className="rounded-2xl border p-5 sm:p-6">
      <h3 className="font-bold">{title}</h3>
      {rows.length === 0 ? <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">{empty}</p> : <ol className="mt-5 space-y-5">
        {rows.slice(0, 8).map((row) => <li key={row.username || row.name}>
          <div className="flex items-end justify-between gap-4 text-sm"><span className="min-w-0 truncate font-semibold">{row.name}</span><span className="shrink-0 font-bold tabular-nums">{formatDuration(row.totalSeconds / 60)}</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true"><div className="h-full rounded-full bg-brand-400" style={{ width: `${Math.max(2, row.totalSeconds / max * 100)}%` }} /></div>
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{row.tasks} tareas en {row.work_days} jornadas</p>
        </li>)}
      </ol>}
    </section>
  );
}

function DailyChart({ rows }) {
  const visible = rows.slice(-31);
  const max = Math.max(1, ...visible.map((row) => row.totalSeconds));
  return (
    <section className="rounded-2xl border p-5 sm:p-6 lg:col-span-2">
      <div><h3 className="font-bold">Actividad diaria</h3><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Últimos {visible.length} días con registros dentro del rango.</p></div>
      {visible.length === 0 ? <div className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400"><ChartBar className="mx-auto mb-3" size={34} />No hay actividad en estas fechas.</div> : <div className="mt-6 flex h-44 items-end gap-1.5 overflow-hidden" aria-label="Horas registradas por día">
        {visible.map((row) => <div key={row.date} className="group relative flex min-w-2 flex-1 items-end self-stretch" title={`${row.date}: ${formatDuration(row.totalSeconds / 60)}`}>
          <div className="w-full rounded-t bg-brand-400 transition-colors group-hover:bg-brand-300" style={{ height: `${Math.max(3, row.totalSeconds / max * 100)}%` }} />
          <span className="sr-only">{row.date}: {formatDuration(row.totalSeconds / 60)}</span>
        </div>)}
      </div>}
    </section>
  );
}

export function AdminDashboard({ onToast }) {
  const [filters, setFilters] = useState({ dateFrom: daysAgoDate(30), dateTo: currentDate() });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const exportUrl = useMemo(() => `/api/admin/reports/export.csv${queryString(appliedFilters)}`, [appliedFilters]);

  async function load(nextFilters = appliedFilters) {
    setLoading(true);
    try { setData(await api(`/api/admin/reports/statistics${queryString(nextFilters)}`)); }
    catch (error) { onToast({ type: 'error', title: 'No se pudieron cargar las estadísticas', message: error.message }); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(appliedFilters); }, [appliedFilters]);

  async function syncNow() {
    setSyncing(true);
    try {
      const result = await api('/api/admin/sync-sheet', { method: 'POST' });
      setData((current) => current ? { ...current, sync: result.sync } : current);
      const clean = result.sync.pending === 0 && result.sync.failed === 0;
      onToast(clean
        ? { type: 'success', title: 'Volcado completado', message: `${result.processed} operaciones procesadas. No se han generado filas duplicadas.` }
        : { type: 'error', title: 'Volcado incompleto', message: `Quedan ${result.sync.pending} pendientes y ${result.sync.failed} con error.` });
    } catch (error) { onToast({ type: 'error', title: 'No se pudo realizar el volcado', message: error.message }); }
    finally { setSyncing(false); }
  }

  return (
    <section className="panel mt-7 overflow-hidden" aria-labelledby="admin-dashboard-title">
      <div className="border-b p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="text-sm font-bold text-brand-700 dark:text-brand-300">CONTROL INTERNO</p><h2 id="admin-dashboard-title" className="mt-2 text-2xl font-bold sm:text-3xl">Actividad y exportaciones</h2><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Consulta PostgreSQL, descarga un CSV o adelanta el volcado programado a Google Sheets.</p></div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a href={exportUrl} download className="btn-secondary whitespace-nowrap"><DownloadSimple size={20} weight="bold" />Descargar CSV</a>
            <button type="button" className="btn-primary whitespace-nowrap" onClick={syncNow} disabled={syncing}>{syncing ? <ArrowClockwise className="animate-spin motion-reduce:animate-none" size={20} /> : <CloudArrowUp size={21} weight="bold" />}{syncing ? 'Volcando datos' : 'Volcar ahora a Sheets'}</button>
          </div>
        </div>
        <form className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); setAppliedFilters({ ...filters }); }}>
          <label><span className="label">Desde</span><input type="date" className="field" value={filters.dateFrom} max={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} /></label>
          <label><span className="label">Hasta</span><input type="date" className="field" value={filters.dateTo} min={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} /></label>
          <button className="btn-secondary self-end" type="submit"><ChartBar size={20} />Actualizar</button>
        </form>
        <div className="mt-4 flex flex-col gap-1 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:bg-brand-400/10 dark:text-brand-200 sm:flex-row sm:items-center sm:justify-between">
          <span>El volcado es idempotente: actualiza las tareas existentes y solo añade las que faltan.</span>
          {data?.sync && <span className="shrink-0 font-semibold tabular-nums">Cola: {data.sync.pending} pendientes, {data.sync.failed} errores</span>}
        </div>
      </div>

      {loading || !data ? <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-4"><div className="h-36 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800 sm:col-span-2" /><div className="h-36 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" /><div className="h-36 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" /></div> : <div className="p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Metric featured label="Horas registradas" value={formatDuration(data.summary.totalSeconds / 60)} detail={`${data.summary.workDays} jornadas en el periodo`} icon={Clock} />
          <Metric label="Tareas" value={data.summary.tasks} detail="Trabajos documentados" icon={ListChecks} />
          <Metric label="Personas" value={data.summary.employees} detail="Con actividad registrada" icon={UsersThree} />
          <Metric label="Media por jornada" value={formatDuration(data.summary.averageSecondsPerDay / 60)} detail="Promedio por empleado y día" icon={ChartBar} />
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <DailyChart rows={data.daily} />
          <Ranking title="Horas por empleado" rows={data.employees} empty="No hay empleados con actividad en el rango." />
          <Ranking title="Horas por negocio" rows={data.businesses} empty="No hay negocios con actividad en el rango." />
        </div>
      </div>}
    </section>
  );
}
