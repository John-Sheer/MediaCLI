import { useRef, useState } from "react";

const SIDE_STYLES = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2.5",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2.5",
  right: "left-full top-1/2 -translate-y-1/2 ml-2.5",
  left: "right-full top-1/2 -translate-y-1/2 mr-2.5",
};

const ARROW_STYLES = {
  top: "top-full left-1/2 -translate-x-1/2 border-t-panel",
  bottom: "bottom-full left-1/2 -translate-x-1/2 border-b-panel",
  right: "right-full top-1/2 -translate-y-1/2 border-r-panel",
  left: "left-full top-1/2 -translate-y-1/2 border-l-panel",
};

export default function Tooltip({ label, children, side = "top", className = "", delay = 120 }) {
  const [open, setOpen] = useState(false);
  const openTimer = useRef(null);

  const show = () => {
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(true), delay);
  };

  const hide = () => {
    window.clearTimeout(openTimer.current);
    setOpen(false);
  };

  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      <span
        role="tooltip"
        aria-hidden={!open}
        className={`pointer-events-none absolute z-[120] transition-all duration-150 select-none ${
          SIDE_STYLES[side]
        } ${open ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}
      >
        <span
          className={`block whitespace-nowrap rounded-lg border border-white/10 bg-panel/95 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-elevated backdrop-blur-md ${
            open ? "animate-fade-in" : ""
          }`}
        >
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent-glow align-middle shadow-[0_0_8px_rgba(255,59,92,0.8)]" />
          {label}
        </span>
        <span
          className={`pointer-events-none absolute h-0 w-0 border-[5px] border-transparent ${ARROW_STYLES[side]}`}
        />
      </span>
    </span>
  );
}
