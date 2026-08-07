import { FloppyDisk, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { durationMinutes, formatDuration, formatTime } from '../lib/time.js';

export function EditRecordPanel({ record, businesses, onSave, onClose, saving }) {
  const [form, setForm] = useState(() => ({ ...record, correctionReason: '', startTime: formatTime(record.startTime), endTime: formatTime(record.endTime), dayStart: formatTime(record.dayStart), dayEnd: formatTime(record.dayEnd) }));
  const field = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="edit-title">
      <form onSubmit={(event) => { event.preventDefault(); onSave(form); }} className="max-h-[95dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border bg-white p-5 shadow-2xl dark:bg-zinc-950 sm:rounded-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-bold text-brand-700 dark:text-brand-300">CORRECCIÓN EN SHEETS</p><h2 id="edit-title" className="mt-2 text-2xl font-bold">Editar trabajo</h2><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Se actualizará la fila existente, sin crear duplicados.</p></div><button type="button" onClick={onClose} className="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl hover:bg-zinc-100 focus:outline-none focus:ring-4 focus:ring-brand-400/25 dark:hover:bg-zinc-900" aria-label="Cerrar edición"><X size={23} /></button></div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label><span className="label">Fecha *</span><input type="date" className="field" value={form.date} onChange={field('date')} required /></label>
          <label><span className="label">Negocio *</span><select className="field" value={form.business} onChange={field('business')} required>{businesses.map((business) => <option key={business.id} value={business.name}>{business.name}</option>)}</select></label>
          <label className="sm:col-span-2"><span className="label">Trabajo realizado *</span><textarea className="field min-h-28" value={form.work} onChange={field('work')} required /></label>
          <label><span className="label">Hora inicio *</span><input type="time" step="1" className="field" value={form.startTime} onChange={field('startTime')} required /></label>
          <label><span className="label">Hora fin *</span><input type="time" step="1" className="field" value={form.endTime} onChange={field('endTime')} required /></label>
          <label><span className="label">Entrada del día *</span><input type="time" step="1" className="field" value={form.dayStart} onChange={field('dayStart')} required /></label>
          <label><span className="label">Salida del día *</span><input type="time" step="1" className="field" value={form.dayEnd} onChange={field('dayEnd')} required /></label>
          <label><span className="label">Firma empleado *</span><input className="field" value={form.employeeSignature} onChange={field('employeeSignature')} required /></label>
          <label className="sm:col-span-2"><span className="label">Motivo de la corrección *</span><textarea className="field min-h-24" value={form.correctionReason} onChange={field('correctionReason')} minLength={5} maxLength={1000} required placeholder="Explica por qué deben cambiarse estas horas" /></label>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-semibold tabular-nums">Nuevo total: {formatDuration(durationMinutes(form.startTime, form.endTime))}</p><div className="flex gap-3"><button type="button" className="btn-secondary flex-1 sm:flex-none" onClick={onClose}>Cancelar</button><button type="submit" className="btn-primary flex-1 sm:flex-none" disabled={saving}><FloppyDisk size={20} />{saving ? 'Actualizando' : 'Guardar corrección'}</button></div></div>
      </form>
    </div>
  );
}
