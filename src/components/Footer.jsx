import { Logo, CLIText } from "./Logo.jsx";
import { Settings as SettingsIcon } from "lucide-react";

const COPYRIGHT_YEAR = new Date().getFullYear();

export function Footer({ onAbout, onSettings }) {
  return (
    <footer className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-md bg-black/30" style={{ paddingBottom: `var(--sab, 0px)` }}>
      <div className="max-w-2xl mx-auto px-5"><div className="h-[1px] bg-white/[0.12]" /></div>
      <div className="max-w-2xl mx-auto px-5 py-2 flex items-center relative">
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
          <Logo className="w-4 h-4 opacity-70" />
          <button onClick={onAbout} className="font-mono text-[11px] tracking-wide hover:text-white/90 transition-colors duration-200">
            <CLIText />
          </button>
          <span className="font-mono text-[11px] text-red-500 tracking-wider font-bold">© {COPYRIGHT_YEAR} Sheer</span>
        </div>
        <button onClick={onSettings} className="ml-auto p-1.5 rounded-lg text-white/50 hover:text-white/80 hover:bg-white/[0.06] transition-colors" title="Paramètres">
          <SettingsIcon size={18} />
        </button>
      </div>
    </footer>
  );
}
