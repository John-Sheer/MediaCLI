import { useRef, useState, useCallback, useEffect } from "react";
import { X, ListMusic } from "lucide-react";


export default function QueuePanel({
  visible,
  onClose,
  playlist = [],
  currentSong,
  onPlayAt,
  playlists = {},
  onSaveQueue,
  onPlayPlaylist,
  onDeletePlaylist,
  onRemoveFromPlaylist,
}) {
  const panelRef = useRef(null);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [pos, setPos] = useState({ x: window.innerWidth - 340, y: 120 });
  const [tab, setTab] = useState("queue");


  const handleDragStart = useCallback((e) => {
    if (e.target.closest("button") || e.target.closest("input")) return;
    dragging.current = true;
    const t = e.touches ? e.touches[0] : e;
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect) {
      dragOffset.current = { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
  }, []);

  useEffect(() => {
    const getPoint = (e) => (e.touches ? e.touches[0] : e);
    const onMove = (e) => {
      if (!dragging.current) return;
      if (e.touches) e.preventDefault();
      const t = getPoint(e);
      const rect = panelRef.current?.getBoundingClientRect();
      const w = rect?.width || 288;
      const h = rect?.height || 400;
      const g = 40;
      setPos({
        x: Math.min(Math.max(t.clientX - dragOffset.current.x, -w + g), window.innerWidth - g),
        y: Math.min(Math.max(t.clientY - dragOffset.current.y, -h + g), window.innerHeight - g),
      });
    };
    const onUp = () => { dragging.current = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      ref={panelRef}
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 9000 }}
      className="w-72 max-h-[80vh] flex flex-col rounded-2xl border border-white/[0.06] shadow-elevated overflow-hidden select-none"
      onMouseDown={handleDragStart}
    >
      <div
        onTouchStart={(e) => { e.stopPropagation(); handleDragStart(e); }}
        className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]" style={{ background: "rgba(16,16,22,0.96)", backdropFilter: "blur(24px) saturate(150%)", cursor: "grab", touchAction: "none" }}
      >
        <div className="flex items-center gap-1">
          <ListMusic size={13} className="text-white/80 mr-1" />
          <button onClick={() => setTab("queue")} className={`text-[12px] font-semibold transition-colors px-2 py-1 rounded-md ${tab === "queue" ? "text-white/90 bg-white/[0.06]" : "text-white/80 hover:text-white/85"}`}>File</button>
          <button onClick={() => setTab("playlists")} className={`text-[12px] font-semibold transition-colors px-2 py-1 rounded-md ${tab === "playlists" ? "text-white/90 bg-white/[0.06]" : "text-white/80 hover:text-white/85"}`}>Playlists</button>
        </div>
        <button onClick={onClose} className="p-1 rounded-md text-white/80 hover:text-white/90 hover:bg-white/[0.06] transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scroll-modern p-2 space-y-0.5" style={{ background: "rgba(16,16,22,0.96)", backdropFilter: "blur(24px) saturate(150%)", maxHeight: "calc(80vh - 44px)" }}>
        {tab === "queue" ? (
          <>
            {playlist.length === 0 && (
              <p className="text-[11px] text-white/80 px-2 py-6 text-center">Aucune piste en file.</p>
            )}
            {playlist.map((item, i) => {
              const idKey = item.path || item.id;
              const isCurrent = currentSong && idKey && currentSong.id === idKey;
              return (
                <button
                  key={i}
                  onClick={() => onPlayAt && onPlayAt(i)}
                  className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-colors ${isCurrent ? "bg-white/[0.18] text-white font-semibold" : "hover:bg-white/[0.04] text-white/90"}`}
                >
                  <span className={`text-[9px] font-mono w-5 shrink-0 ${isCurrent ? "text-white" : "opacity-90"}`}>{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex-1 min-w-0 truncate text-[11px]">{item.name || item.title}</span>
                  {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />}
                </button>
              );
            })}
            {playlist.length > 0 && (
              <button
                onClick={() => { const n = window.prompt("Nom de la playlist :", "File d'attente"); if (n !== null) onSaveQueue && onSaveQueue(n || "File d'attente", playlist); }}
                className="w-full mt-1 text-[10px] py-1.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] text-white/90 ring-1 ring-white/[0.1] transition-colors"
              >
                Sauvegarder la file
              </button>
            )}
          </>
        ) : (
          <>
            {Object.values(playlists).length === 0 && (
              <p className="text-[11px] text-white/80 px-2 py-6 text-center">Aucune playlist sauvegardée.</p>
            )}
            {Object.values(playlists).map((pl) => (
              <div key={pl.id} className="rounded-lg bg-white/[0.02] border border-white/[0.04] overflow-hidden mb-1">
                <div className="flex items-center justify-between px-2.5 py-2">
                  <button onClick={() => onPlayPlaylist && onPlayPlaylist(pl.id)} className="flex-1 min-w-0 text-left">
                    <p className="text-[11px] font-medium text-white/90 truncate">{pl.name}</p>
                    <p className="text-[9px] text-white/80">{pl.tracks.length} piste{pl.tracks.length > 1 ? "s" : ""}</p>
                  </button>
                  <button onClick={() => { if (window.confirm(`Supprimer "${pl.name}" ?`)) onDeletePlaylist && onDeletePlaylist(pl.id); }} className="p-1 rounded-md text-white/80 hover:text-accent-red hover:bg-accent-red/10 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="px-1.5 pb-1.5 space-y-0.5 max-h-36 overflow-y-auto scroll-modern">
                  {pl.tracks.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-white/[0.03]">
                      <button onClick={() => onPlayPlaylist && onPlayPlaylist(pl.id, t.id)} className="flex-1 min-w-0 text-left">
                        <span className="block truncate text-[10px] text-white/85">{t.title}</span>
                        <span className="block truncate text-[8px] text-green-400/85">{t.channel}</span>
                      </button>
                      <button onClick={() => onRemoveFromPlaylist && onRemoveFromPlaylist(pl.id, t.id)} className="p-0.5 rounded text-white/80 hover:text-accent-red transition-colors">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
