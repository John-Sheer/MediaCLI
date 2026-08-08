import { Logo, CLIText, CLI_COLOR } from "./Logo.jsx";
import VpnButton from "./VpnButton.jsx";
import { ListMusic } from "lucide-react";

export function HomeHeader({ torActive, onToggleTor, onAbout }) {
  return (
    <header className="pt-3 pb-3" data-tauri-drag-region>
      <div className="flex items-center justify-between">
        <div className="animate-fade-in flex items-center gap-4">
          <button
            onClick={onAbout}
            className="relative w-12 h-12 rounded-xl bg-gradient-to-b from-surface to-panel ring-1 ring-white/[0.08] flex items-center justify-center shrink-0 hover:ring-accent-red/40 hover:bg-accent-red/[0.04] transition-all duration-300 group active:scale-95"
          >
            <span className="absolute inset-0 rounded-xl bg-gradient-to-br from-accent-red/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <Logo className="w-8 h-8 relative" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              <CLIText />
            </h1>
            <p className="text-[11px] text-muted tracking-wide mt-0.5">
              Bibliothèque multimédia · Local &amp; Streaming
            </p>
          </div>
        </div>
        <VpnButton torActive={torActive} onToggle={onToggleTor} />
      </div>
      <div className="mt-3 h-px" style={{ background: `linear-gradient(to right, transparent, rgba(255,59,92,0.25), transparent)` }} />
    </header>
  );
}

export function HomeTabs({ homeTab, onSwitch, playlistCount }) {
  return (
    <div className="flex items-center justify-center gap-2 my-3 p-1 rounded-xl bg-black ring-1 ring-white/[0.06] w-fit mx-auto">
      <button
        onClick={() => onSwitch("streaming")}
        className={`tab-pill px-5 py-2 rounded-lg text-xs font-medium border ${
          homeTab === "streaming" ? "tab-pill-active" : "border-transparent text-muted hover:text-white"
        }`}
      >
        Lecture Streaming
      </button>
      <button
        onClick={() => onSwitch("local")}
        className={`tab-pill px-5 py-2 rounded-lg text-xs font-medium border ${
          homeTab === "local" ? "tab-pill-active" : "border-transparent text-muted hover:text-white"
        }`}
      >
        Lecture Local
      </button>
      <button
        onClick={() => onSwitch("playlists")}
        className={`tab-pill inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium border ${
          homeTab === "playlists" ? "tab-pill-active" : "border-transparent text-muted hover:text-white"
        }`}
      >
        <ListMusic className="w-3.5 h-3.5" />
        Playlists
        {playlistCount > 0 && (
          <span className="text-[9px] opacity-90">{playlistCount}</span>
        )}
      </button>
    </div>
  );
}
