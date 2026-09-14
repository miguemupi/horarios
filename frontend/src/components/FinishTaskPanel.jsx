import { StopCircle, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { durationMinutes, formatDuration } from '../lib/time.js';

export function FinishTaskPanel({ draft, businesses, planned = false, onSave, onCancel, saving }) {
  const [form, setForm] = useState(draft);
  const [error, setError] = useState('');
  const field = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));

  function submit(event) {
    event.preventDefault();
    if (durationMinutes(form.startTime, form.endTime) === 0) { setError('La hora de inicio y fin no pueden ser iguales.'); return; }
    setError('');
    onSave(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="finish-task-title">
      <form onSubmit={submit} className="max-h-[95dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border bg-white p-5 shadow-2xl dark:bg-zinc-950 sm:rounded-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-brand-700 dark:text-brand-300">{planned ? 'TAREA PLANIFICADA' : 'TAREA FINALIZADA'}</p>
            <h2 id="finish-task-title" className="mt-2 text-2xl font-bold">{planned ? 'Indica el trabajo previsto' : 'Documenta el trabajo'}</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{planned ? 'La tarea todavía no ha comenzado. Indica su hora de fin prevista.' : 'Las horas se han tomado del contador; puedes ajustarlas si hace falta.'}</p>
          </div>
          <button type="button" onClick={onCancel} className="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl hover:bg-zinc-100 focus:outline-none focus:ring-4 focus:ring-brand-400/25 dark:hover:bg-zinc-900" aria-label="Cancelar"><X size={23} /></button>
        </div>

        <div className="mt-6 grid gap-4">
          <label className="block"><span className="label">Local o negocio *</span><select className="field" value={form.business} onChange={field('business')} required autoFocus><option value="">Selecciona un negocio</option>{businesses.map((business) => <option key={business.id} value={business.name}>{business.name}</option>)}</select></label>
          <label className="block"><span className="label">Trabajo realizado *</span><textarea className="field min-h-28 resize-y" value={form.work} onChange={field('work')} maxLength={2000} required placeholder="Describe el trabajo realizado" /></label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block"><span className="label">Hora inicio *</span><input type="time" step="1" className="field tabular-nums" value={form.startTime} onChange={field('startTime')} required /></label>
            <label className="block"><span className="label">Hora fin *</span><input type="time" step="1" className="field tabular-nums" value={form.endTime} onChange={field('endTime')} required /></label>
          </div>
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border bg-white px-4 py-3 transition hover:border-brand-400 dark:bg-zinc-950"><input type="checkbox" className="size-5 accent-brand-400" checked={Boolean(form.overtime)} onChange={(event) => setForm((current) => ({ ...current, overtime: event.target.checked }))} /><span className="text-sm">¿Han sido en horas extra?</span></label>
        </div>

        {error && <p className="mt-3 text-sm font-semibold text-red-700 dark:text-red-400">{error}</p>}

        <div className="mt-6 flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold tabular-nums">Duración: {formatDuration(durationMinutes(form.startTime, form.endTime))}</p>
          <div className="flex gap-3"><button type="button" className="btn-secondary flex-1 sm:flex-none" onClick={onCancel}>{planned ? 'Cancelar' : 'Seguir cronometrando'}</button><button type="submit" className="btn-primary flex-1 sm:flex-none" disabled={saving}><StopCircle size={20} weight="fill" />{planned ? 'Guardar planificación' : 'Guardar tarea'}</button></div>
        </div>
      </form>
    </div>
  );
}
