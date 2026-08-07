import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const initial = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const [theme, setTheme] = useState(initial);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('serendipia-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#09090b' : '#fafafa');
  }, [theme]);
  const value = useMemo(() => ({ theme, toggle: () => setTheme((current) => current === 'dark' ? 'light' : 'dark') }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
