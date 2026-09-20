import { FloppyDisk, X } from '@phosphor-icons/react';
import { useState } from 'react';

export function EditDayDatePanel({ part, onSave, onClose, saving }) {
  const [date, setDate] = useState(part.date);
  const [correctionReason, setCorrectionReason] = useState('');
  function submit(event) {
    event.preventDefault();
    onSave({ date, correctionReason });
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="edit-day-title">
      <form onSubmit={submit} className="w-full max-w-md overflow-y-auto rounded-t-2xl border bg-white p-5 shadow-2xl dark:bg-zinc-950 sm:rounded-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-bold text-brand-700 dark:text-brand-300">CORRECCIÓN EN SHEETS</p><h2 id="edit-day-title" className="mt-2 text-2xl font-bold">Mover el día completo</h2><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Cambia la fecha de las {part.entries.length} {part.entries.length === 1 ? 'tarea' : 'tareas'} de {part.employeeName}, sin tocar sus horas.</p></div><button type="button" onClick={onClose} className="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl hover:bg-zinc-100 focus:outline-none focus:ring-4 focus:ring-brand-400/25 dark:hover:bg-zinc-900" aria-label="Cerrar edición"><X size={23} /></button></div>
        <div className="mt-6 grid gap-4">
          <label><span className="label">Nueva fecha *</span><input type="date" className="field" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
          <label><span className="label">Motivo de la corrección *</span><textarea className="field min-h-24" value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} minLength={5} maxLength={1000} required placeholder="Explica por qué debe moverse este día" /></label>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end"><button type="button" className="btn-secondary flex-1 sm:flex-none" onClick={onClose}>Cancelar</button><button type="submit" className="btn-primary flex-1 sm:flex-none" disabled={saving}><FloppyDisk size={20} />{saving ? 'Actualizando' : 'Mover día'}</button></div>
      </form>
    </div>
  );
}
