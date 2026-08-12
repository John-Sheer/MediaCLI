export function Logo({ className = "w-5 h-5" }) {
  return (
    <svg viewBox="36 30 60 92" className={className}>
      <g transform="translate(0,0)">
        <path
          d="M66,30 C75,37 86,41 96,43 C96,43 96,68 96,82 C96,102 84,116 66,122 C48,116 36,102 36,82 C36,68 36,43 36,43 C46,41 57,37 66,30 Z"
          fill="#c81e3a"
        />
        <circle cx="66" cy="76" r="24" fill="none" stroke="#ffffff" strokeWidth="3" />
        <path d="M60,66 C60,63 63,61 66,63 L79,72 C82,74 82,78 79,80 L66,89 C63,91 60,89 60,86 Z" fill="#ffffff" />
        <g transform="translate(76,82) scale(1.4)">
          <path d="M4,9 V5 A2.5,2.5 0 0,1 9,5 V9" fill="none" stroke="#111" strokeWidth="1.5" />
          <rect x="2" y="9" width="9" height="7" rx="1.5" fill="#111" />
          <circle cx="6.5" cy="12.5" r="1.5" fill="#fff" />
        </g>
        <path d="M 85,90.7 A 24,24 0 0,0 88,85.6" fill="none" stroke="#ffffff" strokeWidth="3" />
      </g>
    </svg>
  );
}

const CLI_RED = "#ff3b5c";

export function CLIText({ className = "", bold = true }) {
  return (
    <span className={className} style={{ fontFamily: "'JetBrains Mono', monospace" }}>
      <span className="text-white/85">media</span>
      <span style={{ color: CLI_RED, fontWeight: bold ? 700 : 500 }}>CLI</span>
    </span>
  );
}

export const CLI_COLOR = CLI_RED;
