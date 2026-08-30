import { useState } from "react";
import { Headphones, Music, Check, Play, Pause, Download, Plus, ListPlus, AlertTriangle, MoreVertical } from "lucide-react";

const THUMB_PROXY = "http://127.0.0.1:8787/thumb?url=";

function formatDuration(seconds) {
  if (!seconds) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function ErrorTag({ info, onAuthorize }) {
  if (!info) return null;
  if (info.code === "PERM" && onAuthorize) {
    // Permission « Tous les fichiers » absente : n'afficher QUE le bouton
    // d'autorisation, qui envoie l'utilisateur dans les réglages Android.
    return (
      <button
        onClick={onAuthorize}
        className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-accent-red bg-accent-red/[0.10] ring-1 ring-accent-red/30 hover:bg-accent-red/[0.18] hover:ring-accent-red/55 transition-all duration-150 active:scale-95"
      >
        Autoriser l'accès aux fichiers
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-red-400/90 leading-none" title={info.raw || info.message}>
      <AlertTriangle className="w-3 h-3 shrink-0" />
      <span className="font-mono shrink-0">[{info.code}]</span>
      <span className="truncate">{info.message}</span>
    </span>
  );
}

export default function SongCard({ song, onPlay, onDownload, onTogglePause, status, progress, paused = {}, errors = {}, menuOpen, onMenuToggle, playlists = {}, onAddToPlaylist, onCreateAndAdd, isPlaying, onAuthorize, showPlay = false, onReveal }) {
  const [showPlSub, setShowPlSub] = useState(false);

  const addToPl = (id) => {
    if (id === "__new") onCreateAndAdd && onCreateAndAdd(song);
    else onAddToPlaylist && onAddToPlaylist(id, song);
    setShowPlSub(false);
    onMenuToggle();
  };

  const mp3Size = song.duration > 0 ? ((song.duration * 128) / 8 / 1024).toFixed(1) : null;
  const mp4Size = song.duration > 0 ? ((song.duration * 600) / 8 / 1024).toFixed(1) : null;

  // Boutons de téléchargement compacts et groupés (segmented control MP3 | MP4).
  // Largeur fixe : le changement d'état (progression/pause/terminé/erreur)
  // ne déplace plus la mise en page.
  const renderButton = (type, label, Icon) => {
    const isDownloading = status?.[type] === "downloading";
    const isDone = status?.[type] === "done";
    const isError = status?.[type] === "error";
    const isPaused = !!paused?.[type] && isDownloading;
    const percent = progress?.[type] || 0;
    const size = type === "audio" ? (song.audioSize ? (song.audioSize / 1048576).toFixed(1) : mp3Size) : (song.videoSize ? (song.videoSize / 1048576).toFixed(1) : mp4Size);
    const meta = isDownloading
      ? isPaused
        ? `${Math.round(percent)}% · pause`
        : `${Math.round(percent)}%`
      : isDone
        ? "terminé"
        : isError
          ? "Réessayer"
          : `${size} Mo`;
    const BtnIcon = isDownloading ? (isPaused ? Play : Pause) : isDone ? Check : isError ? AlertTriangle : Icon;
    const accent =
      isDone
        ? "text-green-400/90"
        : isPaused
          ? "text-amber-400/90"
          : isDownloading
            ? "text-green-400/90"
            : isError
              ? "text-red-400/90"
              : "text-white/85 hover:text-green-300";

    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (isDownloading) onTogglePause && onTogglePause(song, type);
          else onDownload(song, type);
        }}
        disabled={isDone}
        title={
          isPaused
            ? `Reprendre le téléchargement ${label}`
            : isDownloading
              ? `Mettre en pause le téléchargement ${label}`
              : isError
                ? `Échec du téléchargement ${label} — réessayer`
                : `Télécharger ${label}`
        }
        className={`group/btn relative flex items-center justify-center gap-1.5 flex-1 w-0 h-10 overflow-hidden rounded-lg ring-1 ring-white/[0.10] transition-all duration-300 active:scale-95 disabled:cursor-default ${accent} ${
          isDone
            ? "bg-green-400/[0.10]"
            : isPaused
              ? "bg-amber-400/[0.08]"
              : isDownloading
                ? "bg-green-400/[0.08]"
                : isError
                  ? "bg-red-500/[0.10]"
                  : "hover:bg-green-400/[0.10]"
        }`}
      >
        <span className="flex items-center justify-center gap-1 shrink-0">
          <BtnIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="text-[11px] font-bold leading-none">{label}</span>
        </span>
        <span className={`text-[10px] font-medium leading-none truncate flex-1 px-1 text-left whitespace-nowrap ${
          isDone
            ? "text-green-400/90"
            : isPaused
              ? "text-amber-300"
              : isError
                ? "text-red-400/90"
                : "text-white/90"
        }`}>
          {meta}
        </span>
        {isDownloading && (
          <div className="absolute inset-x-1 bottom-0 h-[2px] bg-white/[0.08] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                isPaused
                  ? "bg-gradient-to-r from-amber-400 to-amber-300"
                  : "bg-gradient-to-r from-green-500 to-green-300"
              }`}
              style={{ width: `${Math.max(3, percent)}%`, boxShadow: isPaused ? "0 0 6px rgba(251,191,36,0.4)" : "0 0 6px rgba(74,222,128,0.4)" }}
            />
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="relative animate-fade-in">
      <div
        onClick={() => { if (!isPlaying && onReveal) onReveal(); }}
        className={`group relative rounded-2xl border cursor-pointer transition-all duration-300 overflow-hidden bg-panel/70 border-white/[0.07] hover:border-white/[0.18] hover:bg-white/[0.03] hover:shadow-soft`}
      >
        <div className={`relative aspect-video overflow-hidden transition-all duration-300`}>
          {song.thumbnail ? (
            <img
              src={`${THUMB_PROXY}${encodeURIComponent(song.thumbnail)}`}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          ) : (
            <div className="w-full h-full bg-white/[0.04] flex items-center justify-center">
              <Music className="w-8 h-8 text-white/70" />
            </div>
          )}

          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-all duration-300 flex items-center justify-center">
            {isPlaying ? (
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent-red/90 text-white text-[11px] font-bold shadow-lg shadow-accent-red/30 backdrop-blur-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                En lecture
              </span>
            ) : showPlay ? (
              <button
                onClick={(e) => { e.stopPropagation(); onPlay(song); }}
                className="w-14 h-14 rounded-full bg-white/[0.10] ring-1 ring-white/20 backdrop-blur-md flex items-center justify-center shadow-[0_0_20px_-4px_rgba(255,59,92,0.45)] scale-100 transition-all duration-300 animate-fade-in active:scale-90 active:bg-white/20"
                title="Lecture"
              >
                <Play className="w-6 h-6 text-white translate-x-[1px]" fill="currentColor" />
              </button>
            ) : (
              null
            )}
          </div>

          <div className="absolute inset-x-0 top-0 z-10 px-2.5 pt-2 pb-5 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none">
            <p title={song.title} className="flex-1 min-w-0 truncate text-[12px] font-semibold leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
              {song.title}
            </p>
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); onMenuToggle(song.id); }}
            title="Plus d'actions"
            className="absolute top-2 right-2 z-20 p-2 rounded-lg bg-black/45 backdrop-blur-md text-white/90 hover:text-white hover:bg-black/70 transition-all duration-200 active:scale-90"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          <div onClick={(e) => e.stopPropagation()} className="absolute inset-x-0 bottom-0 z-10 px-1.5 pt-4 pb-1.5 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
            <div className="flex items-center gap-2 px-1 mb-1 min-w-0">
              <p title={song.channel} className="flex-1 min-w-0 truncate text-[10px] font-semibold tracking-wide text-green-300/90 leading-none">
                {song.channel || "Artiste"}
              </p>
              <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-white text-[10px] font-mono leading-none tabular-nums">
                {formatDuration(song.duration)}
              </span>
            </div>
            <div className="flex items-stretch gap-1">
              {renderButton("audio", "MP3", Download)}
              {renderButton("video", "MP4", Download)}
            </div>
          </div>
        </div>

        {(errors.audio || errors.video) && (
          <div className="px-2.5 py-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 justify-end" onClick={(e) => e.stopPropagation()}>
            {errors.audio?.code === "PERM" && errors.video?.code === "PERM" ? (
              <ErrorTag info={errors.audio} onAuthorize={onAuthorize} />
            ) : (
              <>
                <ErrorTag info={errors.audio} onAuthorize={onAuthorize} />
                <ErrorTag info={errors.video} onAuthorize={onAuthorize} />
              </>
            )}
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