import { Key, ShieldCheck } from '@phosphor-icons/react';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export function PasswordChangePanel() {
  const { changePassword } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmation: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (form.newPassword !== form.confirmation) return setError('Las contraseñas nuevas no coinciden.');
    setSaving(true);
    setError('');
    try { await changePassword(form.currentPassword, form.newPassword); }
    catch (nextError) { setError(nextError.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="password-change-title">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-2xl dark:bg-zinc-950 sm:p-8">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-800 dark:bg-brand-400/15 dark:text-brand-300"><ShieldCheck size={30} weight="duotone" /></div>
        <h2 id="password-change-title" className="mt-5 text-2xl font-bold">Protege tu cuenta</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Debes sustituir la contraseña inicial antes de continuar.</p>
        <div className="mt-6 space-y-4">
          <label><span className="label">Contraseña actual</span><input type="password" className="field" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} required /></label>
          <label><span className="label">Nueva contraseña</span><input type="password" className="field" autoComplete="new-password" minLength="12" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} required /><span className="mt-1.5 block text-xs text-zinc-500">Mínimo 12 caracteres.</span></label>
          <label><span className="label">Repite la nueva contraseña</span><input type="password" className="field" autoComplete="new-password" minLength="12" value={form.confirmation} onChange={(event) => setForm({ ...form, confirmation: event.target.value })} required /></label>
        </div>
        {error && <p className="mt-4 text-sm font-semibold text-red-700 dark:text-red-400" role="alert">{error}</p>}
        <button className="btn-primary mt-6 w-full" disabled={saving}><Key size={20} />{saving ? 'Actualizando' : 'Cambiar contraseña'}</button>
      </form>
    </div>
  );
}
