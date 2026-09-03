import { useState, useEffect, useRef } from "react";
import { AlertCircle, RefreshCw, X, History, Play, Pause, Music2, Loader2, Search, ChevronRight } from "lucide-react";
import SearchBar from "./SearchBar.jsx";
import SongCard from "./SongCard.jsx";
import { addRecentSearch, getRecentSearches } from "../lib/suggestions.js";
import { thumbUrl, getThumb } from "../lib/thumb.js";
import Tooltip from "./Tooltip.jsx";

const IDLE_TAGS = [
  "pop", "r&b", "afrobeats", "latin", "hip-hop",
  "rock", "reggae", "house", "jazz", "k-pop",
];

export function NowPlayingBar({ state, onResume }) {
  const song = state.currentSong;
  const queue = state.playlist || [];
  const playing = state.isPlaying;
  const togglePlay = () => {
    window.dispatchEvent(new Event("mediacli-toggle-play"));
  };
  if (!song) return null;
  return (
    <div className="max-w-2xl mx-auto px-5" data-nowplaying>
      <button
        onClick={playing ? togglePlay : () => onResume && onResume(song, queue)}
        title={playing ? "Mettre en pause" : "Reprendre la lecture en cours"}
        className="w-full flex items-center gap-3 rounded-2xl ring-1 ring-white/[0.08] bg-white/[0.03] p-3 my-3 text-left hover:bg-white/[0.05] hover:ring-white/20 transition-all duration-200 active:scale-[0.99]"
      >
        <span className="relative w-11 h-11 rounded-xl overflow-hidden ring-1 ring-white/15 shrink-0 bg-white/10">
          <img
            src={getThumb(song.thumbnail) ? thumbUrl(song.thumbnail) : ""}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
          <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Music2 className="w-5 h-5 text-white/60" />
          </span>
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
        <span
          className={
            "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold tracking-wide transition-all duration-200 " +
            (playing
              ? "bg-white text-[#0b0b12] hover:bg-white/85 shadow-[0_0_16px_-4px_rgba(255,255,255,0.4)]"
              : "bg-accent-red text-white ring-1 ring-accent-red/40 hover:bg-glow shadow-[0_0_20px_-4px_rgba(200,30,58,0.7)]")
          }
        >
          {playing ? (
            <>
              Pause
              <Pause className="w-3 h-3 ml-px" fill="currentColor" />
            </>
          ) : (
            <>
              Reprendre
              <Play className="w-3 h-3 ml-px" fill="currentColor" />
            </>
          )}
        </span>
      </button>
    </div>
  );
}

function IdleDiscover({ state, onSearch, onOpenPlayer, onResume }) {
  const [recent, setRecent] = useState(getRecentSearches());
  useEffect(() => {
    setRecent(getRecentSearches());
  }, [state.query, state.results]);
  return (
    <div className="animate-fade-in-up flex-1 flex flex-col max-w-none">
      <div className="mt-1 flex-1 flex flex-col">
        <div className="flex items-center gap-2 mb-3" data-tutorial="genre-search">
          <span className="w-7 h-7 rounded-lg bg-white/[0.04] ring-1 ring-white/[0.12] flex items-center justify-center shrink-0">
            <History className="w-3.5 h-3.5 text-white/80" />
          </span>
          <p className="text-[11px] text-white/85 font-semibold tracking-wide">Historique de vos recherches</p>
        </div>
        {recent.length > 0 ? (
          <div className="rounded-2xl border border-white/[0.07] bg-panel/50 overflow-hidden flex-1">
            {recent.slice(0, 10).map((t, i) => (
              <button
                key={t}
                onClick={() => onSearch(t)}
                className={
                  "w-full flex items-center gap-3 px-3.5 py-4 text-left transition-all duration-200 active:scale-[0.99] hover:bg-white/[0.05] " +
                  (i !== 0 ? "border-t border-white/[0.05]" : "")
                }
              >
                <span className="shrink-0 w-9 h-9 rounded-lg bg-white/[0.04] ring-1 ring-white/[0.10] flex items-center justify-center">
                  <History className="w-4 h-4 text-white/60" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white/90">{t}</span>
                <ChevronRight className="w-4 h-4 text-white/30 shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/[0.07] bg-panel/50 p-4">
            <p className="text-[11px] text-muted/85 mb-3">Aucune recherche récente. Pour démarrer :</p>
            <div className="flex flex-wrap gap-2">
              {IDLE_TAGS.slice(0, 8).map((t) => (
                <button
                  key={t}
                  onClick={() => onSearch(t)}
                  className="px-3 py-2 rounded-full text-[11px] font-medium text-white/85 bg-white/[0.04] ring-1 ring-white/[0.10] hover:text-white hover:bg-white/[0.09] hover:ring-white/25 transition-all duration-200 active:scale-95"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SearchLoading({ query }) {
  return (
    <div className="animate-fade-in-up">
      {/* En-tête de chargement : spinner + texte */}
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <Loader2 className="w-7 h-7 text-accent-red animate-spin" />
        <div>
          <p className="text-[13px] text-white/85 font-medium">Recherche en cours…</p>
          {query ? (
            <p className="mt-0.5 text-[11px] text-white/55 max-w-[260px] truncate font-mono">
              “{query}”
            </p>
          ) : (
            <p className="mt-0.5 h-3" />
          )}
        </div>
      </div>

      {/* Pré-grille de skeletons (contexte des futurs résultats) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 px-3" aria-hidden="true">
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

export function StreamingView({ state, onSearch, onLoadMore, onPlay, onDownload, onTogglePause, onQueryChange, onMenuToggle, onAddToPlaylist, onCreateAndAdd, onOpenDownloads, onResume, onAuthorize, onOpenPlayer, onStreamPlay }) {
  const { results, loading, searchError, query, menuSongId, downloadStatus, downloadProgress, downloadPaused, downloadErrors, playlists, currentSong, isLocal, moreLoading, moreVariants } = state;
  const activeCount = Object.values(downloadStatus).filter((s) => s === "downloading").length;

  const [revealedId, setRevealedId] = useState(null);
  const searchRef = useRef(null);
  const [searchAway, setSearchAway] = useState(false);
  const [fabTop, setFabTop] = useState(null);
  const moreRef = useRef(null);

  useEffect(() => {
    const el = searchRef.current;
    if (!el) return;
    const tabs = document.querySelector("[data-tabs]");
    if (tabs) setFabTop(tabs.getBoundingClientRect().bottom + 10);
    const updater = () => {
      const r = el.getBoundingClientRect();
      let away = false;
      if (tabs) {
        away = r.bottom < tabs.getBoundingClientRect().bottom;
      } else {
        away = r.bottom < 0;
      }
      setSearchAway(away);
    };
    updater();
    const targets = [window];
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const s = getComputedStyle(node).overflowY;
      if (s === "auto" || s === "scroll" || s === "overlay") targets.push(node);
      node = node.parentElement;
    }
    const onScroll = () => updater();
    targets.forEach((t) => t.addEventListener("scroll", onScroll, { passive: true }));
    return () => targets.forEach((t) => t.removeEventListener("scroll", onScroll));
  }, [results.length, loading, query]);

  // Scroll infini : dès que la sentinelle de fin de liste devient visible, on
  // déclenche le chargement de « contenus similaires » suivants (terms variés
  // construits par l'action loadMore).
  useEffect(() => {
    const el = moreRef.current;
    if (!el || !onLoadMore || moreVariants.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !moreLoading) onLoadMore();
      },
      { root: null, rootMargin: "200px 0px 200px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [results.length, moreLoading, moreVariants.length, query, onLoadMore]);

  const scrollToSearch = () => {
    const el = searchRef.current;
    // Rendre la barre de recherche visible avant de scroller/focuser (sinon un
    // élément hidden ne peut pas être focusé et le curseur ne clignote pas).
    if (el) {
      el.classList.remove("hidden");
    }
    let node = el;
    while (node && node !== document.documentElement) {
      const s = getComputedStyle(node).overflowY;
      if (s === "auto" || s === "scroll" || s === "overlay") {
        if (node.scrollTop > 0) node.scrollTo({ top: 0, behavior: "smooth" });
      }
      node = node.parentElement;
    }
    window.dispatchEvent(new Event("mediacli-focus-search"));
  };

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
      <div ref={searchRef} className={"relative z-10 pt-5 px-4 mb-3" + (results.length > 0 ? " hidden" : "")}>
        <SearchLabel />
        <SearchBar query={query} setQuery={onQueryChange} onSearch={() => handleSearch(query)} loading={loading} />
      </div>

      {!loading && results.length === 0 && !searchError && (
        <div className="px-4 pb-6 flex-1 flex flex-col">
          <IdleDiscover state={state} onSearch={handleSearch} onResume={onStreamPlay} />
        </div>
      )}

      {loading && <SearchLoading query={query} />}

      {!loading && results.length > 0 && (
        <>
          <div
            className="sticky top-0 z-40 backdrop-blur-2xl bg-bg/80 px-4 pt-2 pb-2.5"
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
            {results.map((song, idx) => (
              <SongCard
                key={song.id}
                song={song}
                onPlay={onPlay}
                onDownload={onDownload}
                onTogglePause={onTogglePause}
                tutorial={idx === 0 ? "tap-play" : undefined}
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
                onReveal={() => setRevealedId(song.id)}
                onAuthorize={onAuthorize}
              />
            ))}
          </div>

          {moreVariants.length > 0 && (
            <div ref={moreRef} className="flex items-center justify-center gap-2 py-6 text-[12px] text-white/50">
              {moreLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Chargement de contenus similaires…
                </>
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </div>
          )}
        </>
      )}

      {!loading && searchError && <ErrorState error={searchError} onRetry={() => onSearch(query)} />}

      {searchAway && (
        <Tooltip label="Revenir à la recherche" side="bottom">
        <button
          onClick={scrollToSearch}
          className="fixed right-4 z-30 w-11 h-11 rounded-full bg-accent-red/90 text-white flex items-center justify-center shadow-[0_4px_24px_-4px_rgba(200,30,58,0.7)] hover:bg-glow active:scale-95 transition-all duration-200 animate-fade-in"
          style={{ top: (fabTop ?? 150) + 110 }}
        >
          <Search className="w-4 h-4" />
        </button>
        </Tooltip>
      )}
    </section>
  );
}