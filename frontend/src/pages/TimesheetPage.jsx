import { ArrowClockwise, CheckCircle, Clock, FlagCheckered, Hourglass, ListChecks, Play, Plus, StopCircle, WifiSlash } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { FinishTaskPanel } from '../components/FinishTaskPanel.jsx';
import { LiveClock } from '../components/LiveClock.jsx';
import { Toast } from '../components/Toast.jsx';
import { WorkEntry } from '../components/WorkEntry.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { currentDate, currentTime, durationMinutes, elapsedMinutesSince, formatDuration, formatTime, isFutureDateTime } from '../lib/time.js';
import { commandIdentity, workDayStorageKey } from '../lib/device.js';
import { loadDraftOffline, queueCommand, removeDraftOffline, saveDraftOffline } from '../lib/offline-store.js';

const blankEntry = (start = currentTime()) => ({ clientEntryId: crypto.randomUUID(), business: '', work: '', material: '', startTime: start, endTime: start, overtime: false });

function TasksSummary({ persisted, entries }) {
  if (persisted.length + entries.length === 0) return null;
  return (
    <div className="panel p-5 sm:p-6">
      <div className="flex items-center gap-2"><ListChecks size={22} className="text-brand-700 dark:text-brand-300" /><h2 className="text-lg font-bold">Resumen de tareas</h2></div>
      <ul className="mt-4 space-y-2">
        {persisted.map((row) => <li key={row.recordId} className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm"><span><strong>{row.business}</strong> · {formatTime(row.startTime)} a {formatTime(row.endTime)}{row.overtime && <span className="ml-2 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">Horas extra</span>}</span><span className="tabular-nums text-zinc-500 dark:text-zinc-400">{formatDuration(row.totalHours * 60)}</span></li>)}
        {entries.map((entry, index) => <li key={`draft-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3 text-sm"><span><strong>{entry.business}</strong> · {formatTime(entry.startTime)} a {formatTime(entry.endTime)}{entry.overtime && <span className="ml-2 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">Horas extra</span>}</span><span className="tabular-nums text-zinc-500 dark:text-zinc-400">{formatDuration(durationMinutes(entry.startTime, entry.endTime))}</span></li>)}
      </ul>
    </div>
  );
}

export function TimesheetPage() {
  const { user } = useAuth();
  const [meta, setMeta] = useState(null);
  const [persisted, setPersisted] = useState([]);
  const [form, setForm] = useState(() => ({ started: false, date: currentDate(), dayStart: currentTime(), dayEnd: currentTime(), employeeSignature: user.name, signatureConfirmed: false, entries: [], activeTask: null, reviewing: false, dayClosing: false, declaredHours: '' }));
  const [status, setStatus] = useState('loading');
  const [toast, setToast] = useState(null);
  const [finishing, setFinishing] = useState(null);
  const [dayEndWarning, setDayEndWarning] = useState(false);
  const [, forceTick] = useState(0);
  const draftKey = `serendipia-draft:${user.email}:${form.date}`;

  function hydrateDraft(draft, fallbackStarted) {
    const hasNewShape = 'activeTask' in draft || 'reviewing' in draft;
    return {
      ...draft,
      started: draft.started ?? fallbackStarted,
      dayStart: formatTime(draft.dayStart),
      dayEnd: formatTime(draft.dayEnd),
      entries: (draft.entries ?? []).map((entry) => ({ ...entry, clientEntryId: entry.clientEntryId || crypto.randomUUID(), startTime: formatTime(entry.startTime), endTime: formatTime(entry.endTime) })),
      activeTask: hasNewShape && draft.activeTask ? { ...draft.activeTask, startTime: formatTime(draft.activeTask.startTime) } : null,
      reviewing: hasNewShape ? Boolean(draft.reviewing && draft.dayClosing) : false,
      dayClosing: Boolean(draft.dayClosing),
      declaredHours: draft.declaredHours ?? '',
    };
  }

  useEffect(() => {
    Promise.all([api('/api/timesheets/meta'), api('/api/timesheets/today'), api('/api/work-days/current')]).then(async ([metadata, today, current]) => {
      setMeta(metadata);
      if (current.workDay) {
        const day = current.workDay;
        localStorage.setItem(workDayStorageKey(user.email), day.id);
        setPersisted([]);
        setForm((existing) => ({
          ...existing, workDayId: day.id, presenceId: day.journeyKey, started: true, date: day.date,
          dayStart: formatTime(day.dayStart), dayEnd: formatTime(day.dayEnd) || currentTime(),
          entries: day.tasks || [], activeTask: day.activeTask ? { startTime: formatTime(day.activeTask.startTime) } : null,
          employeeSignature: day.employeeSignature || user.name,
          reviewing: false, dayClosing: false,
          declaredHours: day.declaredHours !== null && day.declaredHours !== undefined ? String(day.declaredHours) : '',
        }));
        setStatus('ready');
        return;
      }
      setPersisted(today.rows);
      const key = `serendipia-draft:${user.email}:${today.date}`;
      const localDraft = localStorage.getItem(key);
      let saved = null;
      try { saved = localDraft ? JSON.parse(localDraft) : await loadDraftOffline(key).catch(() => null); }
      catch { localStorage.removeItem(key); saved = await loadDraftOffline(key).catch(() => null); }
      if (saved) setForm(hydrateDraft(saved, true));
      else {
        const start = formatTime(today.rows.at(-1)?.endTime) || currentTime();
        setForm((current) => ({ ...current, started: false, date: today.date, dayStart: formatTime(today.rows[0]?.dayStart) || current.dayStart, dayEnd: formatTime(today.rows[0]?.dayEnd) || currentTime(), entries: [], activeTask: null, reviewing: false, dayClosing: false }));
      }
      setStatus('ready');
    }).catch((error) => { setStatus('error'); setToast({ type: 'error', title: 'No se puede cargar el parte', message: error.message }); });
  }, [user.email]);

  useEffect(() => {
    if (status !== 'ready' && status !== 'saving' && status !== 'error') return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(draftKey, JSON.stringify(form));
      saveDraftOffline(draftKey, form).catch(() => {});
      window.dispatchEvent(new Event('serendipia-presence-change'));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draftKey, form, status]);

  useEffect(() => {
    if (!form.started || form.reviewing) return;
    const id = window.setInterval(() => forceTick((tick) => tick + 1), 1_000);
    return () => window.clearInterval(id);
  }, [form.started, form.reviewing]);

  function reloadAfterAutoClose() {
    localStorage.removeItem(workDayStorageKey(user.email));
    localStorage.removeItem(draftKey);
    removeDraftOffline(draftKey).catch(() => {});
    setPersisted([]);
    setForm({ started: false, date: currentDate(), dayStart: currentTime(), dayEnd: currentTime(), employeeSignature: user.name, signatureConfirmed: false, entries: [], activeTask: null, reviewing: false, dayClosing: false, declaredHours: '' });
    setStatus('ready');
    setToast({ type: 'error', title: 'La jornada se cerró sola a las 22:00', message: 'Puedes iniciar una jornada nueva. Si falta alguna tarea de la jornada cerrada, pídele a un administrador que la añada desde el historial.' });
  }

  const activeMinutes = form.activeTask ? elapsedMinutesSince(form.date, form.activeTask.startTime) : 0;
  const activeTaskIsPlanned = form.activeTask ? isFutureDateTime(form.date, form.activeTask.startTime) : false;
  const dayElapsedMinutes = form.started ? elapsedMinutesSince(form.date, form.dayStart) : 0;
  const draftMinutes = useMemo(() => form.entries.reduce((total, entry) => total + durationMinutes(entry.startTime, entry.endTime), 0), [form.entries]);
  const persistedMinutes = useMemo(() => persisted.reduce((total, row) => total + row.totalHours * 60, 0), [persisted]);
  const changeEntry = (index, entry) => setForm((current) => ({ ...current, entries: current.entries.map((item, itemIndex) => itemIndex === index ? entry : item) }));
  const removeEntry = async (index) => {
    const entry = form.entries[index];
    try {
      if (entry?.recordId && form.workDayId) {
        const { workDay } = await api(`/api/work-days/${form.workDayId}/tasks/${entry.recordId}`, { method: 'DELETE', body: commandIdentity() });
        setForm((current) => ({ ...current, entries: workDay.tasks }));
      } else setForm((current) => ({ ...current, entries: current.entries.filter((_, itemIndex) => itemIndex !== index) }));
    } catch (error) { setToast({ type: 'error', title: 'No se pudo retirar la tarea', message: error.message }); }
  };
  const addEntry = () => setForm((current) => ({ ...current, entries: [...current.entries, blankEntry(current.entries.at(-1)?.endTime || current.dayStart)] }));

  async function startWork() {
    const now = currentTime();
    setStatus('saving');
    try {
      const { workDay } = await api('/api/work-days/start', { method: 'POST', body: { ...commandIdentity(), date: form.date, dayStart: now, taskStart: now } });
      localStorage.setItem(workDayStorageKey(user.email), workDay.id);
      setPersisted([]);
      setForm((current) => ({ ...current, workDayId: workDay.id, presenceId: workDay.journeyKey, started: true, dayStart: workDay.dayStart, dayEnd: now, entries: workDay.tasks || [], activeTask: { startTime: workDay.activeTask?.startTime || now }, reviewing: false, dayClosing: false }));
      setStatus('ready');
      window.dispatchEvent(new Event('serendipia-presence-change'));
    } catch (error) {
      setStatus('error');
      setToast({ type: 'error', title: 'No se pudo iniciar en el servidor', message: `${error.message} Comprueba la conexión antes de continuar.` });
      return;
    }
    navigator.vibrate?.(10);
  }

  function openFinishing() {
    const endTime = activeTaskIsPlanned ? form.activeTask.startTime : currentTime();
    setDayEndWarning(false);
    setFinishing({ draft: { business: '', work: '', startTime: form.activeTask.startTime, endTime, overtime: false }, planned: activeTaskIsPlanned });
  }

  async function confirmFinishing(entryDraft) {
    const entry = { ...entryDraft, clientEntryId: entryDraft.clientEntryId || crypto.randomUUID() };
    const command = { ...commandIdentity(), ...entry };
    setFinishing((current) => ({ ...current, saving: true }));
    try {
      if (!form.workDayId) throw new Error('No se encuentra la jornada abierta en el servidor. Recarga la página para recuperarla.');
      const path = `/api/work-days/${form.workDayId}/tasks/finish`;
      try {
        const { workDay } = await api(path, { method: 'POST', body: command });
        setPersisted([]);
        setForm((current) => ({ ...current, entries: workDay.tasks, activeTask: null, reviewing: false, dayClosing: false, dayEnd: entry.endTime }));
      } catch (error) {
        if (navigator.onLine) throw error;
        await queueCommand(path, 'POST', command);
        setForm((current) => ({ ...current, entries: [...current.entries, entry], activeTask: null, reviewing: false, dayClosing: false, dayEnd: entry.endTime }));
        setToast({ type: 'error', title: 'Tarea pendiente de sincronizar', message: 'Se conserva en este dispositivo y se enviará al recuperar conexión.' });
      }
      navigator.vibrate?.(10);
      setFinishing(null);
      window.dispatchEvent(new Event('serendipia-presence-change'));
    } catch (error) {
      if (error.code === 'WORK_DAY_CLOSED') { setFinishing(null); reloadAfterAutoClose(); return; }
      setFinishing((current) => ({ ...current, saving: false }));
      setToast({ type: 'error', title: 'No se pudo guardar la tarea', message: error.message });
    }
  }

  async function resumeTimer() {
    const now = currentTime();
    try {
      let workDay;
      if (form.workDayId) {
        ({ workDay } = await api(`/api/work-days/${form.workDayId}/tasks/start`, { method: 'POST', body: { ...commandIdentity(), startTime: now, planned: false } }));
      } else {
        ({ workDay } = await api('/api/work-days/start', { method: 'POST', body: { ...commandIdentity(), date: form.date, dayStart: form.dayStart, taskStart: now } }));
      }
      localStorage.setItem(workDayStorageKey(user.email), workDay.id);
      setPersisted([]);
      setForm((current) => ({ ...current, workDayId: workDay.id, presenceId: workDay.journeyKey, entries: workDay.tasks, reviewing: false, dayClosing: false, activeTask: { startTime: workDay.activeTask?.startTime || now } }));
      window.dispatchEvent(new Event('serendipia-presence-change'));
    } catch (error) {
      if (error.code === 'WORK_DAY_CLOSED') return reloadAfterAutoClose();
      setToast({ type: 'error', title: 'No se pudo iniciar la tarea', message: error.message });
    }
  }

  function beginDayClosing() {
    setForm((current) => ({
      ...current,
      dayEnd: isFutureDateTime(current.date, current.dayEnd) ? current.dayEnd : currentTime(),
      reviewing: true,
      dayClosing: true,
      declaredHours: current.declaredHours !== '' ? current.declaredHours : (Math.round((persistedMinutes + draftMinutes) / 60 * 100) / 100).toString(),
    }));
  }

  async function changeDate(nextDate) {
    localStorage.setItem(draftKey, JSON.stringify(form));
    const nextKey = `serendipia-draft:${user.email}:${nextDate}`;
    const saved = localStorage.getItem(nextKey);
    try {
      const { rows } = await api(`/api/timesheets?dateFrom=${nextDate}&dateTo=${nextDate}`);
      setPersisted(rows);
      if (saved) setForm(hydrateDraft(JSON.parse(saved), true));
      else {
        const start = formatTime(rows.at(-1)?.endTime) || currentTime();
        setForm({ started: rows.length > 0, date: nextDate, dayStart: formatTime(rows[0]?.dayStart) || start, dayEnd: formatTime(rows[0]?.dayEnd) || currentTime(), employeeSignature: user.name, signatureConfirmed: false, entries: [], activeTask: null, reviewing: false, dayClosing: false, declaredHours: rows[0]?.declaredHours != null ? String(rows[0].declaredHours) : '' });
      }
    } catch (error) {
      setToast({ type: 'error', title: 'No se pudo cambiar la fecha', message: error.message });
    }
  }

  async function save(event) {
    event.preventDefault();
    if (!form.signatureConfirmed) {
      setToast({ type: 'error', title: 'Falta tu firma', message: 'Confirma la firma digital antes de guardar.' });
      return;
    }
    if (form.entries.length + persisted.length === 0) {
      setToast({ type: 'error', title: 'Nada que guardar', message: 'Añade al menos un trabajo antes de guardar.' });
      return;
    }
    const equalTimes = form.entries.some((entry) => durationMinutes(entry.startTime, entry.endTime) === 0) || durationMinutes(form.dayStart, form.dayEnd) === 0;
    if (equalTimes) {
      setToast({ type: 'error', title: 'Revisa las horas', message: 'La hora de inicio y fin no pueden ser iguales.' });
      return;
    }
    setStatus('saving');
    localStorage.setItem(draftKey, JSON.stringify(form));
    const declaredHoursValue = form.declaredHours === '' || form.declaredHours == null ? null : Number(form.declaredHours);
    try {
      let result;
      if (form.workDayId) {
        for (const entry of form.entries) {
          if (entry.recordId) {
            await api(`/api/timesheets/${entry.recordId}`, { method: 'PATCH', body: entry });
          } else {
            await api(`/api/work-days/${form.workDayId}/tasks/finish`, { method: 'POST', body: { ...commandIdentity(), ...entry, clientEntryId: entry.clientEntryId || crypto.randomUUID() } });
          }
        }
        const response = await api(`/api/work-days/${form.workDayId}/finish`, { method: 'POST', body: {
          ...commandIdentity(), dayStart: form.dayStart, dayEnd: form.dayEnd,
          employeeSignature: form.employeeSignature, declaredHours: declaredHoursValue,
        } });
        result = { recordIds: response.workDay.tasks.map((entry) => entry.recordId), syncStatus: 'pending', storage: 'postgres' };
      } else {
        result = await api('/api/timesheets', { method: 'POST', body: { ...form, signatureConfirmed: undefined, declaredHours: declaredHoursValue } });
      }
      localStorage.removeItem(draftKey);
      removeDraftOffline(draftKey).catch(() => {});
      localStorage.removeItem(workDayStorageKey(user.email));
      const savedEntries = form.entries.map((entry, index) => ({ ...entry, totalHours: durationMinutes(entry.startTime, entry.endTime) / 60, dayStart: form.dayStart, dayEnd: form.dayEnd, employeeSignature: form.employeeSignature, recordId: result.recordIds[index], syncStatus: result.syncStatus }));
      setPersisted((rows) => [...rows, ...savedEntries]);
      setForm((current) => ({ ...current, workDayId: null, presenceId: null, started: false, signatureConfirmed: false, entries: [], reviewing: false, dayClosing: false, activeTask: null }));
      setStatus('ready');
      const usedFallback = result.storage === 'google-sheets-fallback';
      setToast(usedFallback
        ? { type: 'success', title: 'Guardado mediante respaldo', message: 'PostgreSQL no estaba disponible. El parte se ha escrito directamente en Google Sheets y se recuperará al volver la base de datos.' }
        : { type: 'success', title: 'Parte guardado de forma segura', message: `${savedEntries.length} ${savedEntries.length === 1 ? 'tarea registrada' : 'tareas registradas'} en PostgreSQL. Google Sheets se actualizará en la exportación programada.` });
      window.dispatchEvent(new Event('serendipia-presence-change'));
    } catch (error) {
      if (error.code === 'WORK_DAY_CLOSED') return reloadAfterAutoClose();
      setStatus('error');
      setToast({ type: 'error', title: 'No se ha podido guardar el parte', message: `${error.message} Tus datos siguen guardados en este dispositivo. Pulsa reintentar cuando recuperes conexión.` });
    }
  }

  if (status === 'loading') return <div className="space-y-5" aria-busy="true"><div className="h-28 animate-pulse rounded-2xl bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-900" /><div className="h-96 animate-pulse rounded-2xl bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-900" /></div>;
  if (!meta) return <div className="panel p-8 text-center"><WifiSlash className="mx-auto text-red-600 dark:text-red-400" size={40} /><h1 className="mt-4 text-2xl font-bold">No se puede abrir el formulario</h1><button type="button" className="btn-secondary mt-5" onClick={() => window.location.reload()}><ArrowClockwise size={20} />Reintentar</button></div>;

  if (!form.started) return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <section className="mx-auto flex min-h-[calc(100dvh-13rem)] max-w-2xl flex-col justify-center py-6 text-center sm:py-10">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-brand-100 text-brand-800 dark:bg-brand-400/15 dark:text-brand-300"><Clock size={34} weight="duotone" /></div>
        <p className="mt-6 text-sm font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300">{new Date(`${form.date}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <LiveClock className="mt-1 text-lg font-bold tabular-nums text-zinc-500 dark:text-zinc-400" />
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">¿Empezamos la jornada?</h1>
        <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-zinc-600 dark:text-zinc-300 sm:text-lg">Un toque registra la hora de entrada y arranca el contador de la primera tarea.</p>
        <button type="button" onClick={startWork} className="mt-8 flex min-h-24 w-full cursor-pointer items-center justify-center gap-4 rounded-2xl bg-brand-400 px-6 py-5 text-xl font-extrabold text-zinc-950 shadow-lg shadow-brand-400/20 transition hover:bg-brand-300 active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-brand-400/35 sm:min-h-28 sm:text-2xl">
          <Play size={32} weight="fill" />
          Iniciar trabajo
        </button>
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">La hora se puede corregir antes de guardar el parte.</p>
      </section>
    </>
  );

  if (form.activeTask && !form.reviewing) return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <section className="space-y-6">
        <div className="grid grid-cols-2 overflow-hidden rounded-2xl bg-zinc-950 text-white dark:bg-white dark:text-zinc-950">
          <div className="px-4 py-4 sm:px-6"><p className="text-xs font-semibold opacity-70 sm:text-sm">Jornada transcurrida</p><p className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">{formatDuration(dayElapsedMinutes)}</p></div>
          <div className="border-l border-white/15 px-4 py-4 dark:border-zinc-950/15 sm:px-6"><p className="text-xs font-semibold opacity-70 sm:text-sm">Horas en tareas</p><p className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">{formatDuration(persistedMinutes + draftMinutes + activeMinutes)}</p></div>
        </div>

        <div className="panel p-6 text-center sm:p-10">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-800 dark:bg-brand-400/15 dark:text-brand-300">{activeTaskIsPlanned ? <Clock size={30} weight="duotone" /> : <Hourglass size={30} weight="duotone" />}</div>
          <p className="mt-5 text-sm font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300">{activeTaskIsPlanned ? `Tarea planificada · comienza a las ${formatTime(form.activeTask.startTime)}` : `Tarea en curso · desde las ${formatTime(form.activeTask.startTime)}`}</p>
          <p className="mt-2 text-5xl font-bold tabular-nums sm:text-6xl">{formatDuration(activeMinutes)}</p>
          {activeTaskIsPlanned && <p className="mx-auto mt-3 max-w-md text-sm text-zinc-600 dark:text-zinc-300">El contador comenzará automáticamente a esa hora. Puedes planificar su finalización ahora.</p>}
          <button type="button" onClick={openFinishing} className="mt-8 flex min-h-20 w-full cursor-pointer items-center justify-center gap-3 rounded-2xl bg-brand-400 px-6 py-4 text-lg font-extrabold text-zinc-950 shadow-lg shadow-brand-400/20 transition hover:bg-brand-300 active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-brand-400/35 sm:text-xl">
            <StopCircle size={28} weight="fill" />
            {activeTaskIsPlanned ? 'Planificar esta tarea' : 'Finalizar tarea'}
          </button>
        </div>

        <TasksSummary persisted={persisted} entries={form.entries} />

        {dayEndWarning && <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-left text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" role="alert"><div className="flex items-start gap-3"><StopCircle className="mt-0.5 shrink-0" size={24} weight="fill" /><div><p className="font-bold">Tienes que cerrar la tarea antes de marcharte</p><p className="mt-1 text-sm">Pulsa “Finalizar tarea”, completa sus datos y después selecciona “Terminar Día de Trabajo” desde el resumen.</p></div></div></div>}
        <button type="button" onClick={() => setDayEndWarning(true)} className="btn-secondary w-full py-4 text-base"><FlagCheckered size={22} weight="fill" />Terminar Día de Trabajo</button>
      </section>

      {finishing && <FinishTaskPanel draft={finishing.draft} businesses={meta.businesses} planned={finishing.planned} onSave={confirmFinishing} onCancel={() => setFinishing(null)} saving={Boolean(finishing.saving)} />}
    </>
  );

  if (!form.activeTask && !form.reviewing) return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <section className="space-y-6">
        <div className="grid grid-cols-2 overflow-hidden rounded-2xl bg-zinc-950 text-white dark:bg-white dark:text-zinc-950">
          <div className="px-4 py-4 sm:px-6"><p className="text-xs font-semibold opacity-70 sm:text-sm">Jornada transcurrida</p><p className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">{formatDuration(dayElapsedMinutes)}</p></div>
          <div className="border-l border-white/15 px-4 py-4 dark:border-zinc-950/15 sm:px-6"><p className="text-xs font-semibold opacity-70 sm:text-sm">Horas en tareas</p><p className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">{formatDuration(persistedMinutes + draftMinutes)}</p></div>
        </div>

        <div className="panel p-6 text-center sm:p-10">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-800 dark:bg-brand-400/15 dark:text-brand-300"><CheckCircle size={30} weight="duotone" /></div>
          <p className="mt-5 text-sm font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300">Jornada en curso</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Tiempo trabajado</h1>
          <p className="mt-3 text-4xl font-bold tabular-nums sm:text-6xl">{formatDuration(dayElapsedMinutes)}</p>
          <p className="mx-auto mt-4 max-w-lg text-sm text-zinc-600 dark:text-zinc-300">La última tarea está guardada en el borrador. Puedes comenzar la siguiente o terminar la jornada cuando corresponda.</p>
          <button type="button" onClick={resumeTimer} className="mt-8 flex min-h-20 w-full cursor-pointer items-center justify-center gap-3 rounded-2xl bg-brand-400 px-6 py-4 text-lg font-extrabold text-zinc-950 shadow-lg shadow-brand-400/20 transition hover:bg-brand-300 active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-brand-400/35 sm:text-xl">
            <Play size={28} weight="fill" />Iniciar siguiente tarea
          </button>
          <button type="button" onClick={beginDayClosing} className="btn-secondary mt-3 w-full py-4 text-base"><FlagCheckered size={22} weight="fill" />Terminar Día de Trabajo</button>
        </div>

        <TasksSummary persisted={persisted} entries={form.entries} />
      </section>
    </>
  );

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <form onSubmit={save} className="space-y-6">
        <section className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div><p className="text-sm font-bold text-brand-700 dark:text-brand-300">RESUMEN DEL DÍA</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Revisa y confirma los trabajos</h1><p className="mt-2 text-zinc-600 dark:text-zinc-300">El borrador se guarda automáticamente en este dispositivo.</p></div>
          <div className="grid grid-cols-2 overflow-hidden rounded-2xl bg-zinc-950 text-white dark:bg-white dark:text-zinc-950">
            <div className="px-4 py-4 sm:px-6"><p className="text-xs font-semibold opacity-70 sm:text-sm">Jornada total</p><p className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">{formatDuration(durationMinutes(form.dayStart, form.dayEnd))}</p></div>
            <div className="border-l border-white/15 px-4 py-4 dark:border-zinc-950/15 sm:px-6"><p className="text-xs font-semibold opacity-70 sm:text-sm">Horas en tareas</p><p className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">{formatDuration(persistedMinutes + draftMinutes)}</p></div>
          </div>
        </section>

        <TasksSummary persisted={persisted} entries={form.entries} />

        <section className="panel p-5 sm:p-6">
          <h2 className="text-xl font-bold">Datos del día</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label><span className="label">Nombre empleado</span><input className="field" value={user.name} disabled /></label>
            <label><span className="label">Fecha *</span><input type="date" className="field" value={form.date} onChange={(event) => changeDate(event.target.value)} disabled={Boolean(form.workDayId)} required /></label>
            <label><span className="label">Hora de entrada *</span><input type="time" step="1" className="field tabular-nums" value={form.dayStart} onChange={(event) => setForm({ ...form, dayStart: event.target.value })} required /></label>
            <label><span className="label">Hora de salida *</span><input type="time" step="1" className="field tabular-nums" value={form.dayEnd} onChange={(event) => setForm({ ...form, dayEnd: event.target.value })} required /></label>
            <label><span className="label">Horas trabajadas (declaradas)</span><input type="number" step="0.01" min="0" max="24" className="field tabular-nums" value={form.declaredHours} onChange={(event) => setForm({ ...form, declaredHours: event.target.value })} placeholder="Ej. 8" /><span className="mt-1.5 block text-xs text-zinc-500 dark:text-zinc-400">Se guarda como el total oficial del parte, aunque no coincida con la suma de tareas.</span></label>
          </div>
        </section>

        {persisted.length > 0 && <section className="rounded-2xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-900 dark:bg-brand-950/60"><div className="flex items-start gap-3"><CheckCircle className="shrink-0 text-brand-700 dark:text-brand-300" size={25} weight="fill" /><div><h2 className="font-bold">Parte de esta fecha reabierto</h2><p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">Ya hay {persisted.length} {persisted.length === 1 ? 'trabajo guardado' : 'trabajos guardados'}. Las filas siguientes se añadirán sin duplicar las anteriores.</p></div></div></section>}

        <section className="panel p-5 sm:p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div><h2 className="text-xl font-bold">Editar tareas</h2><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Corrige o elimina antes de guardar.</p></div>
            <div className="flex gap-3"><button type="button" onClick={resumeTimer} className="btn-secondary"><Hourglass size={20} weight="bold" />Otra tarea cronometrada</button><button type="button" onClick={addEntry} className="btn-secondary"><Plus size={20} weight="bold" />Añadir fila manual</button></div>
          </div>
          {form.entries.length === 0 ? <p className="text-sm text-zinc-500 dark:text-zinc-400">Todavía no hay trabajos documentados.</p> : <div className="space-y-6">{form.entries.map((entry, index) => <WorkEntry key={index} entry={entry} index={index} businesses={meta.businesses} onChange={changeEntry} onRemove={removeEntry} canRemove={form.entries.length > 1} />)}</div>}
        </section>

        <section className="panel p-5 sm:p-6">
          <h2 className="text-xl font-bold">Firmas</h2>
          <div className="mt-5">
            <div><span className="label">Firma empleado *</span><label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border bg-white px-4 py-3 transition hover:border-brand-400 dark:bg-zinc-950"><input type="checkbox" className="size-5 accent-brand-400" checked={form.signatureConfirmed} onChange={(event) => setForm({ ...form, signatureConfirmed: event.target.checked })} /><span className="text-sm">Confirmo el parte como <strong>{user.name}</strong></span></label></div>
          </div>
        </section>

        <button type="submit" className="btn-primary w-full py-4 text-lg" disabled={status === 'saving' || form.entries.length + persisted.length === 0}>{status === 'saving' ? <><span className="size-5 animate-spin rounded-full border-2 border-zinc-950/30 border-t-zinc-950 motion-reduce:animate-none" />Guardando de forma segura</> : status === 'error' ? <><ArrowClockwise size={23} weight="bold" />Reintentar guardado</> : <><FlagCheckered size={23} weight="fill" />Terminar Día de Trabajo</>}</button>
      </form>
    </>
  );
}
