import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const RouterContext = createContext(null);

export function RouterProvider({ children }) {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const value = useMemo(() => ({
    path,
    navigate(next, replace = false) {
      window.history[replace ? 'replaceState' : 'pushState']({}, '', next);
      setPath(next);
      window.scrollTo({ top: 0, behavior: 'auto' });
    },
  }), [path]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function AppLink({ to, className, end = false, children, ...props }) {
  const { path, navigate } = useContext(RouterContext);
  const isActive = end ? path === to : path === to || path.startsWith(`${to}/`);
  return (
    <a
      href={to}
      className={typeof className === 'function' ? className({ isActive }) : className}
      onClick={(event) => {
        if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
          event.preventDefault();
          navigate(to);
        }
      }}
      {...props}
    >
      {children}
    </a>
  );
}

export const useRouter = () => useContext(RouterContext);
