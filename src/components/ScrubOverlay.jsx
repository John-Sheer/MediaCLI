import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function ScrubOverlay() {
  const [info, setInfo] = useState(null);
  const [gesture, setGesture] = useState(null);

  useEffect(() => {
    let timer = null;
    let gTimer = null;
    const onScrub = (e) => {
      const d = e.detail || {};
      setInfo({ delta: d.delta ?? 0, position: d.position ?? 0, duration: d.duration ?? 0 });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setInfo(null), 1500);
    };
    const onGesture = (e) => {
      const d = e.detail || {};
      setGesture({ kind: d.kind || "" });
      if (gTimer) clearTimeout(gTimer);
      gTimer = setTimeout(() => setGesture(null), 900);
    };
    window.addEventListener("media-scrub", onScrub);
    window.addEventListener("media-gesture", onGesture);
    return () => {
      window.removeEventListener("media-scrub", onScrub);
      window.removeEventListener("media-gesture", onGesture);
      if (timer) clearTimeout(timer);
      if (gTimer) clearTimeout(gTimer);
    };
  }, []);

  const GESTURES = {
    play: { label: "PLAY", fill: "#4ea1ff" },
    pause: { label: "PAUSE", fill: "#ff3b5c" },
    next: { label: "NEXT", fill: "#4ea1ff" },
    previous: { label: "PREVIOUS", fill: "#ff3b5c" },
  };

  const current = gesture && GESTURES[gesture.kind];

  if (!info && !current) return null;

  const pos = Number(info?.position) || 0;
  const dur = Number(info?.duration) || 0;
  const delta = Number(info?.delta) || 0;

  return createPortal(
    <div style={{
      position: "fixed", top: "22%", left: "50%", transform: "translateX(-50%)",
      zIndex: 2147483647, pointerEvents: "none", display: "flex", alignItems: "center",
      gap: 12, background: "rgba(0,0,0,0.78)", padding: "14px 22px", borderRadius: 999,
      border: "1px solid rgba(255,255,255,0.15)", boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
      flexDirection: "column",
    }}>
      {current ? (
        <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1, color: current.fill }}>
          {current.label}
        </span>
      ) : null}
      {info ? (
        <>
          <span style={{ fontSize: 22, fontWeight: 700, color: delta >= 0 ? "#ff3b5c" : "#4ea1ff" }}>
            {delta >= 0 ? "+" : "-"}{Math.abs(Math.round(delta))}s
          </span>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", fontVariantNumeric: "tabular-nums" }}>
            {Math.floor(pos / 60)}:{String(Math.floor(pos % 60)).padStart(2, "0")} / {Math.floor(dur / 60)}:{String(Math.floor(dur % 60)).padStart(2, "0")}
          </span>
        </>
      ) : null}
    </div>,
    document.body
  );
}
