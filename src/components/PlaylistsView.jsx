import { useState, useEffect, useCallback } from "react";
import { Music, Play, Trash2, ListMusic, Plus, X, Pencil, Check, Loader2, FolderOpen, ChevronLeft, ChevronDown, ListRestart, Video } from "lucide-react";
import { api } from "../api/client.js";

const THUMB_PROXY = "http://127.0.0.1:8787/thumb?url=";

const ACTION_BTN =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium text-white/80 hover:text-white hover:bg-white/[0.08] ring-1 ring-white/[0.08] transition-all duration-150 active:scale-95";

const PRIMARY_BTN =
  "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-[11px] font-semibold text-white bg-white/[0.08] ring-1 ring-white/[0.14] hover:bg-white/[0.14] hover:ring-white/25 transition-all duration-200 active:scale-95";

function formatDuration(seconds) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTotal(ms) {
  if (!ms) return "";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function PlayingIcon({ className = "w-3 h-3" }) {
  return (
    <span className={`${className} flex items-end gap-[2px] shrink-0`} aria-label="En lecture">
      <span className="w-[2px] rounded-sm bg-accent-red playing-bar" style={{ animationDelay: "0ms" }} />
      <span className="w-[2px] rounded-sm bg-accent-red playing-bar" style={{ animationDelay: "-330ms" }} />
      <span className="w-[2px] rounded-sm bg-accent-red playing-bar" style={{ animationDelay: "-660ms" }} />
    </span>
  );
}

function CoverArt({ thumbs }) {
  if (thumbs.length === 0) {
    return (
      <div className="w-full h-full bg-white/[0.04] flex items-center justify-center">
        <ListMusic className="w-6 h-6 text-white/70" />
      </div>
    );
  }
  return (
    <div className="w-full h-full grid grid-cols-2 gap-px bg-black/50">
      {[0, 1, 2, 3].map((i) =>
        thumbs[i] ? (
          <img
            key={i}
            src={THUMB_PROXY + encodeURIComponent(thumbs[i])}
            className="w-full h-full object-cover"
            alt=""
            loading="lazy"
          />
        ) : (
          <div key={i} className="w-full h-full bg-white/[0.03]" />
        )
      )}
    </div>
  );
}

function PlaylistSongsManager({ playlistId, playlist, localDirs, onAdd, onRemove, onClose }) {
  const [added, setAdded] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState(null);
  const [entries, setEntries] = useState([]);
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const existingIds = new Set((playlist.tracks || []).map((t) => t.id));

  const loadFolder = useCallback(async (path) => {
    setLoading(true);
    try {
      const [audio, video] = await Promise.all([
        api.listFolder(path, "audio"),
        api.listFolder(path, "video"),
      ]);
      const seenFiles = new Map();
      for (const f of [...(audio.files || []), ...(video.files || [])]) {
        if (!seenFiles.has(f.path)) seenFiles.set(f.path, { ...f, _kind: "file" });
      }
      const files = [...seenFiles.values()];
      const seen = new Set(files.map((f) => f.path));
      const subdirs = (audio.subdirs || []).concat(video.subdirs || []).filter((d) => {
        if (seen.has(d.path)) return false;
        seen.add(d.path);
        return true;
      });
      const items = [
        ...subdirs.map((d) => ({ ...d, _kind: "folder" })),
        ...files.sort((a, b) => a.name.localeCompare(b.name)),
      ];
      setEntries(items);
    } catch {
      setEntries([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (currentPath === null) return;
    loadFolder(currentPath);
  }, [currentPath, loadFolder]);

  const navigateTo = (path, name) => {
    setBreadcrumbs((prev) => [...prev, { path: currentPath, name }]);
    setCurrentPath(path);
  };

  const goBack = () => {
    if (breadcrumbs.length === 0) {
      setCurrentPath(null);
      setEntries([]);
      return;
    }
    const prev = breadcrumbs[breadcrumbs.length - 1];
    setBreadcrumbs((b) => b.slice(0, -1));
    setCurrentPath(prev.path);
  };

  const files = entries.filter((e) => e._kind === "file");
  const dirs = entries.filter((e) => e._kind === "folder");
  const rootDirs = (localDirs || [])
    .filter((d) => d.name && d.path)
    .map((d) => ({ ...d, _kind: "folder" }));

  const handleAdd = (file) => {
    const track = { id: file.path, title: file.name, channel: "Local", thumbnail: null, duration: 0 };
    onAdd(playlistId, track);
    setAdded((prev) => new Set(prev).add(file.path));
  };

  const handleToggle = (file) => {
    if (added.has(file.path) || existingIds.has(file.path)) {
      const wasAdded = added.has(file.path);
      if (wasAdded) {
        setAdded((prev) => {
          const next = new Set(prev);
          next.delete(file.path);
          return next;
        });
      }
      if (onRemove) onRemove(playlistId, file.path);
    } else {
      handleAdd(file);
    }
  };

  const atRoot = currentPath === null;
  const visibleDirs = atRoot ? rootDirs : dirs;
  const inPlaylist = playlist.tracks || [];
  const isManager = (inPlaylist.length > 0) && !!onRemove;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[82vh] bg-[#0b0b12] rounded-t-2xl sm:rounded-2xl ring-1 ring-white/[0.08] shadow-elevated flex flex-col animate-slide-up overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-2 min-w-0">
            {!atRoot && (
              <button
                onClick={goBack}
                className="p-1.5 rounded-lg text-white/60 hover:text-white/90 hover:bg-white/[0.06] transition-colors shrink-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white/90 truncate">
                {isManager
                  ? `Réorganiser « ${playlist.name} »`
                  : `Ajouter à « ${playlist.name} »`}
              </p>
              <p className="text-[10px] text-muted mt-0.5">
                {inPlaylist.length} titre{inPlaylist.length !== 1 ? "s" : ""} dans la playlist
                {!atRoot && ` · ${breadcrumbs[breadcrumbs.length - 1]?.name || "..."}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {files.length > 0 && (
              <button
                onClick={() => files.forEach((f) => !added.has(f.path) && !existingIds.has(f.path) && handleAdd(f))}
                className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-white/80 ring-1 ring-white/[0.12] hover:text-white hover:bg-white/[0.08] transition-colors active:scale-95"
              >
                Tout ajouter
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-white/50 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {isManager && (
          <div className="px-4 pt-1 pb-1">
            <p className="text-[9px] font-mono text-muted/60 uppercase tracking-[0.15em] px-1">
              Cliquez sur une piste pour l'ajouter ou la retirer
            </p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-0.5 scroll-modern">
          {loading && (
            <div className="py-10 flex flex-col items-center gap-3">
              <Loader2 className="w-5 h-5 text-accent-red animate-spin" />
              <p className="text-[11px] text-muted">Chargement...</p>
            </div>
          )}
          {!loading && atRoot && visibleDirs.length === 0 && (
            <div className="py-10 text-center text-[11px] text-muted">
              Aucun dossier trouvé. Scannez d'abord vos fichiers dans l'onglet Local.
            </div>
          )}
          {!loading && !atRoot && entries.length === 0 && (
            <div className="py-10 text-center text-[11px] text-muted">
              Aucun fichier dans ce dossier.
            </div>
          )}
          {!loading && visibleDirs.map((d) => (
            <button
              key={d.path}
              onClick={() => navigateTo(d.path, d.name)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left bg-white/[0.02] border border-transparent hover:bg-white/[0.05] hover:border-white/[0.08] transition-all duration-150"
            >
              <div className="w-7 h-7 rounded-md bg-white/[0.04] flex items-center justify-center shrink-0">
                <FolderOpen className="w-3.5 h-3.5 text-white/80" />
              </div>
              <span className="flex-1 min-w-0 text-[11px] text-white/85 truncate">{d.name}</span>
              <ChevronLeft className="w-3 h-3 text-white/30 rotate-180 shrink-0" />
            </button>
          ))}
          {!loading && files.map((f) => {
            const isIn = added.has(f.path) || existingIds.has(f.path);
            return (
              <button
                key={f.path}
                onClick={() => handleToggle(f)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-150 border ${
                  isIn
                    ? "bg-white/[0.10] border-white/25 ring-1 ring-white/10"
                    : "bg-white/[0.02] border-transparent hover:bg-white/[0.05] hover:border-white/[0.08]"
                }`}
              >
                <div className="w-7 h-7 rounded-md bg-white/[0.04] flex items-center justify-center shrink-0">
                  {isIn ? (
                    <Check className="w-3.5 h-3.5 text-white" />
                  ) : (
                    <Music className="w-3.5 h-3.5 text-white/50" />
                  )}
                </div>
                <span className={`flex-1 min-w-0 text-[11px] truncate ${
                  isIn ? "text-white font-medium" : "text-white/85"
                }`}>
                  {f.name}
                </span>
                {isIn && (
                  <span className="text-[8.5px] font-mono uppercase tracking-wider text-white/60 shrink-0">
                    dans la playlist
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlaylistCard({ id, playlist, isOpen, onToggle, onPlay, onDelete, onRename, localDirs, onAdd, onRemove, currentKey }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(playlist.name);
  const [showManager, setShowManager] = useState(false);
  const tracks = playlist.tracks || [];
  const trackCount = tracks.length;
  const coverTabs = tracks.filter((t) => t.thumbnail).slice(0, 4);
  const playingTrackKey = currentKey && tracks.some((t) => (t.path || t.id) === currentKey) ? currentKey : null;

  const totalMs = tracks.reduce((acc, t) => {
    const d = Number(t.duration);
    return acc + (Number.isFinite(d) && d > 0 ? d * 1000 : 0);
  }, 0);
  const totalLabel = formatTotal(totalMs);

  return (
    <>
      <div
        className={
          "rounded-2xl overflow-hidden transition-all duration-300 ring-1 " +
          (isOpen
            ? "bg-white/[0.04] ring-white/20"
            : playingTrackKey
              ? "bg-white/[0.05] ring-white/20"
              : "bg-white/[0.03] ring-white/[0.06] hover:ring-white/25 hover:bg-white/[0.05] hover:-translate-y-px")
        }
      >
        <div
          className="group flex items-center gap-3 px-2.5 py-2.5 cursor-pointer transition-colors duration-200"
          onClick={onToggle}
          role="button"
          aria-expanded={isOpen}
        >
          <div
            className={
              "relative w-14 h-14 rounded-xl overflow-hidden shrink-0 ring-1 transition-colors duration-300 " +
              (isOpen ? "ring-white/30" : "ring-white/[0.09] group-hover:ring-white/30")
            }
          >
            <CoverArt thumbs={coverTabs} />
            {trackCount > 0 && (
              <span className="absolute bottom-0.5 right-0.5 px-1.5 py-px rounded-md bg-black/80 backdrop-blur-sm text-[9px] font-mono text-white/90 ring-1 ring-white/15 tabular-nums">
                {trackCount}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = name.trim();
                  if (v && v !== playlist.name) onRename(id, v);
                  setEditing(false);
                }}
                className="flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => {
                    const v = name.trim();
                    if (v && v !== playlist.name) onRename(id, v);
                    else setName(playlist.name);
                    setEditing(false);
                  }}
                  className="flex-1 bg-white/[0.08] rounded px-2 py-1 text-[12px] text-white/90 outline-none focus:ring-1 focus:ring-accent-red/50"
                />
              </form>
            ) : (
              <>
                <p className="text-[13px] font-semibold text-white/92 truncate group-hover:text-white transition-colors">
                  {playlist.name}
                </p>
                <p className="text-[10px] text-white/55 mt-1 flex items-center gap-1.5">
                  <span>{trackCount} titre{trackCount !== 1 ? "s" : ""}</span>
                  {totalLabel ? <span className="text-white/45"> · {totalLabel}</span> : null}
                  {playingTrackKey ? <PlayingIcon className="w-3 h-3" /> : null}
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onPlay(id); }}
              title="Lire tout"
              className="w-9 h-9 rounded-full bg-white/[0.08] text-white ring-1 ring-white/15 hover:bg-white/[0.14] hover:ring-white/25 transition-all duration-200 active:scale-90 flex items-center justify-center"
            >
              <Play className="w-4 h-4 ml-px" fill="currentColor" />
            </button>
            <ChevronDown
              className={
                "w-4 h-4 transition-transform duration-300 " +
                (isOpen ? "rotate-180 text-white" : "text-white/40")
              }
            />
          </div>
        </div>

        {isOpen && (
          <div className="mx-2.5 mb-2.5 rounded-xl bg-black/30 ring-1 ring-white/[0.07] overflow-hidden animate-fade-in-down">
            <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-b border-white/[0.07] bg-white/[0.03]">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={() => onPlay(id)}
                  title="Lire toute la playlist"
                  className={PRIMARY_BTN + " shrink-0"}
                >
                  <Play className="w-3.5 h-3.5 ml-px" fill="currentColor" />
                  Tout lire
                </button>
                <span className="text-[9.5px] font-mono text-white/50 whitespace-nowrap overflow-hidden text-ellipsis">
                  {trackCount === 0 ? "vide" : `${totalLabel || "—"} · ${trackCount} piste${trackCount !== 1 ? "s" : ""}`}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-white/[0.05]">
              <button
                onClick={() => setEditing(true)}
                className={ACTION_BTN + " hover:text-white"}
                title="Renommer la playlist"
              >
                <Pencil className="w-3.5 h-3.5" />
                Renommer
              </button>
              <button
                onClick={() => setShowManager(true)}
                className={ACTION_BTN}
                title={trackCount > 0 ? "Réorganiser (ajouter / retirer)" : "Ajouter des morceaux"}
              >
                {trackCount > 0 ? <ListRestart className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                {trackCount > 0 ? "Réorganiser" : "Ajouter"}
              </button>
              <button
                onClick={() => onDelete(id)}
                className={ACTION_BTN + " hover:text-red-400 hover:bg-red-400/15 hover:ring-red-400/30"}
                title="Supprimer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Supprimer
              </button>
            </div>

            <div className="max-h-[52vh] overflow-y-auto scroll-modern">
              {trackCount === 0 ? (
                <p className="px-3 py-6 text-[11px] text-white/50 text-center leading-relaxed">
                  Aucun morceau dans cette playlist.
                  <br />
                  Ouvrez « Ajouter » pour en ajouter.
                </p>
              ) : (
                tracks.map((t, i) => {
                  const isLocal = t.channel === "Local" || typeof t.path === "string";
                  const safeChannel = (t.channel || "Inconnu").replace(/ - Topic/g, "");
                  const metaLabel = safeChannel === "Local" ? "Local" : `${safeChannel}${isLocal ? " · Local" : ""}`;
                  const rowPlaying = playingTrackKey != null && (t.path || t.id) === playingTrackKey;
                  const isVideo = /\.(mp4|mkv|mov|webm)$/i.test(t.path || t.title || "");
                  const dur = formatDuration(t.duration);
                  return (
                    <button
                      key={t.path || t.id || i}
                      onClick={() => onPlay(id, t.path || t.id)}
                      className={`group/row w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-all duration-150 border ${
                        rowPlaying
                          ? "bg-white/[0.06] border-white/20"
                          : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.16] hover:bg-white/[0.04]"
                      }`}
                      title={`Lire « ${t.title} »`}
                    >
                      <span className="w-5 shrink-0 flex items-center justify-center">
                        {isVideo ? (
                          <Video className={`w-4 h-4 ${rowPlaying ? "text-white" : "text-white/55"}`} />
                        ) : (
                          <Music className={`w-4 h-4 ${rowPlaying ? "text-white" : "text-white/55"}`} />
                        )}
                      </span>
                      {t.thumbnail ? (
                        <img src={THUMB_PROXY + encodeURIComponent(t.thumbnail)} className="w-8 h-8 rounded-md object-cover ring-1 ring-white/[0.08] shrink-0" alt="" loading="lazy" />
                      ) : null}
                      <span className={`flex-1 min-w-0 ${
                        rowPlaying ? "text-white font-semibold" : "text-white/90 group-hover/row:text-white"
                      }`}>
                        <span className="block truncate text-[11px]">{t.title}</span>
                        <span className="block truncate text-[9px] font-mono mt-0.5 text-muted/80">{metaLabel}</span>
                      </span>
                      {dur && (
                        <span className={`shrink-0 text-[10px] font-mono tabular-nums ${rowPlaying ? "text-white" : "text-white/70"}`}>
                          {dur}
                        </span>
                      )}
                      {rowPlaying ? (
                        <PlayingIcon className="w-3 h-3" />
                      ) : (
                        <Play className="w-3.5 h-3.5 text-white/30 shrink-0 opacity-0 group-hover/row:opacity-100 group-hover/row:text-accent-red transition-all duration-150" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
      {showManager && (
        <PlaylistSongsManager
          playlistId={id}
          playlist={playlist}
          localDirs={localDirs}
          onAdd={onAdd}
          onRemove={onRemove}
          onClose={() => setShowManager(false)}
        />
      )}
    </>
  );
}

export default function PlaylistsView({ playlists, onPlay, onDelete, onCreate, onRename, localDirs, onAddToPlaylist, onRemoveFromPlaylist, currentSong, isLocal }) {
  const ids = Object.keys(playlists);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const currentKey = currentSong ? currentSong.path || currentSong.id : null;

  const toggle = (id) => setExpandedId((prev) => (prev === id ? null : id));

  const handleCreate = (e) => {
    e.preventDefault();
    const v = newName.trim();
    if (v) {
      onCreate(v);
      setNewName("");
      setShowCreate(false);
    }
  };

  return (
    <section className="relative flex-1 min-h-0">
      <div className="sticky top-0 z-30 -mx-5 px-5 pt-2 pb-2.5 backdrop-blur-2xl bg-bg/85 border-b border-white/[0.05]">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] ring-1 ring-white/[0.08] px-3 py-1.5 shadow-subtle">
            <span className="text-[11px] font-bold text-white">
              {ids.length}
            </span>
            <span className="text-[11px] text-white/80 font-medium">
              playlist{ids.length !== 1 ? "s" : ""}
            </span>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className={PRIMARY_BTN}
          >
            <Plus className="w-3.5 h-3.5" />
            Nouvelle
          </button>
        </div>
      </div>

      <div className="pt-3">
        {showCreate && (
          <form onSubmit={handleCreate} className="flex items-center gap-2 mb-3 p-3 rounded-2xl bg-white/[0.03] ring-1 ring-white/15 shadow-soft animate-fade-in">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nom de la playlist..."
              className="flex-1 bg-white/[0.06] rounded-xl px-3 py-2 text-xs text-white/90 placeholder-white/30 outline-none focus:ring-1 focus:ring-white/30 border border-white/[0.08]"
              onKeyDown={(e) => { if (e.key === "Escape") { setShowCreate(false); setNewName(""); } }}
            />
            <button
              type="submit"
              disabled={!newName.trim()}
              className={PRIMARY_BTN + " disabled:opacity-40 disabled:cursor-not-allowed"}
            >
              Créer
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setNewName(""); }}
              className="p-2 rounded-xl text-white/50 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </form>
        )}

        {ids.length === 0 && !showCreate && (
          <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in-up">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.05] ring-1 ring-white/[0.10] flex items-center justify-center mb-4">
              <ListMusic className="w-6 h-6 text-white/70" />
            </div>
            <p className="text-sm text-white/85 font-medium">Aucune playlist</p>
            <p className="text-[11px] text-muted/80 mt-1.5 max-w-xs leading-relaxed">
              Créez une playlist puis ajoutez vos morceaux favoris.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-medium text-white bg-white/[0.08] ring-1 ring-white/[0.14] hover:bg-white/[0.14] hover:ring-white/25 transition-all duration-200 active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              Créer une playlist
            </button>
          </div>
        )}

        {ids.length > 0 && (
          <div className="space-y-1.5 animate-fade-in-up">
            {ids.map((id) => (
              <PlaylistCard
                key={id}
                id={id}
                playlist={playlists[id]}
                isOpen={expandedId === id}
                onToggle={() => toggle(id)}
                onPlay={onPlay}
                onDelete={onDelete}
                onRename={onRename}
                localDirs={localDirs}
                currentKey={currentKey}
                onAdd={onAddToPlaylist}
                onRemove={onRemoveFromPlaylist}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
