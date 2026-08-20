import { useState, useEffect, useCallback } from "react";
import { Music, Play, Trash2, ListMusic, Plus, X, Pencil, Search, Check, Loader2, FolderOpen, ChevronLeft } from "lucide-react";
import { api } from "../api/client.js";

function AddSongsPicker({ playlistId, playlist, localDirs, onAdd, onClose }) {
  const [search, setSearch] = useState("");
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
      const files = [
        ...(audio.files || []).map((f) => ({ ...f, _kind: "file" })),
        ...(video.files || []).map((f) => ({ ...f, _kind: "file" })),
      ];
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
    setSearch("");
    setCurrentPath(path);
  };

  const goBack = () => {
    if (breadcrumbs.length === 0) {
      setCurrentPath(null);
      setEntries([]);
      setSearch("");
      return;
    }
    const prev = breadcrumbs[breadcrumbs.length - 1];
    setBreadcrumbs((b) => b.slice(0, -1));
    setSearch("");
    setCurrentPath(prev.path);
  };

  const filtered = entries.filter((e) =>
    e.name.toLowerCase().includes(search.toLowerCase())
  );
  const files = filtered.filter((e) => e._kind === "file");
  const dirs = filtered.filter((e) => e._kind === "folder");

  const handleAdd = (file) => {
    const track = { id: file.path, title: file.name, channel: "Local", thumbnail: null, duration: 0 };
    onAdd(playlistId, track);
    setAdded((prev) => new Set(prev).add(file.path));
  };

  const atRoot = currentPath === null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[80vh] bg-[#0c0c14] rounded-t-2xl sm:rounded-2xl ring-1 ring-white/[0.08] shadow-2xl flex flex-col animate-slide-up">
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
                {atRoot ? `Ajouter à « ${playlist.name} »` : (breadcrumbs[breadcrumbs.length - 1]?.name || "...")}
              </p>
              <p className="text-[10px] text-muted mt-0.5">
                {loading ? "Chargement..." : `${files.length} morceau${files.length !== 1 ? "x" : ""}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {files.length > 0 && (
              <button
                onClick={() => files.forEach((f) => !added.has(f.path) && !existingIds.has(f.path) && handleAdd(f))}
                className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-accent-red ring-1 ring-accent-red/30 hover:bg-accent-red/10 transition-colors active:scale-95"
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

        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={atRoot ? "Rechercher un dossier..." : "Rechercher un morceau..."}
              className="w-full bg-white/[0.06] rounded-xl pl-8 pr-3 py-2 text-xs text-white/90 placeholder-white/30 outline-none focus:ring-1 focus:ring-accent-red/40 border border-white/[0.08]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-0.5">
          {loading && (
            <div className="py-10 flex flex-col items-center gap-3">
              <Loader2 className="w-5 h-5 text-accent-red animate-spin" />
              <p className="text-[11px] text-muted">Chargement...</p>
            </div>
          )}
          {!loading && atRoot && dirs.length === 0 && (
            <div className="py-10 text-center text-[11px] text-muted">
              Aucun dossier trouvé. Scannez d'abord vos fichiers dans l'onglet Local.
            </div>
          )}
          {!loading && !atRoot && entries.length === 0 && (
            <div className="py-10 text-center text-[11px] text-muted">
              Aucun fichier dans ce dossier.
            </div>
          )}
          {!loading && dirs.map((d) => (
            <button
              key={d.path}
              onClick={() => navigateTo(d.path, d.name)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left bg-white/[0.02] border border-transparent hover:bg-white/[0.05] hover:border-white/[0.08] transition-all duration-150"
            >
              <div className="w-7 h-7 rounded-md bg-accent-red/10 flex items-center justify-center shrink-0">
                <FolderOpen className="w-3.5 h-3.5 text-accent-red" />
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
                onClick={() => !isIn && handleAdd(f)}
                disabled={isIn}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-150 border ${
                  isIn
                    ? "bg-accent-red/[0.08] border-accent-red/30 opacity-60"
                    : "bg-white/[0.02] border-transparent hover:bg-white/[0.05] hover:border-white/[0.08]"
                }`}
              >
                <div className="w-7 h-7 rounded-md bg-white/[0.04] flex items-center justify-center shrink-0">
                  {added.has(f.path) ? (
                    <Check className="w-3.5 h-3.5 text-accent-red" />
                  ) : existingIds.has(f.path) ? (
                    <Check className="w-3.5 h-3.5 text-green-400" />
                  ) : (
                    <Music className="w-3.5 h-3.5 text-white/50" />
                  )}
                </div>
                <span className={`flex-1 min-w-0 text-[11px] truncate ${
                  added.has(f.path) ? "text-accent-red" : existingIds.has(f.path) ? "text-green-400/80" : "text-white/85"
                }`}>
                  {f.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlaylistCard({ id, playlist, onPlay, onDelete, onRename, localDirs, onAdd }) {
  const trackCount = playlist.tracks?.length || 0;
  const firstThumb = playlist.tracks?.[0]?.thumbnail;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(playlist.name);
  const [showPicker, setShowPicker] = useState(false);

  return (
    <>
      <div className="group flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] ring-1 ring-white/[0.05] hover:ring-white/[0.12] transition-all duration-200 active:scale-[0.98]">
        <div
          className="w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-white/[0.04] ring-1 ring-white/[0.06] cursor-pointer"
          onClick={() => onPlay(id)}
        >
          {firstThumb ? (
            <img src={"http://127.0.0.1:8787/thumb?url=" + encodeURIComponent(firstThumb)} className="w-full h-full object-cover" alt="" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ListMusic className="w-5 h-5 text-white/80" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onPlay(id)}>
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
              <p className="text-[12px] font-semibold text-white/90 truncate group-hover:text-white transition-colors">
                {playlist.name}
              </p>
              <p className="text-[10px] text-white/80 mt-0.5">
                {trackCount} titre{trackCount !== 1 ? "s" : ""}
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setShowPicker(true); }}
            className="p-1.5 rounded-lg text-accent-red/80 hover:text-accent-red hover:bg-accent-red/10 transition-colors"
            title="Ajouter des morceaux"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
            className="p-1.5 rounded-lg text-white/50 hover:text-white/80 hover:bg-white/[0.06] transition-colors opacity-0 group-hover:opacity-100"
            title="Renommer"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(id); }}
            className="p-2 rounded-lg bg-accent-red/15 text-accent-red hover:bg-accent-red/25 transition-colors opacity-0 group-hover:opacity-100"
            title="Lire"
          >
            <Play className="w-3.5 h-3.5" fill="currentColor" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(id); }}
            className="p-2 rounded-lg bg-white/[0.04] text-white/80 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
            title="Supprimer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {showPicker && (
        <AddSongsPicker
          playlistId={id}
          playlist={playlist}
          localDirs={localDirs}
          onAdd={onAdd}
          onClose={() => setShowPicker(false)}
        />
      )}
    </>
  );
}

export default function PlaylistsView({ playlists, onPlay, onDelete, onCreate, onRename, localDirs, onAddToPlaylist }) {
  const ids = Object.keys(playlists);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

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
    <section className="relative flex-1 min-h-0 pt-4">
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-[10px] font-mono text-muted/80 uppercase tracking-[0.15em]">
          {ids.length} playlist{ids.length !== 1 ? "s" : ""}
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-accent-red ring-1 ring-accent-red/30 hover:bg-accent-red/10 transition-all duration-200 active:scale-95"
        >
          <Plus className="w-3 h-3" />
          Nouvelle
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="flex items-center gap-2 mb-3 px-1 animate-fade-in">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nom de la playlist..."
            className="flex-1 bg-white/[0.06] rounded-xl px-3 py-2 text-xs text-white/90 placeholder-white/30 outline-none focus:ring-1 focus:ring-accent-red/40 border border-white/[0.08]"
            onKeyDown={(e) => { if (e.key === "Escape") { setShowCreate(false); setNewName(""); } }}
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            className="px-3 py-2 rounded-xl bg-accent-red text-white text-[11px] font-medium hover:bg-accent-red/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
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
          <div className="w-12 h-12 rounded-xl bg-gradient-to-b from-white/10 to-white/5 ring-1 ring-white/15 flex items-center justify-center mb-4">
            <ListMusic className="w-6 h-6 text-white/80" />
          </div>
          <p className="text-sm text-white/85 font-medium">Aucune playlist</p>
          <p className="text-[11px] text-muted/80 mt-1.5 max-w-xs leading-relaxed">
            Créez une playlist puis ajoutez vos morceaux favoris.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-medium text-accent-red ring-1 ring-accent-red/30 hover:bg-accent-red/10 transition-all duration-200 active:scale-95"
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
              onPlay={onPlay}
              onDelete={onDelete}
              onRename={onRename}
              localDirs={localDirs}
              onAdd={onAddToPlaylist}
            />
          ))}
        </div>
      )}
    </section>
  );
}
