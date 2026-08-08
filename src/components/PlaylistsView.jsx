import { Music, Play, Trash2, ListMusic, FolderOpen, Plus } from "lucide-react";

function PlaylistCard({ id, playlist, onPlay, onDelete, onOpen }) {
  const trackCount = playlist.tracks?.length || 0;
  const firstThumb = playlist.tracks?.[0]?.thumbnail;

  return (
    <div
      className="group flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] ring-1 ring-white/[0.05] hover:ring-white/[0.12] transition-all duration-200 cursor-pointer active:scale-[0.98]"
      onClick={() => onOpen(id)}
    >
      <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-white/[0.04] ring-1 ring-white/[0.06]">
        {firstThumb ? (
          <img src={"http://127.0.0.1:8787/thumb?url=" + encodeURIComponent(firstThumb)} className="w-full h-full object-cover" alt="" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ListMusic className="w-5 h-5 text-white/80" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-white/90 truncate group-hover:text-white transition-colors">
          {playlist.name}
        </p>
        <p className="text-[10px] text-white/80 mt-0.5">
          {trackCount} titre{trackCount !== 1 ? "s" : ""}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <button
          onClick={(e) => { e.stopPropagation(); onPlay(id); }}
          className="p-2 rounded-lg bg-accent-red/15 text-accent-red hover:bg-accent-red/25 transition-colors"
          title="Lire"
        >
          <Play className="w-3.5 h-3.5" fill="currentColor" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(id); }}
          className="p-2 rounded-lg bg-white/[0.04] text-white/80 hover:text-red-400 hover:bg-red-400/10 transition-colors"
          title="Supprimer"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export default function PlaylistsView({ playlists, onPlay, onDelete, onCreate }) {
  const ids = Object.keys(playlists);

  if (ids.length === 0) {
    return (
      <section className="relative flex-1 min-h-0">
        <div className="flex flex-col items-center justify-center py-24 text-center animate-fade-in-up">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-b from-white/10 to-white/5 ring-1 ring-white/15 flex items-center justify-center mb-4">
            <ListMusic className="w-6 h-6 text-white/80" />
          </div>
          <p className="text-sm text-white/85 font-medium">Aucune playlist</p>
          <p className="text-[11px] text-muted/80 mt-1.5 max-w-xs leading-relaxed">
            Créez une playlist depuis la file d'attente ou le menu contextuel d'un titre.
          </p>
          <button
            onClick={onCreate}
            className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-medium text-accent-red ring-1 ring-accent-red/30 hover:bg-accent-red/10 transition-all duration-200 active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            Créer une playlist
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="relative flex-1 min-h-0 pt-4">
      <div className="flex items-center justify-between mb-2 px-1">
        <p className="text-[10px] font-mono text-muted/80 uppercase tracking-[0.15em]">
          {ids.length} playlist{ids.length > 1 ? "s" : ""}
        </p>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-1 text-[10px] font-mono text-muted/80 hover:text-accent-red transition-colors"
        >
          <Plus className="w-3 h-3" />
          Nouvelle
        </button>
      </div>
      <div className="space-y-1.5 animate-fade-in-up">
        {ids.map((id) => (
          <PlaylistCard
            key={id}
            id={id}
            playlist={playlists[id]}
            onPlay={onPlay}
            onDelete={onDelete}
            onOpen={onPlay}
          />
        ))}
      </div>
    </section>
  );
}
