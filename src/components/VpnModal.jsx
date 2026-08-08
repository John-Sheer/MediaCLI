import { Shield, ShieldOff, Zap, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";

export function VpnModal({ torActive, onConfirm, onSkip }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="absolute inset-0 modal-overlay" onClick={onSkip} />
      <div className="relative w-full max-w-sm modal-card rounded-2xl overflow-hidden animate-fade-in-up">
        <div className="h-[3px] bg-gradient-to-r from-accent-red via-accent-red/60 to-transparent" />

        <div className="p-6">
          <div className="flex items-start gap-3 mb-5">
            <div
              className={`relative shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ring-1 transition-colors duration-300 ${
                torActive
                  ? "bg-green-500/10 ring-green-500/30 shadow-[0_0_18px_-4px_rgba(34,197,94,0.45)]"
                  : "bg-amber-500/10 ring-amber-500/25 shadow-[0_0_18px_-4px_rgba(245,158,11,0.4)]"
              }`}
            >
              {torActive ? (
                <Shield className="w-5 h-5 text-green-400" />
              ) : (
                <Shield className="w-5 h-5 text-amber-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-white/90">Protection de la vie privée</h3>
              <p className="text-[11px] text-muted/85 mt-0.5">Choisissez une option pour votre connexion</p>
            </div>
            <button
              onClick={onSkip}
              className="shrink-0 p-1.5 rounded-lg text-white/50 hover:text-white/90 hover:bg-white/[0.06] transition-colors cursor-pointer"
              aria-label="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div
            className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg mb-5 border text-[11px] font-mono tracking-wide ${
              torActive
                ? "bg-green-500/[0.06] border-green-500/20 text-green-400/90"
                : "bg-white/[0.03] border-white/[0.06] text-muted"
            }`}
          >
            <span className="relative flex h-2 w-2 shrink-0">
              {torActive && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400/60" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  torActive ? "bg-green-400" : "bg-white/50"
                }`}
              />
            </span>
            {torActive ? "Mode Tor actif — trafic anonymisé" : "Protection actuellement inactive"}
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={onConfirm}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl modal-btn-primary text-white text-sm font-medium cursor-pointer"
            >
              {torActive ? <ShieldOff className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
              {torActive ? "Désactiver le mode Tor" : "Activer le mode Tor"}
            </button>
            <button
              onClick={() => open("https://1.1.1.1/")}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl modal-btn-secondary text-white/90 hover:text-white text-sm font-medium cursor-pointer"
            >
              <Zap className="w-4 h-4 text-amber-400" />
              Utiliser Cloudflare WARP
            </button>
            <button
              onClick={onSkip}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl modal-btn-secondary text-muted hover:text-white text-sm cursor-pointer"
            >
              <ShieldOff className="w-4 h-4" />
              Continuer sans protection
            </button>
          </div>

          <div className="mt-4 pt-4 border-t border-white/[0.05]">
            <p className="text-[9px] text-muted/80 leading-relaxed text-center">
              Le mode Tor achemine vos recherches via un réseau chiffré. WARP chiffre la connexion via Cloudflare.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
