import { useState } from "react";
import { FolderOpen, AlertCircle, RefreshCw, X, Sparkles, Play, Music2 } from "lucide-react";
import SearchBar from "./SearchBar.jsx";
import SongCard from "./SongCard.jsx";
import { addRecentSearch, getRecentSearches } from "../lib/suggestions.js";

const THUMB_PROXY = "http://127.0.0.1:8787/thumb?url=";
const IDLE_TAGS = [
  "pop", "r&b", "afrobeats", "latin", "hip-hop",
  "rock", "reggae", "house", "jazz", "k-pop",
];

function IdleDiscover({ state, onSearch, onOpenPlayer }) {
  const song = state.currentSong;
  return (
    <div className="animate-fade-in-up max-w-lg">
      {song && (
        <button
          onClick={onOpenPlayer}
          title="Ouvrir le lecteur"
          className="w-full flex items-center gap-3 rounded-2xl ring-1 ring-white/[0.08] bg-white/[0.03] p-3 mb-5 text-left hover:bg-white/[0.05] hover:ring-white/20 transition-all duration-200 active:scale-[0.99]"
        >
          <span className="relative w-11 h-11 rounded-xl overflow-hidden ring-1 ring-white/15 shrink-0">
            {song.thumbnail ? (
              <img src={THUMB_PROXY + encodeURIComponent(song.thumbnail)} alt="" className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <span className="w-full h-full flex items-center justify-center bg-white/[0.05]">
                <Music2 className="w-4 h-4 text-white/80" />
              </span>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full" style={{ boxShadow: "0 0 0 2px #0b0b12" }}>
              <span className="absolute inset-0 rounded-full bg-red animate-ping opacity-70" />
              <span className="relative block w-3 h-3 rounded-full bg-red" />
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[9px] font-mono uppercase tracking-[0.15em] text-muted/80">En cours</span>
            <span className="block truncate text-[12px] font-semibold text-white/90">{song.title}</span>
            <span className="block truncate text-[10px] text-muted">{song.channel}</span>
          </span>
          <span className="flex items-center gap-1 text-[10px] text-red/90 shrink-0">
            Ouvrir
            <Play className="w-3 h-3 ml-px" fill="currentColor" />
          </span>
        </button>
      )}
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-3.5 h-3.5 text-white/70" />
        <p className="text-[11px] text-white/85 font-medium">Explorer par genre</p>
        <span className="text-[9.5px] text-white/40 font-mono hidden sm:inline">un tap lance la recherche</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {IDLE_TAGS.map((t) => (
          <button
            key={t}
            onClick={() => onSearch(t)}
            className="px-3 py-1.5 rounded-full text-[11px] font-medium text-white/85 bg-white/[0.04] ring-1 ring-white/[0.10] hover:text-white hover:bg-white/[0.09] hover:ring-white/25 transition-all duration-200 active:scale-95"
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 px-3 animate-fade-in-up" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-white/[0.06] bg-panel/70 overflow-hidden animate-fade-in"
          style={{ animationDelay: `${i * 70}ms` }}
        >
          <div className="aspect-video shimmer-block" />
          <div className="p-3 space-y-2.5">
            <div className="h-3 w-4/5 rounded-full shimmer-block" />
            <div className="h-2.5 w-1/2 rounded-full shimmer-block opacity-70" />
            <div className="flex gap-2 pt-1.5">
              <div className="h-8 flex-1 rounded-lg shimmer-block" />
              <div className="h-8 flex-1 rounded-lg shimmer-block" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ error, onRetry }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center animate-fade-in-up">
      <div className="w-12 h-12 rounded-2xl bg-accent-red/[0.06] ring-1 ring-accent-red/15 flex items-center justify-center">
        <AlertCircle className="w-5 h-5 text-accent-red/90" />
      </div>
      <div>
        <p className="text-[13px] text-white/85 font-medium">Oups, une erreur</p>
        <p className="text-[11px] text-white/80 mt-1 max-w-[260px] leading-relaxed">{error}</p>
      </div>
      <button
        onClick={onRetry}
        className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-medium text-accent-red/90 hover:text-accent-red ring-1 ring-accent-red/15 hover:ring-accent-red/30 hover:bg-accent-red/[0.05] transition-all duration-300 active:scale-95"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Réessayer
      </button>
    </div>
  );
}

function SearchLabel() {
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-glow/60" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red" />
      </span>
      <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted/70">
        Recherche streaming
      </span>
    </div>
  );
}

export function StreamingView({ state, onSearch, onPlay, onDownload, onTogglePause, onQueryChange, onMenuToggle, onAddToPlaylist, onCreateAndAdd, onOpenDownloads, onResume, onAuthorize, onOpenPlayer }) {
  const { results, loading, searchError, query, menuSongId, downloadStatus, downloadProgress, downloadPaused, downloadErrors, playlists, currentSong, isLocal } = state;
  const activeCount = Object.values(downloadStatus).filter((s) => s === "downloading").length;

  const [revealedId, setRevealedId] = useState(null);

  const reveal = (id) => setRevealedId(id);

  const handleSearch = (q) => {
    addRecentSearch(q || query);
    onSearch(q || query);
    setRevealedId(null);
  };

  const handleClear = () => {
    setRevealedId(null);
    onQueryChange("");
  };

  return (
    <section className="relative flex-1 min-h-0 flex flex-col">
      <div className="relative z-10 pt-5 px-4 mb-3">
        <SearchLabel />
        <SearchBar query={query} setQuery={onQueryChange} onSearch={() => handleSearch(query)} loading={loading} />
      </div>

      {!loading && results.length === 0 && !searchError && (
        <div className="px-4 pb-6">
          <IdleDiscover state={state} onSearch={handleSearch} onOpenPlayer={onOpenPlayer} />
        </div>
      )}

      {loading && <ResultsSkeleton />}

      {!loading && results.length > 0 && (
        <>
          <div
            className="sticky top-0 z-10 backdrop-blur-2xl bg-bg/80 px-4 pt-2 pb-2.5"
            onMouseLeave={() => onMenuToggle(null)}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] ring-1 ring-white/[0.08] px-3 py-1.5 shadow-subtle">
                  <span className="text-[11px] font-bold text-red drop-shadow-[0_0_6px_rgba(255,59,92,0.4)]">
                    {results.length}
                  </span>
                  <span className="text-[11px] text-white/80 font-medium">
                    résultat{results.length > 1 ? "s" : ""}
                  </span>
                </span>
                {activeCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gold whitespace-nowrap">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold/40" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-gold" />
                    </span>
                    {activeCount} en cours
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => onOpenDownloads && onOpenDownloads()}
                  title="Ouvrir le dossier des téléchargements"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-white/75 hover:text-white/90 hover:bg-white/[0.06] transition-all duration-200 active:scale-95"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Dossier
                </button>
                <button
                  onClick={handleClear}
                  title="Effacer la recherche"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-white/60 hover:text-red hover:bg-white/[0.06] transition-all duration-200 active:scale-95"
                >
                  <X className="w-3.5 h-3.5" />
                  Effacer
                </button>
              </div>
            </div>
            <div className="mt-2 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(255,59,92,0.3), transparent)" }} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 px-3 pt-2 animate-fade-in-up" onMouseLeave={() => onMenuToggle(null)}>
            {results.map((song) => (
              <SongCard
                key={song.id}
                song={song}
                onPlay={onPlay}
                onDownload={onDownload}
                onTogglePause={onTogglePause}
                status={{
                  audio: downloadStatus[`${song.id}-audio`],
                  video: downloadStatus[`${song.id}-video`],
                }}
                progress={{
                  audio: downloadProgress[`${song.id}-audio`],
                  video: downloadProgress[`${song.id}-video`],
                }}
                paused={{
                  audio: downloadPaused[`${song.id}-audio`],
                  video: downloadPaused[`${song.id}-video`],
                }}
                errors={{
                  audio: downloadErrors[`${song.id}-audio`],
                  video: downloadErrors[`${song.id}-video`],
                }}
                menuOpen={menuSongId === song.id}
                onMenuToggle={(id) => onMenuToggle(id)}
                playlists={playlists}
                onAddToPlaylist={onAddToPlaylist}
                onCreateAndAdd={onCreateAndAdd}
                isPlaying={currentSong?.id === song.id}
                showPlay={revealedId === song.id}
                onReveal={() => reveal(song.id)}
                onAuthorize={onAuthorize}
              />
            ))}
          </div>
        </>
      )}

      {!loading && searchError && <ErrorState error={searchError} onRetry={() => onSearch(query)} />}
    </section>
  );
}