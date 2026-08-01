import { useEffect, useState, useRef, useCallback } from "react";
import { FolderOpen, Music, Video, Play, GripVertical, RefreshCw, Loader2, Search } from "lucide-react";


function SkeletonRows() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center animate-fade-in">
      <div className="w-10 h-10 rounded-full border-2 border-white/15 border-t-white animate-spin mb-4" />
      <p className="text-sm font-medium text-white/80">Scan en cours…</p>
      <p className="text-[11px] text-muted mt-1.5 font-mono">Analyse de vos dossiers</p>
    </div>
  );
}

function ErrorBox({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-11 h-11 rounded-xl bg-white/[0.03] ring-1 ring-accent-red/20 flex items-center justify-center mb-4">
        <span className="text-accent-red text-lg font-semibold">!</span>
      </div>
      <p className="text-xs text-accent-red font-medium max-w-xs leading-relaxed">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-accent-red ring-1 ring-accent-red/30 hover:bg-accent-red/10 transition-all duration-200 active:scale-95"
        >
          Réessayer
        </button>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in-up">
      <div className="w-11 h-11 rounded-xl bg-gradient-to-b from-white/10 to-white/5 ring-1 ring-white/15 flex items-center justify-center mb-4">
        <FolderOpen className="w-5 h-5 text-white/60" />
      </div>
      <p className="text-sm text-white/70 font-medium">Aucun dossier multimédia trouvé</p>
      <p className="text-[11px] text-muted mt-1.5 max-w-xs leading-relaxed">
        Ajoutez des fichiers audio ou vidéo dans Musique, Vidéos ou Téléchargements, ou ouvrez un dossier
        manuellement.
      </p>
    </div>
  );
}

function FolderBadge({ audio, video, glow }) {
  const halo = glow ? " drop-shadow-[0_0_12px_rgba(255,255,255,0.5)]" : "";
  if (audio && video) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gradient-to-r from-white/[0.07] to-green-500/[0.08] text-white/70 ring-1 ring-white/20">
        <Music className={`w-3 h-3${halo}`} />
        <Video className={`w-3 h-3 text-green-400${halo}`} />
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      {audio && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-white/[0.06] text-white/60 ring-1 ring-white/20">
          <Music className={`w-3 h-3${halo}`} />
        </span>
      )}
      {video && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-green-500/[0.08] text-green-400 ring-1 ring-green-500/40">
          <Video className={`w-3 h-3${halo}`} />
        </span>
      )}
    </div>
  );
}

function FolderTile({ folder, onClick, active, playing }) {
  const glow = active || playing;
  return (
    <div
      onClick={onClick}
      className={`group relative flex items-start gap-2.5 rounded-xl transition-all duration-200 cursor-pointer px-3 py-2.5 ${
        active
          ? "bg-blue-500/[0.05]"
          : playing
          ? "bg-blue-500/[0.05]"
          : "bg-white/[0.02] hover:bg-white/[0.05] active:scale-[0.97]"
      }`}
    >
      <div className={`w-7 h-7 rounded-lg bg-gradient-to-b from-white/15 to-white/5 ring-1 ring-white/15 flex items-center justify-center shrink-0 mt-0.5 ${glow ? "drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]" : ""}`}>
        <FolderOpen className={`w-3.5 h-3.5 text-white/70 ${glow ? "drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]" : ""}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-[11px] font-semibold truncate leading-tight group-hover:text-white ${active ? "text-white" : "text-white/75"}`}>
            {folder.name}
          </p>
          <div className="shrink-0 mt-0.5">
            <FolderBadge audio={folder.hasAudio} video={folder.hasVideo} glow={glow} />
          </div>
        </div>
        <p className="text-[9px] text-muted/70 truncate mt-1 font-mono" title={folder.path}>
          {folder.path}
        </p>
      </div>
    </div>
  );
}

function SongNameRow({ file, index, playing, onPlay, dragHandlers, isDragging, rowRef }) {
  const isVideo = /\.(mp4|mkv|mov|webm)$/i.test(file.name);
  return (
    <div
      {...dragHandlers}
      ref={rowRef}
      onClick={onPlay}
      className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-all duration-150 ${
        playing
          ? "bg-accent-red/[0.08]"
          : "hover:bg-white/[0.04]"
      } ${isDragging ? "opacity-40" : "opacity-100"}`}
    >
      <GripVertical className="w-3.5 h-3.5 text-white/25 shrink-0 cursor-grab active:cursor-grabbing" />
      <span className={`text-[10px] font-mono w-5 shrink-0 ${playing ? "text-accent-red" : "text-muted/60"}`}>
        {String(index + 1).padStart(2, "0")}
      </span>
      <span
        className={`flex-1 min-w-0 text-[11px] truncate ${
          playing ? "text-accent-red font-semibold drop-shadow-[0_0_14px_rgba(255,59,92,1)] drop-shadow-[0_0_28px_rgba(255,59,92,1)]" : "text-white/80 group-hover:text-white"
        }`}
      >
        {file.name}
      </span>
      {playing ? (
        <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent-red" aria-label="En lecture" />
      ) : (
        <Play className="w-3.5 h-3.5 text-white/50 opacity-0 group-hover:opacity-100 transition-all duration-150 shrink-0" />
      )}
    </div>
  );
}

export function LocalView({ state, actions, onPlayFile }) {
  const { localDirs, localScanning, localError, localFolder, localFiles, localFolderError } = state;

  const scannedRef = useRef(false);
  useEffect(() => {
    if (!localFolder && !scannedRef.current) {
      scannedRef.current = true;
      actions.scanFolders();
    }
  }, [localFolder]);

  const playingRowRef = useRef(null);
  const filesScrollRef = useRef(null);


  useEffect(() => {
    if (filesScrollRef.current) filesScrollRef.current.scrollTop = 0;
  }, [localFolder]);

  const [filterQuery, setFilterQuery] = useState("");

  const playingPath =
    state.streamUrl && state.streamUrl.includes("/local?path=")
      ? decodeURIComponent(state.streamUrl.split("path=")[1])
      : null;
  const playingFolder = playingPath ? playingPath.replace(/[\\\/][^\\\/]*$/, "") : null;

  const openFolder = (path) => {
    if (localFolder === path) {
      if (playingFolder === path) {
        playingRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      actions.resetFolder();
    } else {
      actions.openFolder(path);
    }
  };

  const [order, setOrder] = useState([]);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  useEffect(() => {
    setOrder(localFiles.map((f) => f.path));
    setDragIndex(null);
    setOverIndex(null);
  }, [localFolder, localFiles.length]);

  const ordered = order
    .map((p) => localFiles.find((f) => f.path === p))
    .filter(Boolean);
  if (ordered.length !== localFiles.length) ordered.push(...localFiles.filter((f) => !order.includes(f.path)));

  const handleDrop = (from, to) => {
    if (from === to || from == null || to == null) return;
    setOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const makeDrag = (index) => ({
    draggable: true,
    onDragStart: (e) => {
      setDragIndex(index);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e) => {
      e.preventDefault();
      if (overIndex !== index) setOverIndex(index);
    },
    onDrop: (e) => {
      e.preventDefault();
      handleDrop(dragIndex, index);
      setDragIndex(null);
      setOverIndex(null);
    },
    onDragEnd: () => {
      setDragIndex(null);
      setOverIndex(null);
    },
  });

  const filteredDirs = localDirs.filter(
    (d) => !filterQuery || d.name.toLowerCase().includes(filterQuery.toLowerCase()) || d.path.toLowerCase().includes(filterQuery.toLowerCase())
  );
  const filteredFiles = ordered.filter(
    (f) => !filterQuery || f.name.toLowerCase().includes(filterQuery.toLowerCase())
  );

  return (
    <section className="relative flex-1 min-h-0 pt-10">
      <div className="relative z-10 animate-fade-in-up">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="font-mono text-lg font-semibold text-white/90">Bibliothèque locale</h2>
              <p className="text-[11px] text-muted font-mono mt-0.5">Dossiers contenant audio &amp; vidéo</p>
            </div>
            <button
              onClick={() => actions.scanFolders()}
              title="Rafraîchir la bibliothèque"
              className="p-2 rounded-lg text-white/55 hover:text-white hover:bg-white/[0.07] ring-1 ring-white/[0.06] hover:ring-white/20 transition-all duration-200 active:scale-95"
            >
              <RefreshCw className={`w-4 h-4 ${localScanning ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={actions.pickFolder}
              title="Ouvrir un dossier"
              className="p-2 rounded-lg text-white/55 hover:text-white hover:bg-white/[0.07] ring-1 ring-white/[0.06] hover:ring-white/20 transition-all duration-200 active:scale-95"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          </div>

          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
            <input
              type="text"
              placeholder="Filtrer les dossiers ou fichiers…"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-full bg-white/[0.06] border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white/90 placeholder:text-white/35 outline-none focus:border-white/30 transition-colors"
            />
          </div>
        </div>

        {localScanning && localDirs.length === 0 ? (
          <SkeletonRows />
        ) : localError && localDirs.length === 0 ? (
          <ErrorBox message={localError} onRetry={actions.scanFolders} />
        ) : localDirs.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {localScanning && (
              <div className="mb-4 flex items-center gap-2 text-[11px] font-mono text-white/60">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Scan en cours… {localDirs.length} dossier{localDirs.length > 1 ? "s" : ""} trouvé{localDirs.length > 1 ? "s" : ""}
              </div>
            )}
          <div className="grid grid-cols-1 md:grid-cols-[minmax(240px,320px)_1fr] gap-5">
            <div className="space-y-2 max-h-[calc(100vh-240px)] overflow-y-auto scroll-modern pr-1 md:border-r md:border-white/[0.06] md:pr-6">
              {filteredDirs.map((d) => (
                <FolderTile
                  key={d.path}
                  folder={d}
                  active={localFolder === d.path}
                  playing={playingFolder === d.path}
                  onClick={() => openFolder(d.path)}
                />
              ))}
            </div>

            <div className="min-w-0 bg-blue-500/[0.04] rounded-xl p-3">
              {!localFolder ? (
                <div className="flex flex-col items-center justify-center h-full py-16 text-center">
                  <FolderOpen className="w-10 h-10 text-white/30 mb-3" />
                  <p className="text-xs text-muted/80">Sélectionnez un dossier à gauche</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-mono text-muted/60 truncate">Dossier en cours</p>
                      <p className="text-xs font-semibold text-white/85 truncate">{localFolder}</p>
                    </div>
                  </div>

                  {localFolderError && <ErrorBox message={localFolderError} />}
                  {!localFolderError && localFiles.length === 0 && (
                    <p className="text-[11px] text-muted mt-3">Aucun fichier audio ou vidéo dans ce dossier.</p>
                  )}

                  <div ref={filesScrollRef} className="space-y-0.5 max-h-[calc(100vh-260px)] overflow-y-auto scroll-modern pr-1">
                    {filteredFiles.map((f, i) => (
                      <SongNameRow
                        key={f.path}
                        file={f}
                        index={i}
                        playing={!!playingPath && playingPath === f.path}
                        rowRef={!!playingPath && playingPath === f.path ? playingRowRef : null}
                        onPlay={() =>
                          onPlayFile({ id: f.path, title: f.name, channel: "Local", thumbnail: null, duration: 0 }, f.path)
                        }
                        dragHandlers={makeDrag(i)}
                        isDragging={dragIndex === i}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
          </>
        )}
      </div>
    </section>
  );
}