import { FolderOpen, AlertCircle, RefreshCw, Music } from "lucide-react";
import SearchBar from "./SearchBar.jsx";
import SongCard from "./SongCard.jsx";
import HomeIdleContent, { addRecentSearch } from "./HomeIdleContent.jsx";

function LoadingState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center animate-fade-in">
      <div className="relative w-10 h-10">
        <div className="absolute inset-0 rounded-full border border-white/[0.06]" />
        <div className="absolute inset-0 rounded-full border-[1.5px] border-transparent border-t-accent-red/80 animate-spin" />
        <div className="absolute inset-2 rounded-full border border-transparent border-b-white/20 animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }} />
      </div>
      <div>
        <p className="text-[13px] text-white/80 font-medium">Recherche en cours</p>
        <p className="text-[11px] text-white/80 mt-1 font-mono">Patientez un instant…</p>
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

export function StreamingView({ state, onSearch, onPlay, onDownload, onQueryChange, onMenuToggle, onAddToPlaylist, onCreateAndAdd, onOpenDownloads, onResume }) {
  const { results, loading, searchError, query, menuSongId, downloadStatus, downloadProgress, playlists, currentSong } = state;
  const centered = results.length === 0 && !loading && !searchError;
  const activeCount = Object.values(downloadStatus).filter((s) => s === "downloading").length;

  const handleSearch = (q) => {
    addRecentSearch(q || query);
    onSearch(q || query);
  };

  return (
    <section className="relative flex-1 min-h-0 flex flex-col">
      <div className={`relative z-10 ${centered ? "pt-20" : "pt-5"} px-4 mb-10`}>
        <SearchBar query={query} setQuery={onQueryChange} onSearch={() => handleSearch(query)} loading={loading} />
      </div>

      {centered && !loading && (
        <div className="flex-1 min-h-0 flex flex-col justify-center">
          <HomeIdleContent onSearch={handleSearch} onQueryChange={onQueryChange} />
        </div>
      )}

      {loading && <LoadingState />}

      {!loading && results.length > 0 && (
        <>
          <div
            className="sticky top-0 z-10 backdrop-blur-xl bg-bg/70 px-4 pt-3 pb-2"
            onMouseLeave={() => onMenuToggle(null)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-white/80 font-medium">
                  {results.length} résultat{results.length > 1 ? "s" : ""}
                </span>
                {activeCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-accent-red/90">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-red/40" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-red" />
                    </span>
                    {activeCount} en cours
                  </span>
                )}
              </div>
              <button
                onClick={() => onOpenDownloads && onOpenDownloads()}
                title="Ouvrir le dossier des téléchargements"
                className="flex items-center gap-1.5 text-[11px] text-white/80 hover:text-white/80 transition-colors duration-200"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Dossier
              </button>
            </div>
          </div>

          <div className="space-y-1.5 px-3 animate-fade-in-up" onMouseLeave={() => onMenuToggle(null)}>
            {results.map((song) => (
              <SongCard
                key={song.id}
                song={song}
                onPlay={onPlay}
                onDownload={onDownload}
                status={{
                  audio: downloadStatus[`${song.id}-audio`],
                  video: downloadStatus[`${song.id}-video`],
                }}
                progress={{
                  audio: downloadProgress[`${song.id}-audio`],
                  video: downloadProgress[`${song.id}-video`],
                }}
                menuOpen={menuSongId === song.id}
                onMenuToggle={(id) => onMenuToggle(id)}
                playlists={playlists}
                onAddToPlaylist={onAddToPlaylist}
                onCreateAndAdd={onCreateAndAdd}
                isPlaying={currentSong?.id === song.id}
              />
            ))}
          </div>
        </>
      )}

      {!loading && searchError && <ErrorState error={searchError} onRetry={() => onSearch(query)} />}
    </section>
  );
}
