import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { Loader2 } from "lucide-react";

export default function SearchBar({ query, setQuery, onSearch, loading }) {
  const [focused, setFocused] = useState(false);
  const measureRef = useRef(null);
  const formRef = useRef(null);
  const [cursorLeft, setCursorLeft] = useState(0);

  useLayoutEffect(() => {
    if (measureRef.current) {
      setCursorLeft(measureRef.current.offsetWidth);
    }
  }, [query]);

  useEffect(() => {
    if (!focused) return;
    const onDown = (e) => {
      if (formRef.current && !formRef.current.contains(e.target)) {
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [focused]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch();
  };

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className={`group relative flex items-center gap-0 h-[3.25rem] rounded-md transition-all duration-300 my-1 overflow-hidden border ${
        focused
          ? "bg-[#020204] border-white/70 shadow-[0_0_20px_-4px_rgba(255,255,255,0.1)]"
          : "bg-[#040406] border-[#ff3b5c]/40 shadow-[0_0_30px_-4px_rgba(255,59,92,0.3),0_2px_16px_-4px_rgba(0,0,0,0.5)]"
      }`}
    >
      {/* Prompt panel */}
      <div className={`flex items-center gap-2 w-14 h-full shrink-0 transition-all duration-300 border-r ${
        focused
          ? "bg-[#ff3b5c]/[0.07] border-[#ff3b5c]/20"
          : "bg-white/[0.015] border-white/[0.04]"
      }`}>
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 text-[#ff3b5c] animate-spin ml-4" />
        ) : (
          <span className={`ml-3 font-mono text-sm font-bold transition-all duration-200 ${
            focused
              ? "text-[#ff3b5c] drop-shadow-[0_0_6px_rgba(255,59,92,0.7)]"
              : "text-white/80"
          }`}>
            ❯
          </span>
        )}
      </div>

      {/* Input + cursor */}
      <div className="flex-1 flex items-center h-full relative">
        {/* Hidden span to measure text width */}
        <span
          ref={measureRef}
          className="absolute invisible font-mono text-[13px] tracking-wider pointer-events-none"
          aria-hidden="true"
        >
          {query}
        </span>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSearch(); } }}
          placeholder={!focused && !query ? "Recherchez une chanson, un artiste, un album…" : focused && !query ? "chanson · artiste · album · playlist…" : ""}
          style={{ outline: "none", boxShadow: "none" }}
          className="w-full h-full bg-transparent outline-none appearance-none font-mono text-[13px] text-white/90 text-white/80 tracking-wider caret-transparent px-4"
          spellCheck={false}
          autoComplete="off"
        />

        {focused && (
          <span
            className="absolute font-mono text-[18px] font-bold text-[#ff3b5c]/80 pointer-events-none animate-[cursor-blink_1s_step-end_infinite]"
            style={{ left: `calc(16px + ${cursorLeft}px)` }}
          >
            _
          </span>
        )}
      </div>

      {/* Submit - toujours visible des qu'il y a du texte (sinon le blur de l'input
          fait disparaitre le bouton avant le clic et la recherche ne se lance pas) */}
      {query.trim() && (
        <button
          type="submit"
          className="shrink-0 flex items-center gap-1.5 h-full px-4 text-[#ff3b5c]/80 hover:text-[#ff3b5c] hover:bg-[#ff3b5c]/[0.05] transition-all duration-200 font-mono text-[11px] font-medium tracking-wider border-l border-white/[0.04]"
          aria-label="Rechercher"
        >
          ENTER
          <span className="text-[10px] opacity-90">↵</span>
        </button>
      )}
    </form>
  );
}
