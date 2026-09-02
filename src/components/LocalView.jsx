import { useEffect, useState, useRef, useCallback } from "react";
import { FolderOpen, Music, Video, Play, Repeat, Shuffle, GripVertical, Loader2, Search, MoreVertical, ListPlus, Plus, FolderSearch } from "lucide-react";
import { api } from "../api/client";

function PlayingIcon({ className = "w-3.5 h-3.5" }) {
  return (
    <span className={`${className} flex items-end gap-[2px]`} aria-label="En lecture">
      <span className="w-[2px] rounded-sm bg-accent-red playing-bar" style={{ animationDelay: "0ms" }} />
      <span className="w-[2px] rounded-sm bg-accent-red playing-bar" style={{ animationDelay: "-330ms" }} />
      <span className="w-[2px] rounded-sm bg-accent-red playing-bar" style={{ animationDelay: "-660ms" }} />
    </span>
  );
}


function SkeletonRows() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center animate-fade-in">
      <div className="w-10 h-10 rounded-full border-2 border-white/15 border-t-accent-red animate-spin mb-4" />
      <p className="text-sm font-medium text-white/90">Scan en cours…</p>
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
        <FolderOpen className="w-5 h-5 text-white/85" />
      </div>
      <p className="text-sm text-white/90 font-medium">Aucun dossier multimédia trouvé</p>
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
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gradient-to-r from-white/[0.07] to-green-500/[0.08] text-white/90 ring-1 ring-white/20">
        <Music className={`w-3 h-3${halo}`} />
        <Video className={`w-3 h-3 text-green-400${halo}`} />
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      {audio && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-white/[0.06] text-white/85 ring-1 ring-white/20">
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

function FolderTile({ folder, onClick, active, playing, onPlayFolder }) {
  const glow = active || playing;
  return (
    <div
      onClick={onClick}
      className={`group relative flex items-center gap-2 rounded-xl transition-all duration-200 cursor-pointer px-3 py-2 border ${
        active || playing
          ? "bg-white/[0.06] border-white/20 ring-1 ring-white/10"
          : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.15] active:scale-[0.97]"
      }`}
    >
      <div className={`w-7 h-7 rounded-lg bg-gradient-to-b from-white/15 to-white/5 ring-1 ring-white/15 flex items-center justify-center shrink-0 ${glow ? "drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]" : ""}`}>
        <FolderOpen className={`w-3.5 h-3.5 text-white/90 ${glow ? "drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]" : ""}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={`text-[11px] font-semibold truncate leading-tight group-hover:text-white ${active ? "text-white" : "text-white/85"}`}>
            {folder.name}
          </p>
          <div className="shrink-0">
            <FolderBadge audio={folder.hasAudio} video={folder.hasVideo} glow={glow} />
          </div>
        </div>
        <p className="text-[9px] text-muted/90 truncate mt-1 font-mono" title={folder.path}>
          {folder.path}
        </p>
      </div>
      {playing ? (
        <PlayingIcon className="w-3 h-3 shrink-0" />
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); onPlayFolder && onPlayFolder(folder.path); }}
          title={`Lire « ${folder.name} »`}
          className="w-6 h-6 rounded-full bg-white/[0.08] text-white ring-1 ring-white/15 hover:bg-accent-red hover:ring-accent-red/40 transition-all duration-200 active:scale-90 flex items-center justify-center shrink-0"
        >
          <Play className="w-2.5 h-2.5 ml-px" fill="currentColor" />
        </button>
      )}
    </div>
  );
}

function SongNameRow({ file, folderLabel, sizeLabel, index, playing, onPlay, dragHandlers, isDragging, registerRef, gripRef, gripHandlers, playlists, onAddToPlaylist, onCreateAndAdd }) {
  const isVideo = /\.(mp4|mkv|mov|webm)$/i.test(file.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showPlSub, setShowPlSub] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
        setShowPlSub(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const addToPl = (id) => {
    const track = { id: file.path, title: file.name, channel: "Local", thumbnail: null, duration: 0 };
    if (id === "__new") onCreateAndAdd && onCreateAndAdd(track);
    else onAddToPlaylist && onAddToPlaylist(id, track);
    setShowPlSub(false);
    setMenuOpen(false);
  };

  return (
    <div
      {...dragHandlers}
      ref={registerRef}
      onClick={onPlay}
      className={`group flex items-center gap-2 rounded-lg px-2.5 py-1.5 cursor-pointer transition-all duration-150 border ${
        playing
          ? "bg-white/[0.06] border-white/20"
          : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.16] hover:bg-white/[0.04]"
      } ${isDragging ? "opacity-40" : "opacity-100"}`}
    >
      <div
        {...gripHandlers}
        ref={gripRef}
        style={{ touchAction: "none" }}
        className="w-3.5 h-3.5 text-white/80 shrink-0 cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>
      <span className="w-5 shrink-0 flex items-center justify-center">
        {isVideo ? (
          <Video className={`w-4 h-4 ${playing ? "text-white" : "text-white/55"}`} />
        ) : (
          <Music className={`w-4 h-4 ${playing ? "text-white" : "text-white/55"}`} />
        )}
      </span>
      <span
        className={`flex-1 min-w-0 ${
          playing ? "text-white font-semibold" : "text-white/90 group-hover:text-white"
        }`}
      >
        <span className="block truncate text-[11px]">{file.name}</span>
        {folderLabel && (
          <span className="block truncate text-[9px] font-mono mt-0.5 text-muted/80">{folderLabel}</span>
        )}
      </span>
      {sizeLabel && (
        <span className={`shrink-0 text-[10px] font-mono tabular-nums ${playing ? "text-white" : "text-white/70"} pl-1`}>{sizeLabel}</span>
      )}
      {playing ? (
        <PlayingIcon className="w-3.5 h-3.5 shrink-0" />
      ) : (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            className="p-1 rounded-md text-white/50 hover:text-white/80 hover:bg-white/[0.08] transition-colors opacity-0 group-hover:opacity-100 shrink-0"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
          <Play className="w-3.5 h-3.5 text-white/80 opacity-0 group-hover:opacity-0 transition-all duration-150 shrink-0" />
        </>
      )}
      {menuOpen && (
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-2 top-full z-50 w-48 py-1 rounded-xl bg-[#111118] border border-white/[0.10] shadow-2xl animate-fade-in"
        >
          <button
            onClick={() => { setMenuOpen(false); onPlay(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-white/85 hover:bg-white/[0.06] transition-colors"
          >
            <Play className="w-3.5 h-3.5" fill="currentColor" />
            Écouter
          </button>
          <div className="h-px bg-white/[0.06] mx-2 my-0.5" />
          <button
            onClick={() => setShowPlSub(!showPlSub)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-white/85 hover:bg-white/[0.06] transition-colors"
          >
            <ListPlus className="w-3.5 h-3.5" />
            Ajouter à une playlist
          </button>
          {showPlSub && (
            <div className="ml-3 border-l border-white/[0.08] pl-1 pb-1">
              <button
                onClick={() => addToPl("__new")}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[10px] text-white/85 hover:bg-white/[0.06] rounded-md transition-colors"
              >
                <Plus className="w-3 h-3" />
                Nouvelle playlist…
              </button>
              {Object.values(playlists || {}).map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => addToPl(pl.id)}
                  className="w-full text-left px-2.5 py-1.5 text-[10px] text-white/80 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors truncate"
                >
                  {pl.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LocalView({ state, actions, onPlayFile, playlists, onAddToPlaylist, onCreateAndAdd }) {
  const { localDirs, localScanning, localError, localFolder, localFiles, localFolderError, localFolderLoading } = state;

  const scannedRef = useRef(false);
  useEffect(() => {
    if (!scannedRef.current) {
      scannedRef.current = true;
      actions.scanFolders();
    }
  }, []);

  const playingRowRef = useRef(null);
  const filesScrollRef = useRef(null);
  const contentScrollRef = useRef(null);

  useEffect(() => {
    if (filesScrollRef.current) filesScrollRef.current.scrollTop = 0;
  }, [localFolder]);

  useEffect(() => {
    if (localFiles.length > 0 && localFolder && contentScrollRef.current) {
      setTimeout(() => contentScrollRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
  }, [localFiles.length, localFolder]);

  const [filterQuery, setFilterQuery] = useState("");
  const [searchBoxOpen, setSearchBoxOpen] = useState(false);
  const [searchFiles, setSearchFiles] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const searchSeq = useRef(0);

  useEffect(() => {
    const q = filterQuery.trim();
    const seq = ++searchSeq.current;
    if (!q) {
      setSearchFiles(null);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    const t = setTimeout(async () => {
      try {
        const res = await api.searchLocal(q);
        if (seq !== searchSeq.current) return;
        if (res.error) {
          setSearchError(res.error);
          setSearchFiles([]);
        } else {
          setSearchFiles(Array.isArray(res.files) ? res.files : []);
        }
      } catch {
        if (seq !== searchSeq.current) return;
        setSearchError("Impossible de contacter le serveur.");
        setSearchFiles([]);
      } finally {
        if (seq === searchSeq.current) setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [filterQuery]);

  const playingPath =
    state.streamUrl && state.streamUrl.includes("/local?path=")
      ? decodeURIComponent(state.streamUrl.split("path=")[1])
      : null;
  const playingFolder = playingPath ? playingPath.replace(/[\\\/][^\\\/]*$/, "") : null;

  const openFolder = (path) => {
    if (localFolder === path) {
      if (playingFolder === path && playingRowRef.current) {
        playingRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    actions.openFolder(path);
  };

  const [order, setOrder] = useState([]);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const rowEls = useRef(new Map());
  const gripEls = useRef(new Map());
  const pressRef = useRef(null);
  const pressTimeoutRef = useRef(null);
  const dragState = useRef(null);
  const lastDragAt = useRef(0);

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

  const moveOver = (clientX, clientY) => {
    const ds = dragState.current;
    if (!ds) return;
    let overPath = null;
    for (const [p, el] of rowEls.current) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) { overPath = p; break; }
    }
    if (!overPath) return;
    setOrder((prev) => {
      const to = prev.indexOf(overPath);
      const from = prev.indexOf(ds.path);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const gripHandlers = (index, path) => ({
    onPointerDown: (e) => {
      if (e.pointerType === "mouse") return;
      pressRef.current = { index, path, x: e.clientX, y: e.clientY, start: Date.now(), pointerId: e.pointerId, armed: false };
      if (pressTimeoutRef.current) clearTimeout(pressTimeoutRef.current);
      pressTimeoutRef.current = setTimeout(() => {
        const p = pressRef.current;
        if (!p || p.armed) return;
        p.armed = true;
        dragState.current = p;
        setDragIndex(p.index);
        const grip = gripEls.current.get(path);
        try { grip?.setPointerCapture(p.pointerId); } catch {}
      }, 450);
    },
    onPointerMove: (e) => {
      const p = pressRef.current;
      if (!p) return;
      if (p.armed) { moveOver(e.clientX, e.clientY); return; }
      if (Math.abs(e.clientX - p.x) > 12 || Math.abs(e.clientY - p.y) > 12) {
        if (pressTimeoutRef.current) clearTimeout(pressTimeoutRef.current);
        pressRef.current = null;
      }
    },
    onPointerUp: () => {
      const p = pressRef.current;
      if (pressTimeoutRef.current) clearTimeout(pressTimeoutRef.current);
      pressRef.current = null;
      if (p?.armed) {
        lastDragAt.current = Date.now();
        dragState.current = null;
        setDragIndex(null);
        setOverIndex(null);
      }
    },
    onContextMenu: (e) => e.preventDefault(),
  });

  const searching = !!filterQuery.trim() || searchBoxOpen;
  const filteredDirs = searching ? [] : localDirs;
  const filteredFiles = ordered.filter(
    (f) => !filterQuery || f.name.toLowerCase().includes(filterQuery.toLowerCase())
  );

  return (
    <section className="relative flex-1 min-h-0 pt-2">
      <div className="relative z-10 animate-fade-in-up">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40 pointer-events-none" />
          <input
            type="text"
            placeholder="Rechercher dans tous les dossiers…"
            value={filterQuery}
            onFocus={() => setSearchBoxOpen(true)}
            onBlur={(e) => { if (!e.target.value.trim()) setSearchBoxOpen(false); }}
            onChange={(e) => {
              setFilterQuery(e.target.value);
              if (!e.target.value.trim()) setSearchBoxOpen(false);
            }}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl pl-9 pr-3 py-2 text-xs text-white/90 placeholder-white/30 outline-none focus:border-white/30 focus:ring-1 focus:ring-white/[0.15] transition-all duration-200"
          />
        </div>

        <div className="flex items-center justify-between gap-3 mb-3">
          <button
            onClick={() => actions.playAllFolders()}
            title="Lire toutes les pistes de tous les dossiers"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-semibold text-white bg-white/[0.08] ring-1 ring-white/[0.14] hover:bg-white/[0.14] hover:ring-white/25 transition-all duration-200 active:scale-95"
          >
            <Play className="w-3.5 h-3.5 ml-px" fill="currentColor" />
            Tout lire
          </button>
          <button
            onClick={() => actions.playAllFolders("loop")}
            title="Lire toutes les pistes en boucle (répète la fin de la liste)"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-semibold text-white bg-white/[0.08] ring-1 ring-white/[0.14] hover:bg-white/[0.14] hover:ring-white/25 transition-all duration-200 active:scale-95"
          >
            <Repeat className="w-3.5 h-3.5" />
            Boucle
          </button>
          <button
            onClick={() => actions.playAllFolders("shuffle")}
            title="Lire toutes les pistes en mode aléatoire"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-semibold text-white bg-white/[0.08] ring-1 ring-white/[0.14] hover:bg-white/[0.14] hover:ring-white/25 transition-all duration-200 active:scale-95"
          >
            <Shuffle className="w-3.5 h-3.5" />
            Aléatoire
          </button>
        </div>

        <div className="mb-3 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(255,255,255,0.12), transparent)" }} />

        {localScanning && localDirs.length === 0 ? (
          <SkeletonRows />
        ) : localError && localDirs.length === 0 ? (
          <ErrorBox message={localError} onRetry={actions.scanFolders} />
        ) : localDirs.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {localScanning && (
              <div className="mb-3 flex items-center gap-2 text-[11px] font-mono text-white/85">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white/80" />
                Scan en cours… {localDirs.length} dossier{localDirs.length > 1 ? "s" : ""} trouvé{localDirs.length > 1 ? "s" : ""}
                <div className="flex-1 h-[2px] bg-white/[0.06] rounded-full overflow-hidden ml-2">
                  <div className="h-full bg-white/50 rounded-full animate-pulse" style={{ width: localDirs.length > 0 ? "60%" : "30%" }} />
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-[minmax(240px,320px)_1fr] gap-5">
            <div className="space-y-2 max-h-[calc(100vh-240px)] overflow-y-auto scroll-modern pr-1 md:border-r md:border-white/[0.06] md:pr-6 transition-all duration-300">
              {filteredDirs.map((d, i) => (
                <div key={d.path} className="transition-all duration-300" style={{ animationDelay: `${i * 30}ms` }}>
                  <FolderTile
                    folder={d}
                    active={localFolder === d.path}
                    playing={playingFolder === d.path}
                    onClick={() => openFolder(d.path)}
                    onPlayFolder={(path) => actions.playFolder(path)}
                  />
                </div>
              ))}
            </div>

            <div ref={contentScrollRef} className="min-w-0 bg-white/[0.02] ring-1 ring-white/[0.06] rounded-xl p-3 shadow-soft">
              {searching ? (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 rounded-lg bg-white/[0.04] ring-1 ring-white/[0.12] flex items-center justify-center shrink-0">
                      <FolderSearch className="w-3.5 h-3.5 text-white/80" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-mono text-muted/85 truncate">Recherche dans tous les dossiers</p>
                      <p className="text-xs font-semibold text-white/90 truncate">
                        {searchFiles ? `${searchFiles.length} fichier${searchFiles.length > 1 ? "s" : ""} trouvé${searchFiles.length > 1 ? "s" : ""}` : "Chercher une chanson"}
                      </p>
                    </div>
                  </div>

                  {searchError && <ErrorBox message={searchError} />}
                  {searchLoading && (
                    <div className="flex items-center gap-2 text-[11px] font-mono text-white/85 py-4">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Recherche en cours…
                    </div>
                  )}
                  {!searchLoading && !searchError && searchFiles && searchFiles.length === 0 && (
                    <p className="text-[11px] text-muted mt-3">Aucun fichier ne correspond à « {filterQuery} ».</p>
                  )}

                  <div ref={filesScrollRef} className="space-y-1 max-h-[calc(100vh-260px)] overflow-y-auto scroll-modern pr-1">
                    {(searchFiles || []).map((f) => (
                      <SongNameRow
                        key={f.path}
                        file={f}
                        folderLabel={f.folder}
                        sizeLabel={f.size_label}
                        index={0}
                        playing={!!playingPath && playingPath === f.path}
                        onPlay={() => onPlayFile({ id: f.path, title: f.name, channel: "Local", thumbnail: null, duration: 0 }, f.path)}
                        dragHandlers={{}}
                        isDragging={false}
                        registerRef={() => {}}
                        gripRef={() => {}}
                        gripHandlers={() => ({})}
                        playlists={playlists}
                        onAddToPlaylist={onAddToPlaylist}
                        onCreateAndAdd={onCreateAndAdd}
                      />
                    ))}
                  </div>
                </>
              ) : !localFolder ? (
                <div className="flex flex-col items-center justify-center h-full py-16 text-center">
                  <FolderOpen className="w-10 h-10 text-white/80 mb-3" />
                  <p className="text-xs text-muted/90">Sélectionnez un dossier pour afficher son contenu</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 rounded-lg bg-white/[0.04] ring-1 ring-white/[0.12] flex items-center justify-center shrink-0">
                      <FolderOpen className="w-3.5 h-3.5 text-white/80" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-mono text-muted/85 truncate">Dossier en cours</p>
                      <p className="text-xs font-semibold text-white/90 truncate">{localFolder}</p>
                    </div>
                  </div>

                  {localFolderError && <ErrorBox message={localFolderError} />}
                  {localFolderLoading && (
                    <div className="flex items-center gap-2 text-[11px] font-mono text-white/85 py-4">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Chargement…
                    </div>
                  )}
                  {!localFolderLoading && !localFolderError && localFiles.length === 0 && (
                    <p className="text-[11px] text-muted mt-3">Aucun fichier audio ou vidéo dans ce dossier.</p>
                  )}

                  <div ref={filesScrollRef} className="space-y-1 max-h-[calc(100vh-260px)] overflow-y-auto scroll-modern pr-1">
                    {filteredFiles.map((f, i) => (
                      <SongNameRow
                        key={f.path}
                        file={f}
                        index={i}
                        playing={!!playingPath && playingPath === f.path}
                        onPlay={() => {
                          if (Date.now() - lastDragAt.current < 400) return;
                          onPlayFile({ id: f.path, title: f.name, channel: "Local", thumbnail: null, duration: 0 }, f.path);
                        }}
                        dragHandlers={makeDrag(i)}
                        isDragging={dragIndex === i}
                        registerRef={(el) => { rowEls.current.set(f.path, el); if (playingPath && playingPath === f.path) playingRowRef.current = el; }}
                        gripRef={(el) => { gripEls.current.set(f.path, el); }}
                        gripHandlers={gripHandlers(i, f.path)}
                        playlists={playlists}
                        onAddToPlaylist={onAddToPlaylist}
                        onCreateAndAdd={onCreateAndAdd}
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