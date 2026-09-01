import { Logo, CLIText } from "./Logo.jsx";
import { Info, AlertTriangle, X } from "lucide-react";

const COPYRIGHT_YEAR = new Date().getFullYear();

const FEATURES = [
  "Recherche & streaming",
  "Téléchargement MP3 / MP4",
  "Bibliothèque locale",
  "Playlists & file d'attente",
  "Paroles synchronisées",
  "Égaliseur & tonalité",
  "Minuterie de sommeil",
  "Mode Tor pour la vie privée",
];

const WARNINGS = [
  "Usage strictement personnel : toute utilisation commerciale, revente des services ou redistribution du lecteur à des fins lucratives est interdite sans accord écrit de l'éditeur.",
  "Ne téléchargez que des contenus libres de droits, tombés dans le domaine public ou pour lesquels vous disposez d'une autorisation explicite. La reproduction de contenus protégés par les droits d'auteur est interdite.",
  "Les contenus diffusés proviennent de services tiers accessibles publiquement. MediaCLI ne revend ni n'héberge aucun morceau et n'est pas affilié à ces plateformes.",
  "Les marques et logos cités (dont YouTube™ et YouTube Music™) appartiennent à leurs propriétaires respectifs ; leur mention n'implique aucun partenariat ni parrainage.",
  "Le service est fourni « tel quel », sans garantie. L'éditeur ne peut être tenu responsable d'un usage contraire aux présentes conditions.",
];

export function AboutModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="absolute inset-0 modal-overlay" onClick={onClose} />
      <div className="relative w-full max-w-sm modal-card rounded-2xl p-6 animate-fade-in-up flex flex-col text-center max-h-[85vh] overflow-y-auto scroll-modern">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center">
          <Logo className="w-14 h-14" />
          <h2 className="mt-3 font-mono text-lg font-bold tracking-tight">
            <CLIText />
          </h2>
          <p className="text-[10px] font-mono text-muted/85 mt-0.5">v0.1.16</p>
          <div className="w-10 h-px bg-gradient-to-r from-transparent via-accent-red/60 to-transparent my-3" />
        </div>

        <div className="text-left">
          <SectionTitle icon={Info} label="À propos du lecteur" />
          <p className="text-xs text-muted/90 leading-relaxed">
            Écoute, télécharge et organise ta musique. Un lecteur multimédia local & streaming,
            pensé pour la vitesse, la simplicité et la vie privée.
          </p>
          <div className="mt-3 space-y-1.5">
            {FEATURES.map((f) => (
              <p key={f} className="text-[10.5px] text-muted/85 flex items-center gap-1.5">
                <span className="text-accent-red/90">▸</span>{f}
              </p>
            ))}
          </div>
        </div>

        <div className="mt-4 text-left">
          <SectionTitle icon={AlertTriangle} label="Avertissements — commercialisation & usage" accent />
          <div className="space-y-2">
            {WARNINGS.map((w, i) => (
              <p key={i} className="text-[11px] text-muted/90 leading-relaxed">
                <span className="text-amber-400/90 font-bold mr-1">•</span>
                {w}
              </p>
            ))}
          </div>
          <p className="mt-3 text-[10px] font-mono text-muted/80 tracking-wider text-center">
            © {COPYRIGHT_YEAR} Sheer
          </p>
        </div>

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

function SectionTitle({ icon: Icon, label, accent }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon className={`w-3.5 h-3.5 ${accent ? "text-amber-400/90" : "text-white/70"}`} />
      <p className={`text-[10px] uppercase tracking-[0.2em] ${accent ? "text-amber-400/90" : "text-white/60"}`}>
        {label}
      </p>
    </div>
  );
}