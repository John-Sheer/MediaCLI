import { useState } from "react";
import { Headphones, Music, Loader2, Check, Play, Download, Plus, ListPlus, AudioLines, AlertTriangle } from "lucide-react";

const THUMB_PROXY = "http://127.0.0.1:8787/thumb?url=";

function formatDuration(seconds) {
  if (!seconds) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function ErrorTag({ info, onAuthorize }) {
  if (!info) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[9px] text-red-400/90 leading-none" title={info.message}>
      <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
      <span className="font-mono shrink-0">[{info.code}]</span>
      <span className="truncate">{info.message}</span>
      {info.code === "PERM" && onAuthorize && (
        <button
          onClick={onAuthorize}
          className="shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-semibold text-accent-red bg-accent-red/[0.10] ring-1 ring-accent-red/25 hover:bg-accent-red/[0.18] hover:ring-accent-red/50 transition-all duration-150 active:scale-95"
        >
          Autoriser
        </button>
      )}
    </span>
  );
}

export default function SongCard({ song, onPlay, onDownload, status, progress, errors = {}, menuOpen, onMenuToggle, playlists = {}, onAddToPlaylist, onCreateAndAdd, isPlaying, onAuthorize }) {
  const [showPlSub, setShowPlSub] = useState(false);

  const addToPl = (id) => {
    if (id === "__new") onCreateAndAdd && onCreateAndAdd(song);
    else onAddToPlaylist && onAddToPlaylist(id, song);
    setShowPlSub(false);
    onMenuToggle();
  };

  const mp3Size = song.duration > 0 ? ((song.duration * 128) / 8 / 1024).toFixed(1) : null;
  const mp4Size = song.duration > 0 ? ((song.duration * 600) / 8 / 1024).toFixed(1) : null;

  const realSize = (type) => {
    if (type === "audio") return song.audioSize ? (song.audioSize / 1048576).toFixed(1) : mp3Size;
    return song.videoSize ? (song.videoSize / 1048576).toFixed(1) : mp4Size;
  };

  const renderButton = (type, label, Icon) => {
    const isDownloading = status?.[type] === "downloading";
    const isDone = status?.[type] === "done";
    const isError = status?.[type] === "error";
    const percent = progress?.[type] || 0;
    const size = realSize(type);

    return (
      <button
        onClick={(e) => { e.stopPropagation(); onDownload(song, type); }}
        disabled={isDownloading || isDone}
        title={isError ? `Échec du téléchargement ${label} — réessayer` : `Télécharger ${label}`}
        className={`group/btn relative flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-lg overflow-hidden transition-all duration-300 active:scale-[0.93] disabled:cursor-default ${
          isDone
            ? "text-green-400/90 bg-green-400/[0.08]"
            : isDownloading
              ? "text-green-400/90 bg-green-400/[0.06] pb-2.5"
              : isError
                ? "text-red-400/90 bg-red-500/[0.08] hover:bg-red-500/[0.14]"
                : "text-white/80 hover:text-green-400/90 hover:bg-green-400/[0.08]"
        }`}
      >
        {isDownloading ? (
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
        ) : isDone ? (
          <Check className="w-3 h-3 shrink-0" />
        ) : isError ? (
          <AlertTriangle className="w-3 h-3 shrink-0" />
        ) : (
          <Icon className="w-3 h-3 shrink-0 transition-transform duration-200 group-hover/btn:scale-110" />
        )}
        <span className="text-[10px] font-medium leading-none">{isDownloading ? `${Math.round(percent)}%` : isError ? "Réessayer" : label}</span>
        {!isDownloading && <span className="text-[9px] leading-none text-green-400/85 group-hover/btn:text-green-300 transition-colors">{size} Mo</span>}
        {isDownloading && (
          <div className="absolute left-0 right-0 bottom-[3px] h-[2px] bg-white/[0.06] rounded-full overflow-hidden mx-1">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-green-300 rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(3, percent)}%`, boxShadow: "0 0 6px rgba(74,222,128,0.4)" }}
            />
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="relative animate-fade-in">
      <div
        onClick={() => onPlay(song)}
        className={`group relative flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3 py-2 rounded-xl cursor-pointer transition-all duration-200 border ${
          isPlaying
            ? "bg-accent-red/[0.07] border-accent-red/40 shadow-[0_0_16px_-6px_rgba(200,30,58,0.45)]"
            : "bg-panel/70 border-white/[0.07] hover:border-white/[0.18] hover:bg-white/[0.03]"
        }`}
      >
        {isPlaying && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-accent-red shadow-[0_0_8px_rgba(200,30,58,0.5)]" />
        )}

        <div
          className={`relative shrink-0 w-11 h-11 rounded-xl overflow-hidden flex items-center justify-center transition-all duration-300 ${
            isPlaying
              ? "ring-1 ring-accent-red/30 shadow-[0_0_12px_-2px_rgba(200,30,58,0.3)]"
              : "ring-1 ring-white/[0.06] group-hover:ring-white/[0.12]"
          }`}
        >
          {song.thumbnail ? (
            <img
              src={`${THUMB_PROXY}${encodeURIComponent(song.thumbnail)}`}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          ) : (
            <div className="w-full h-full bg-white/[0.04] flex items-center justify-center">
              <Music className="w-4 h-4 text-white/80" />
            </div>
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 flex items-center justify-center">
            {isPlaying ? (
              <AudioLines className="w-4 h-4 text-accent-red opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
            ) : (
              <Play className="w-4 h-4 text-white opacity-0 group-hover:opacity-90 transition-opacity duration-200" fill="currentColor" />
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <p className={`text-[13px] font-medium line-clamp-1 leading-snug transition-colors duration-200 ${
            isPlaying
              ? "text-white"
              : "text-white/90 group-hover:text-white/90"
          }`}>
            {song.title}
          </p>
          <p className={`text-[11px] truncate mt-0.5 transition-colors duration-200 ${
            isPlaying ? "text-green-400/90" : "text-green-400/85 group-hover:text-green-300"
          }`}>{song.channel}</p>
        </div>

        <span className="shrink-0 text-[11px] font-mono text-green-400/90 group-hover:text-green-300 transition-colors duration-200 tabular-nums">{formatDuration(song.duration)}</span>

        <div className="flex items-center gap-1.5 w-full sm:w-auto sm:ml-auto sm:justify-start justify-end" onClick={(e) => e.stopPropagation()}>
          {renderButton("audio", "MP3", Download)}
          {renderButton("video", "MP4", Download)}
        </div>
        {(errors.audio || errors.video) && (
          <div className="w-full flex flex-wrap items-center gap-x-3 gap-y-0.5 justify-end pr-1" onClick={(e) => e.stopPropagation()}>
            <ErrorTag info={errors.audio} onAuthorize={onAuthorize} />
            <ErrorTag info={errors.video} onAuthorize={onAuthorize} />
          </div>
        )}
      </div>

      {menuOpen && (
        <div className="absolute right-2 top-2 z-30 min-w-[200px] bg-surface/95 backdrop-blur-xl border border-white/[0.08] rounded-xl p-1.5 shadow-2xl animate-fade-in-down origin-top-right">
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(song); onMenuToggle(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-white/90 hover:bg-accent-red/10 hover:text-accent-red transition-all duration-150"
          >
            <Headphones className="w-3.5 h-3.5" />
            Écouter
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDownload(song, "audio"); onMenuToggle(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-white/90 hover:bg-accent-red/10 hover:text-accent-red transition-all duration-150"
          >
            <Music className="w-3.5 h-3.5" />
            Télécharger audio
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDownload(song, "video"); onMenuToggle(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-white/90 hover:bg-accent-red/10 hover:text-accent-red transition-all duration-150"
          >
            <Music className="w-3.5 h-3.5" />
            Télécharger vidéo
          </button>
          <div className="my-1 h-px bg-white/[0.06]" />
          <button
            onClick={(e) => { e.stopPropagation(); setShowPlSub((s) => !s); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-white/90 hover:bg-accent-red/10 hover:text-accent-red transition-all duration-150"
          >
            <ListPlus className="w-3.5 h-3.5" />
            Ajouter à une playlist
          </button>
          {showPlSub && (
            <div className="max-h-40 overflow-y-auto scroll-modern pl-2 pr-1 py-1 space-y-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); addToPl("__new"); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-accent-red hover:bg-accent-red/10 transition-all duration-150"
              >
                <Plus className="w-3 h-3" />
                Nouvelle playlist…
              </button>
              {Object.values(playlists).map((pl) => (
                <button
                  key={pl.id}
                  onClick={(e) => { e.stopPropagation(); addToPl(pl.id); }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs text-white/90 hover:bg-white/[0.06] transition-all duration-150"
                >
                  <span className="truncate">{pl.name}</span>
                  <span className="text-[9px] font-mono text-muted/80 shrink-0">{pl.tracks.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
