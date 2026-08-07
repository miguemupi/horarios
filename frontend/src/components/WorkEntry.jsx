import { Trash } from '@phosphor-icons/react';
import { durationMinutes, formatDuration } from '../lib/time.js';

export function WorkEntry({ entry, index, businesses, onChange, onRemove, canRemove }) {
  const update = (field) => (event) => onChange(index, { ...entry, [field]: event.target.value });
  return (
    <fieldset className="border-t pt-6 first:border-t-0 first:pt-0">
      <legend className="sr-only">Trabajo {index + 1}</legend>
      <div className="mb-4 flex items-center justify-between gap-3"><div><p className="font-bold">Trabajo {index + 1}</p><p className="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">{formatDuration(durationMinutes(entry.startTime, entry.endTime))}</p></div>{canRemove && <button type="button" onClick={() => onRemove(index)} className="flex size-12 cursor-pointer items-center justify-center rounded-xl text-red-700 transition hover:bg-red-50 focus:outline-none focus:ring-4 focus:ring-red-500/20 dark:text-red-400 dark:hover:bg-red-950/40" aria-label={`Eliminar trabajo ${index + 1}`}><Trash size={22} /></button>}</div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block"><span className="label">Local o negocio *</span><select className="field" value={entry.business} onChange={update('business')} required><option value="">Selecciona un negocio</option>{businesses.map((business) => <option key={business.id} value={business.name}>{business.name}</option>)}</select></label>
        <label className="block md:col-span-2"><span className="label">Trabajos efectuados *</span><textarea className="field min-h-28 resize-y" value={entry.work} onChange={update('work')} maxLength={2000} required placeholder="Describe el trabajo realizado" /></label>
        <label className="block"><span className="label">Hora inicio *</span><input type="time" step="1" className="field tabular-nums" value={entry.startTime} onChange={update('startTime')} required /></label>
        <label className="block"><span className="label">Hora fin *</span><input type="time" step="1" className="field tabular-nums" value={entry.endTime} onChange={update('endTime')} required /><span className="mt-1.5 block text-xs text-zinc-500 dark:text-zinc-400">Si termina después de medianoche, el cálculo continúa al día siguiente.</span></label>
      </div>
    </fieldset>
  );
}
