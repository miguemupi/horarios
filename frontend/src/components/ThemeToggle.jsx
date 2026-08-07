import { Moon, Sun } from '@phosphor-icons/react';
import { useTheme } from '../context/ThemeContext.jsx';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle} className="flex size-12 cursor-pointer items-center justify-center rounded-xl border bg-white text-brand-700 transition hover:bg-zinc-100 focus:outline-none focus:ring-4 focus:ring-brand-400/25 dark:bg-zinc-950 dark:text-brand-400 dark:hover:bg-zinc-900" aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}>
      {theme === 'dark' ? <Sun size={23} weight="bold" /> : <Moon size={23} weight="bold" />}
    </button>
  );
}
