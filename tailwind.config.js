/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "#050508",
        panel: "#0d0d14",
        surface: "#12121e",
        border: "#1e1e2e",
        accent: {
          red: "#c81e3a",
          glow: "#d93a52",
        },
        muted: "#b8b8cc",
        red: "#ff3b5c",
        gold: "#e0b15a",
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "monospace"],
      },
      boxShadow: {
        glow: "0 0 20px -4px rgba(200, 30, 58, 0.15)",
        "glow-lg": "0 0 40px -8px rgba(200, 30, 58, 0.2)",
        glass: "0 8px 32px rgba(0, 0, 0, 0.4)",
        subtle: "0 1px 3px rgba(0, 0, 0, 0.3)",
        soft: "0 2px 12px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
        elevated: "0 18px 50px -12px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255,255,255,0.05)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-down": {
          "0%": { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "pill-in": {
          "0%": { opacity: "0", transform: "translate(-50%, 22px) scale(0.92)" },
          "45%": { opacity: "1", transform: "translate(-50%, -4px) scale(1.04)" },
          "70%": { opacity: "1", transform: "translate(-50%, 1px) scale(0.99)" },
          "100%": { opacity: "1", transform: "translate(-50%, 0) scale(1)" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(12px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out",
        "fade-in-up": "fade-in-up 0.5s ease-out",
        "fade-in-down": "fade-in-down 0.25s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        "pill-in": "pill-in 0.45s cubic-bezier(0.22,1,0.36,1)",
        "slide-in-right": "slide-in-right 0.3s ease-out",
        "shimmer": "shimmer 2.5s linear infinite",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
