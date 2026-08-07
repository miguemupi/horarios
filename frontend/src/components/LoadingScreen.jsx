export function LoadingScreen() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-zinc-50 dark:bg-zinc-950"><div className="size-10 animate-spin rounded-full border-4 border-zinc-200 border-t-brand-400 motion-reduce:animate-none dark:border-zinc-800 dark:border-t-brand-400" role="status"><span className="sr-only">Cargando</span></div></div>;
}
