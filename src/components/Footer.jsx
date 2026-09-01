import { Settings as SettingsIcon } from "lucide-react";

const COPYRIGHT_YEAR = new Date().getFullYear();

export function Footer({ onSettings }) {
  return (
    <footer className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-xl bg-black/40" style={{ paddingBottom: `var(--sab, 0px)` }}>
      <div className="max-w-2xl mx-auto px-5"><div className="h-px" style={{ background: `linear-gradient(to right, transparent, rgba(255,59,92,0.25), transparent)` }} /></div>
      <div className="max-w-2xl mx-auto px-5 py-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-white/45 tracking-wider whitespace-nowrap">
          © {COPYRIGHT_YEAR} Sheer
        </span>
        <button
          onClick={onSettings}
          title="Paramètres"
          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white/55 ring-1 ring-white/[0.10] hover:text-white hover:bg-white/[0.06] hover:ring-white/25 transition-all duration-200 active:scale-95"
        >
          <SettingsIcon size={13} />
          <span className="text-[10px] font-medium tracking-wide">Réglages</span>
        </button>
      </div>
    </footer>
  );
}
