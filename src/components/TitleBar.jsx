import { Minus, Minimize2, Square, X } from "lucide-react";
import { Logo, CLIText } from "./Logo.jsx";
import { useWindow } from "../hooks/useWindow.js";

export function TitleBar({ onAbout }) {
  const { maximized, minimize, close, toggleMaximize } = useWindow();

  return (
    <div className="h-9 flex items-center justify-between bg-bg/80 backdrop-blur-md select-none shrink-0">
      <div className="flex items-center gap-1.5" data-tauri-drag-region>
        <button onClick={onAbout} className="flex items-center gap-1.5">
          <Logo className="w-5 h-5" />
          <span className="text-[10px] font-mono tracking-wide">
            <CLIText />
          </span>
        </button>
        <div className="w-px h-2.5 bg-accent-red/50" />
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={minimize}
          className="p-1.5 rounded-md text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={toggleMaximize}
          className="p-1.5 rounded-md text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors"
        >
          {maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={close}
          className="p-1.5 rounded-md text-white/80 hover:text-white hover:bg-red-500/20 hover:text-red-400 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
