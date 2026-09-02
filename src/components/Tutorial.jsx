import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

/*
 * Système de tutoriels contextuels.
 * Chaque tutoriel s'affiche UNE FOIS, au moment où l'utilisateur
 * découvre la fonctionnalité correspondante (première utilisation).
 *
 * Usage :
 *   <TutorialManager />
 *   Dans chaque vue, ajouter data-tutorial="id" sur l'élément cible.
 *   Le TutorialManager détecte les éléments unseen et les affiche
 *   en séquence avec un spotlight + tooltip.
 */

const STORAGE_KEY = "mediacli-tutorials";
const SPOTLIGHT_PAD = 8;
const AUTO_DISMISS_MS = 5000;

const TUTORIALS = [
  {
    id: "pill-gestures",
    message: "Le lecteur se replie en pillule. Touchez-la pour rouvrir, glissez à gauche (précédent) / à droite (suivant), vers le bas pour pause/lecture.",
    icon: "🎵",
    anchor: "top",
    pill: true,
  },
  {
    id: "tap-play",
    message: "Appuyez sur une carte pour révéler le bouton Lecture.",
    icon: "▶",
    anchor: "top",
  },
  {
    id: "more-actions",
    message: "Les trois points offrent plus d'actions : écouter, télécharger, playlist…",
    icon: "⋯",
    anchor: "bottom",
  },
  {
    id: "genre-search",
    message: "Appuyez sur un genre pour lancer une recherche rapide.",
    icon: "🔍",
    anchor: "top",
  },
  {
    id: "sleep-timer",
    message: "Programmez l'arrêt automatique de la lecture.",
    icon: "⏱",
    anchor: "bottom",
  },
  {
    id: "lyrics",
    message: "Activez les paroles synchronisées en plein écran.",
    icon: "🎤",
    anchor: "bottom",
  },
  {
    id: "drag-reorder",
    message: "Maintenez et glissez pour réorganiser vos fichiers.",
    icon: "⠿",
    anchor: "right",
  },
];

const TUTORIAL_MAP = Object.fromEntries(TUTORIALS.map((t) => [t.id, t]));

function getSeen() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function markSeen(id) {
  try {
    const seen = getSeen();
    seen[id] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
  } catch {}
}

function getFirstUnseen() {
  const seen = getSeen();
  return TUTORIALS.find((t) => !seen[t.id]) || null;
}

// Renvoie le premier tutoriel non vu DONT l'élément cible est présent et rendu
// dans le DOM. Garde la priorité de la liste : la pillule est en tête, mais si
// son élément n'existe pas (pas encore de lecture), on passe au suivant, et on
// reviendra sur la pillule plus tard quand elle apparaîtra.
function getFirstAvailable() {
  const seen = getSeen();
  for (const t of TUTORIALS) {
    if (seen[t.id]) continue;
    const el = document.querySelector(`[data-tutorial="${t.id}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // pas encore rendu
    return t;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  CoachMark — un seul tooltip spotlight positionné sur un élément.
 * ------------------------------------------------------------------ */
function CoachMark({ tutorial, targetRect, onDismiss, position }) {
  const tipRef = useRef(null);
  const [tipRect, setTipRect] = useState(null);

  useEffect(() => {
    if (tipRef.current) {
      const r = tipRef.current.getBoundingClientRect();
      setTipRect(r);
    }
  }, [tutorial]);

  if (!targetRect || !tutorial) return null;

  const pad = SPOTLIGHT_PAD;
  const spotLeft = targetRect.left - pad;
  const spotTop = targetRect.top - pad;
  const spotW = targetRect.width + pad * 2;
  const spotH = targetRect.height + pad * 2;

  // Position du tooltip par rapport à l'élément
  let tipLeft = targetRect.left + targetRect.width / 2;
  let tipTop;
  let arrowDir = "top"; // flèche pointe vers le haut (tooltip au-dessus)

  if (tutorial.anchor === "bottom") {
    tipTop = targetRect.bottom + pad + 10;
    arrowDir = "top";
  } else if (tutorial.anchor === "right") {
    tipTop = targetRect.top + targetRect.height / 2;
    tipLeft = targetRect.right + pad + 12;
    arrowDir = "left";
  } else {
    // top (default)
    tipTop = targetRect.top - pad - 10;
    arrowDir = "bottom";
  }

  // Clamp horizontal
  const tipW = tipRect?.width || 240;
  tipLeft = Math.max(16, Math.min(window.innerWidth - 16 - tipW, tipLeft - tipW / 2));

  // Clamp vertical — si pas de place en haut, basculer en bas
  if (arrowDir === "bottom" && tipTop < 8) {
    tipTop = targetRect.bottom + pad + 10;
    arrowDir = "top";
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10080]"
      onClick={onDismiss}
      onTouchEnd={(e) => { e.preventDefault(); onDismiss(); }}
    >
      {/* Overlay avec trou (spotlight) */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <mask id={`tm-${tutorial.id}`}>
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={spotLeft}
              y={spotTop}
              width={spotW}
              height={spotH}
              rx={12}
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.55)"
          mask={`url(#tm-${tutorial.id})`}
        />
      </svg>

      {/* Bordure lumineuse autour de l'élément */}
      <div
        className="absolute pointer-events-none animate-fade-in"
        style={{
          left: spotLeft,
          top: spotTop,
          width: spotW,
          height: spotH,
          borderRadius: 12,
          border: "2px solid rgba(255,59,92,0.7)",
          boxShadow: "0 0 16px 2px rgba(255,59,92,0.3)",
        }}
      />

      {/* Tooltip */}
      <div
        ref={tipRef}
        onClick={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        className="absolute animate-fade-in-up"
        style={{
          left: tipLeft,
          top: tipTop,
          transform: arrowDir === "bottom" ? "translateY(-100%)" : "none",
          width: Math.min(260, window.innerWidth - 32),
        }}
      >
        <div
          className="relative rounded-xl px-3.5 py-2.5 shadow-2xl ring-1 ring-white/[0.12]"
          style={{ background: "linear-gradient(135deg, rgba(20,20,35,0.97), rgba(15,15,28,0.97))" }}
        >
          {/* Flèche */}
          <div
            className="absolute left-1/2 -translate-x-1/2 w-0 h-0"
            style={{
              [arrowDir === "bottom" ? "bottom" : "top"]: -6,
              ...(arrowDir === "bottom"
                ? { borderTop: "6px solid rgba(20,20,35,0.97)", borderLeft: "6px solid transparent", borderRight: "6px solid transparent" }
                : { borderBottom: "6px solid rgba(20,20,35,0.97)", borderLeft: "6px solid transparent", borderRight: "6px solid transparent" }),
            }}
          />

          <div className="flex items-start gap-2.5">
            <span className="text-base shrink-0 mt-px">{tutorial.icon}</span>
            <p className="text-[11.5px] leading-snug text-white/90 font-medium flex-1">
              {tutorial.message}
            </p>
          </div>

          {/* Barre d'auto-dismiss */}
          <div className="mt-2 h-[2px] rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-accent-red/60"
              style={{
                animation: `tutorial-progress ${AUTO_DISMISS_MS}ms linear forwards`,
              }}
            />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes tutorial-progress {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ *
 *  TutorialManager — observe le DOM pour les data-tutorial, affiche
 *  les coach marks en séquence au bon moment.
 * ------------------------------------------------------------------ */
export function TutorialManager() {
  const [active, setActive] = useState(null);
  const [rect, setRect] = useState(null);
  const timerRef = useRef(null);
  const pendingRef = useRef([]);
  const mountedRef = useRef(false);

  // Cherche le prochain tutoriel (non vu) dont l'élément est présent dans le DOM
  const scanAndShow = useCallback(() => {
    if (active) return; // déjà un tutoriel affiché

    const tutorial = getFirstAvailable();
    if (!tutorial) return;

    const el = document.querySelector(`[data-tutorial="${tutorial.id}"]`);
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return; // élément pas encore rendu

    setRect(r);
    setActive(tutorial);

    // Auto-dismiss
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      dismiss();
    }, AUTO_DISMISS_MS);
  }, [active]);

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    if (active) {
      markSeen(active.id);
      setActive(null);
      setRect(null);
      // Re-scanner après un court délai pour le prochain tutoriel
      setTimeout(() => scanAndShow(), 400);
    }
  }, [active, scanAndShow]);

  // Scanner quand le contenu change (mutations DOM) ou au montage
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      // Premier scan après un délai pour laisser le DOM se stabiliser
      setTimeout(() => scanAndShow(), 800);
      return;
    }

    const observer = new MutationObserver(() => {
      // Debounce le scan
      clearTimeout(pendingRef.current._tm);
      pendingRef.current._tm = setTimeout(() => scanAndShow(), 300);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [scanAndShow]);

  // Re-scan quand l'onglet redevient visible
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") setTimeout(scanAndShow, 500);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [scanAndShow]);

  // Nettoyage timer
  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!active) return null;

  return (
    <CoachMark
      tutorial={active}
      targetRect={rect}
      onDismiss={dismiss}
    />
  );
}

/*
 * Fonction utilitaire pour vérifier si un tutoriel a été vu.
 * Utile pour les composants qui veulent masquer des hints
 * une fois le tutoriel affiché.
 */
export function useTutorialSeen(id) {
  try {
    return getSeen()[id] === true;
  } catch {
    return false;
  }
}
