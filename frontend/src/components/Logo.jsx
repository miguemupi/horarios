export function Logo({ compact = false }) {
  return (
    <span className={`inline-flex items-center rounded-xl bg-zinc-950 ${compact ? 'h-11 w-14 px-2' : 'h-14 w-52 px-4'} overflow-hidden`}>
      <img src="/factoria-serendipia-logo.png" alt="Factoría Serendipia" width="493" height="156" className="h-auto w-full object-contain" />
    </span>
  );
}
