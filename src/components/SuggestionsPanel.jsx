import { useEffect, useRef, useState } from "react";
import { Sparkles, RefreshCw, Loader2, Play, Music, AlertCircle } from "lucide-react";
import { api } from "../api/client.js";
import { getPreferenceTerms } from "../lib/suggestions.js";
import { thumbUrl } from "../lib/thumb.js";
const MAX = 8;

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function SongSuggestion({ song, onPlay }) {
  return (
    <button
      onClick={() => onPlay(song)}
      title={song.title}
      className="group relative overflow-hidden rounded-xl ring-1 ring-white/[0.06] bg-white/[0.02] hover:ring-white/[0.18] hover:bg-white/[0.05] transition-all duration-300 text-left active:scale-[0.98]"
    >
      <div className="relative aspect-video overflow-hidden">
        {song.thumbnail ? (
          <img
            src={thumbUrl(song.thumbnail)}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <div className="w-full h-full bg-white/[0.04] flex items-center justify-center">
            <Music className="w-6 h-6 text-white/60" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-300 flex items-center justify-center">
          <span className="w-11 h-11 rounded-full bg-white/[0.12] ring-1 ring-white/25 backdrop-blur-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 translate-x-[1px]">
            <Play className="w-5 h-5 text-white" fill="currentColor" />
          </span>
        </div>
        <div className="absolute inset-x-0 top-0 px-2 pt-1.5 pb-4 bg-gradient-to-b from-black/70 via-black/25 to-transparent pointer-events-none">
          <p className="truncate text-[10px] font-semibold tracking-wide text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            {song.channel || "Artiste"}
          </p>
        </div>
      </div>
      <div className="p-2">
        <p className="truncate text-[11px] font-semibold leading-snug text-white/90">{song.title}</p>
      </div>
    </button>
  );
}

export default function SuggestionsPanel({ playlists, onPlay }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState(false);
  const busy = useRef(false);

  const load = async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(false);
    setEmpty(false);
    try {
      const terms = getPreferenceTerms(playlists);
      if (terms.length === 0) {
        setEmpty(true);
        setLoading(false);
        busy.current = false;
        return;
      }
      const pool = [...terms];
      const picks = [];
      while (picks.length < Math.min(2, pool.length)) {
        picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      }
      const settled = await Promise.allSettled(picks.map((t) => api.search(t)));
      const merged = new Map();
      for (const r of settled) {
        if (r.status !== "fulfilled" || !Array.isArray(r.value)) continue;
        for (const s of r.value) {
          if (!s) continue;
          const key = s.id || s.path;
          if (key && !merged.has(key)) merged.set(key, s);
        }
      }
      const list = shuffle([...merged.values()]).slice(0, MAX);
      if (list.length === 0) setEmpty(true);
      setItems(list);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      busy.current = false;
    }
  };

  useEffect(() => {
    load();
    return () => { busy.current = true; };
  }, []);

  return (
    <div className="animate-fade-in-up">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-white/70" />
          <p className="text-[11px] text-white/85 font-medium">Suggestions pour vous</p>
          <span className="text-[9.5px] text-white/40 font-mono hidden sm:inline">selon vos playlists & recherches</span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          title="Nouvelles suggestions"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10.5px] text-white/60 hover:text-white/90 hover:bg-white/[0.06] transition-colors duration-200 active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Autres suggestions
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-white/50">
          <Loader2 className="w-3.5 h-3.5 text-[#ff3b5c] animate-spin" />
          Recherche de suggestions…
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-[11px] text-white/55">Impossible de charger les suggestions.</p>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-[#ff3b5c]/90 ring-1 ring-[#ff3b5c]/20 hover:bg-[#ff3b5c]/[0.06] transition-all duration-200"
          >
            <RefreshCw className="w-3 h-3" />
            Réessayer
          </button>
        </div>
      )}

      {!loading && empty && (
        <div className="flex flex-col items-center gap-2 py-8 text-center px-4">
          <AlertCircle className="w-5 h-5 text-white/30" />
          <p className="text-[11px] text-white/55 leading-relaxed max-w-[300px]">
            Lancez votre première recherche ou ajoutez des morceaux à une playlist
            pour recevoir des suggestions personnalisées.
          </p>
        </div>
      )}

      {!loading && !empty && items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {items.map((song) => (
            <SongSuggestion key={song.id || song.path} song={song} onPlay={onPlay} />
          ))}
        </div>
      )}
    </div>
  );
}