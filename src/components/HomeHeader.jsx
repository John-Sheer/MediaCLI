import { Logo, CLIText } from "./Logo.jsx";
import VpnButton from "./VpnButton.jsx";
import { ListMusic } from "lucide-react";

export function HomeHeader({ torActive, onToggleTor, onAbout }) {
  return (
    <header className="pt-7 pb-2" data-tauri-drag-region>
      <div className="flex items-center justify-between">
        <div className="animate-fade-in flex items-center gap-3">
          <button
            onClick={onAbout}
            className="w-[67px] h-[67px] rounded-2xl bg-gradient-to-b from-surface to-panel ring-1 ring-white/[0.08] flex items-center justify-center shrink-0 hover:ring-accent-red/40 hover:bg-accent-red/[0.04] transition-all duration-300 group active:scale-95 p-0 overflow-hidden"
          >
            <Logo className="w-[67px] h-[67px]" />
          </button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              <CLIText />
            </h1>
            <p className="text-[10px] text-muted tracking-wide mt-0.5">
              Bibliothèque multimédia · Local &amp; Streaming
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <VpnButton torActive={torActive} onToggle={onToggleTor} />
        </div>
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
