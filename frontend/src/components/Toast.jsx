import { CheckCircle, WarningCircle, X } from '@phosphor-icons/react';

export function Toast({ toast, onClose }) {
  if (!toast) return null;
  const success = toast.type === 'success';
  return (
    <div className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-lg items-start gap-3 rounded-2xl border bg-white p-4 shadow-2xl dark:bg-zinc-900" role={success ? 'status' : 'alert'} aria-live="polite">
      {success ? <CheckCircle className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" size={24} weight="fill" /> : <WarningCircle className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" size={24} weight="fill" />}
      <div className="min-w-0 flex-1"><p className="font-bold">{toast.title}</p><p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{toast.message}</p></div>
      <button type="button" onClick={onClose} className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl hover:bg-zinc-100 focus:outline-none focus:ring-4 focus:ring-brand-400/25 dark:hover:bg-zinc-800" aria-label="Cerrar mensaje"><X size={20} /></button>
    </div>
  );
}
