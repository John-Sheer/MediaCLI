import { Logo, CLIText } from "./Logo.jsx";
import VpnButton from "./VpnButton.jsx";
import { ListMusic, Settings as SettingsIcon } from "lucide-react";

export function HomeHeader({ torActive, onToggleTor, onAbout, onSettings }) {
  return (
    <header className="pt-3 pb-1.5" data-tauri-drag-region>
      <div className="flex items-center justify-between">
        <div className="animate-fade-in flex items-center gap-2.5">
          <button
            onClick={onAbout}
            className="w-11 h-11 rounded-xl bg-gradient-to-b from-surface to-panel ring-1 ring-white/[0.08] flex items-center justify-center shrink-0 hover:ring-accent-red/40 hover:bg-accent-red/[0.04] transition-all duration-300 group active:scale-95 p-0 overflow-hidden"
          >
            <Logo className="w-11 h-11" />
          </button>
          <div>
            <h1 className="text-base font-bold tracking-tight leading-tight">
              <CLIText />
            </h1>
            <p className="text-[9px] text-muted tracking-wide mt-0.5 leading-none">
              Local &amp; Streaming
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <VpnButton torActive={torActive} onToggle={onToggleTor} />
          <button
            onClick={onSettings}
            title="Paramètres"
            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md text-white/55 ring-1 ring-white/[0.10] hover:text-white hover:bg-white/[0.06] hover:ring-white/25 transition-all duration-200 active:scale-95"
          >
            <SettingsIcon size={13} />
          </button>
        </div>
      </div>
      <div className="mt-2 h-px" style={{ background: `linear-gradient(to right, transparent, rgba(255,59,92,0.25), transparent)` }} />
    </header>
  );
}

export function HomeTabs({ homeTab, onSwitch, playlistCount, ...rest }) {
  return (
    <div {...rest} className="flex items-center justify-center gap-1.5 my-2 p-1 rounded-xl bg-black ring-1 ring-white/[0.06] w-fit mx-auto">
      <button
        onClick={() => onSwitch("streaming")}
        className={`tab-pill px-4 py-1.5 rounded-lg text-xs font-medium border ${
          homeTab === "streaming" ? "tab-pill-active" : "border-transparent text-muted hover:text-white"
        }`}
      >
        Lecteur Streaming
      </button>
      <button
        onClick={() => onSwitch("local")}
        className={`tab-pill px-4 py-1.5 rounded-lg text-xs font-medium border ${
          homeTab === "local" ? "tab-pill-active" : "border-transparent text-muted hover:text-white"
        }`}
      >
        Lecteur Local
      </button>
      <button
        onClick={() => onSwitch("playlists")}
        className={`tab-pill inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium border ${
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
