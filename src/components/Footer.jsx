import { Logo, CLIText } from "./Logo.jsx";

export function Footer({ onAbout }) {
  return (
    <footer className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-md bg-black/30">
      <div className="max-w-2xl mx-auto px-5"><div className="h-[1px] bg-white/[0.12]" /></div>
      <div className="max-w-2xl mx-auto px-5 py-2.5 flex items-center justify-center gap-2">
        <Logo className="w-4 h-4 opacity-70" />
        <button
          onClick={onAbout}
          className="font-mono text-[11px] tracking-wide hover:text-white/90 transition-colors duration-200"
        >
          <CLIText />
        </button>
        <span className="text-white/80 text-[10px]">&middot;</span>
        <span className="font-mono text-[10px] text-white/80 tracking-wider">&copy; 2026 Sheer</span>
      </div>
    </footer>
  );
}
