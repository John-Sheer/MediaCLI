import { Hand, Music2, Disc3, Mic2, Headphones, Sparkles } from "lucide-react";

const CATEGORIES = [
  { label: "Artiste", icon: Mic2, query: "artist " },
  { label: "Album live", icon: Disc3, query: "album live " },
  { label: "Podcast", icon: Headphones, query: "podcast " },
  { label: "Playlist", icon: Music2, query: "playlist " },
];

const GESTURES = [
  { key: "Tap", action: "Lecture / Pause" },
  { key: "Double tap", action: "Plein écran" },
  { key: "Swipe ← →", action: "Avancer / Reculer" },
  { key: "Swipe ↑ ↓", action: "Volume" },
];

export function addRecentSearch(query) {}

export default function HomeIdleContent({ onSearch, onQueryChange }) {
  const pickCategory = (cat) => {
    onQueryChange(cat.query);
    onSearch(cat.query);
  };

  return (
    <div className="flex flex-col items-center gap-7 animate-fade-in-up">

      <div className="w-full max-w-lg">
        <div className="flex items-center justify-center gap-2 mb-3">
          <Sparkles className="w-3 h-3 text-white/80" />
          <p className="text-[10px] text-white/80 uppercase tracking-[0.2em]">Explorer par catégorie</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.label}
                onClick={() => pickCategory(cat)}
                className="group/chip inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.02] ring-1 ring-white/[0.05] text-[12px] text-white/80 hover:text-white hover:ring-accent-red/25 hover:bg-accent-red/[0.04] hover:shadow-[0_0_20px_-6px_rgba(200,30,58,0.2)] transition-all duration-300 active:scale-95"
              >
                <Icon className="w-3.5 h-3.5 opacity-30 group-hover/chip:opacity-60 transition-opacity duration-300" />
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="w-full max-w-lg">
        <div className="flex items-center justify-center gap-2 mb-3">
          <Hand className="w-3 h-3 text-white/80" />
          <p className="text-[10px] text-white/80 uppercase tracking-[0.2em]">Gestes tactile</p>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 max-w-sm mx-auto">
          {GESTURES.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3">
              <kbd className="text-[10px] text-white/80 bg-white/[0.03] px-2 py-0.5 rounded-md border border-white/[0.05] shrink-0">{s.key}</kbd>
              <span className="text-[11px] text-white/80 truncate">{s.action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
