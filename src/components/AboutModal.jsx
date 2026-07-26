import { Logo, CLIText } from "./Logo.jsx";

export function AboutModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="absolute inset-0 modal-overlay" onClick={onClose} />
      <div className="relative w-full max-w-xs modal-card rounded-2xl p-8 animate-fade-in-up flex flex-col items-center text-center">
        <Logo className="w-16 h-16" />
        <h2 className="mt-4 font-mono text-xl font-bold tracking-tight">
          <CLIText />
        </h2>
        <p className="text-[10px] font-mono text-muted/60 mt-1">v0.1.0</p>
        <div className="w-10 h-px bg-gradient-to-r from-transparent via-accent-red/60 to-transparent my-4" />
        <p className="text-xs text-muted/80 leading-relaxed">
          Écoute, télécharge et organise ta musique.
        </p>
        <div className="mt-3 space-y-1.5 text-left w-full">
          {[
            "Recherche & streaming",
            "Téléchargement MP3 / MP4",
            "Bibliothèque locale",
            "Playlists & file d'attente",
            "Paroles synchronisées",
            "Égaliseur & tonalité",
            "Minuterie de sommeil",
            "Mode Tor pour la vie privée",
          ].map((f) => (
            <p key={f} className="text-[10px] text-muted/60 flex items-center gap-1.5">
              <span className="text-accent-red/70">▸</span>{f}
            </p>
          ))}
        </div>
        <p className="text-[10px] font-mono text-muted/40 mt-4 tracking-wider">&copy; 2026 Sheer</p>
        <button
          onClick={onClose}
          className="mt-5 w-full py-2.5 rounded-xl modal-btn-secondary text-xs text-muted hover:text-white cursor-pointer"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}
