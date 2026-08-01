import { Shield, ShieldOff, ExternalLink } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";

export function VpnModal({ torActive, onConfirm, onSkip }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="absolute inset-0 modal-overlay" onClick={onSkip} />
      <div className="relative w-full max-w-sm modal-card rounded-2xl p-6 animate-fade-in-up">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 ring-1 ring-amber-500/25 flex items-center justify-center shadow-[0_0_14px_-3px_rgba(245,158,11,0.4)]">
            <Shield className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white/90">Protection de la vie privée</h3>
            <p className="text-[11px] text-muted/60">Choisissez une option</p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={onConfirm}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl modal-btn-primary text-white text-sm font-medium cursor-pointer"
          >
            <Shield className="w-4 h-4" />
            {torActive ? "Désactiver le mode Tor" : "Activer le mode Tor"}
          </button>
          <button
            onClick={() => open("https://1.1.1.1/")}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl modal-btn-secondary text-white/70 hover:text-white text-sm font-medium cursor-pointer"
          >
            <ExternalLink className="w-4 h-4" />
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
      </div>
    </div>
  );
}
