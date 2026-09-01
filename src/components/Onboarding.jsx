import { useState } from "react";
import { Logo, CLIText } from "./Logo.jsx";
import { Search, FolderOpen, ListMusic, Download, MonitorPlay, Settings as SettingsIcon, ChevronRight, ChevronLeft, X, Play, Music, Video } from "lucide-react";

/* ------------------------------------------------------------------ *
 *  Petit composant "pillule" réutilisable pour les illustrations.
 *  Reprend le design réel de la pillule du lecteur (fond rouge, logo,
 *  pastille animée) pour bien ancrer l'accent sur la pilule.
 * ------------------------------------------------------------------ */
function Pillule({ size = 70, active = true }) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-full text-white ring-1 ring-white/20 shadow-[0_8px_26px_-6px_rgba(200,30,58,0.6)]"
      style={{ background: "linear-gradient(135deg,#e03650,#b01634)", width: size, height: size * 0.42, paddingLeft: size * 0.12 }}
    >
      <span
        className="rounded-full overflow-hidden shrink-0 flex items-center justify-center ring-1 ring-white/25"
        style={{ width: size * 0.24, height: size * 0.24, background: "rgba(0,0,0,0.28)" }}
      >
        <Logo className="w-[60%] h-[60%]" />
      </span>
      <span
        className="rounded-full"
        style={{ width: size * 0.1, height: size * 0.1, background: "#fff", boxShadow: "0 0 8px rgba(255,255,255,0.9)" }}
      />
    </div>
  );
}

/* Illustration : le grand lecteur se replie vers la pillule (module 3). */
function PillTransition() {
  return (
    <div className="w-full flex flex-col items-center">
      <div className="relative w-44 h-20">
        <div className="absolute left-1/2 -translate-x-1/2 top-0 w-40 h-14 rounded-lg bg-white/[0.06] ring-1 ring-white/[0.10] flex items-center justify-center">
          <Play className="w-4 h-4 text-white/60" />
          <span className="ml-1.5 text-[8px] font-mono text-white/50">Lecteur</span>
        </div>
        <svg className="absolute left-1/2 top-14 -translate-x-1/2 w-40 h-7 overflow-visible" viewBox="0 0 160 28" preserveAspectRatio="none">
          <path d="M 22 4 C 30 26 130 26 138 4" fill="none" stroke="rgba(255,59,92,0.6)" strokeWidth="2" strokeDasharray="5 4">
            <animate attributeName="stroke-dashoffset" from="18" to="0" dur="1.2s" repeatCount="indefinite" />
          </path>
        </svg>
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
          <Pillule size={54} />
        </div>
      </div>
      <div className="mt-1 text-center">
        <p className="font-mono text-[9px] text-red tracking-wide">LE LECTEUR DEVIENT LA PILLULE</p>
      </div>
    </div>
  );
}

/* Illustration : recherche streaming + lecture. */
function StreamingVisual() {
  return (
    <div className="w-full flex flex-col items-center gap-2">
      <div className="w-40 rounded-lg bg-white/[0.05] ring-1 ring-white/[0.10] px-2 py-1.5 flex items-center gap-1.5">
        <Search className="w-3 h-3 text-white/50" />
        <span className="h-1.5 flex-1 rounded-full bg-white/[0.14]" />
        <span className="w-3 h-3 rounded-full" style={{ background: "linear-gradient(135deg,#e03650,#b01634)" }} />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-md bg-white/[0.06] ring-1 ring-white/[0.10] flex items-center justify-center">
          <Music className="w-3 h-3 text-white/60" />
        </span>
        <span className="w-7 h-7 rounded-full text-white flex items-center justify-center" style={{ background: "linear-gradient(135deg,#e03650,#b01634)" }}>
          <Play className="w-3 h-3" />
        </span>
      </div>
    </div>
  );
}

/* Illustration : dossier local audio & vidéo. */
function LocalVisual() {
  const files = [
    { icon: Music, w: 60 },
    { icon: Music, w: 46 },
    { icon: Video, w: 52 },
    { icon: Music, w: 40 },
  ];
  return (
    <div className="w-full flex items-end justify-center gap-1.5">
      {files.map((f, i) => (
        <div
          key={i}
          className="rounded-t-md rounded-b-sm bg-white/[0.06] ring-1 ring-white/[0.10] flex items-center justify-center"
          style={{ width: f.w, height: 22 + i * 5 }}
        >
          <f.icon className="w-3 h-3 text-white/60" />
        </div>
      ))}
    </div>
  );
}

/* Illustration : pile de playlists / file d'attente. */
function PlaylistVisual() {
  return (
    <div className="w-full flex flex-col items-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="w-40 flex items-center gap-1.5 rounded-md bg-white/[0.05] ring-1 ring-white/[0.08] px-2 py-1">
          <span className={`w-1.5 h-1.5 rounded-full ${i === 1 ? "" : "bg-white/20"}`} style={i === 1 ? { background: "#c81e3a" } : {}} />
          <span className="h-1 flex-1 rounded-full bg-white/[0.14]" />
          <span className="w-3 h-3 rounded-full" style={{ background: "linear-gradient(135deg,#e03650,#b01634)" }} />
        </div>
      ))}
    </div>
  );
}

/* Illustration : téléchargement MP3 / MP4. */
function DownloadVisual() {
  return (
    <div className="w-full flex items-center justify-center gap-3">
      {["MP3", "MP4"].map((ext) => (
        <div key={ext} className="w-14 h-14 rounded-lg bg-white/[0.05] ring-1 ring-white/[0.10] flex flex-col items-center justify-center gap-1">
          <Download className="w-4 h-4 text-white/70" />
          <span className="font-mono text-[8px] text-white/50">{ext}</span>
        </div>
      ))}
    </div>
  );
}

/* Illustration : personnalisation (égaliseur + engrenage). */
function CustomVisual() {
  return (
    <div className="w-full flex items-center justify-center gap-3">
      <div className="flex items-end gap-1">
        {[10, 18, 13, 22, 16, 24, 12, 20, 15].map((h, i) => (
          <span key={i} className="w-1.5 rounded-sm" style={{ height: h, background: i % 2 ? "rgba(255,59,92,0.55)" : "rgba(255,255,255,0.35)" }} />
        ))}
      </div>
      <div className="w-7 h-7 rounded-full bg-white/[0.06] ring-1 ring-white/[0.10] flex items-center justify-center">
        <SettingsIcon className="w-3.5 h-3.5 text-white/70" />
      </div>
    </div>
  );
}

const STEPS = [
  {
    icon: Search,
    title: "Lecteur Streaming",
    visual: <StreamingVisual />,
    body: "Tapez une recherche en haut pour trouver et écouter des titres en streaming. Le rouge « En lecture » et la barre de progression vous suivent pendant la lecture.",
  },
  {
    icon: FolderOpen,
    title: "Lecteur Local",
    visual: <LocalVisual />,
    body: "Parcourez les dossiers de votre appareil (audio & vidéo) et lisez vos fichiers directement. Activez la permission « Tous les fichiers » pour enregistrer vos téléchargements.",
  },
  {
    icon: MonitorPlay,
    title: "Le lecteur devient la pillule",
    visual: <PillTransition />,
    body: "Quand vous fermez le lecteur, il se replie en petite pillule rouge en bas de l'écran. Touchez-la pour rouvrir le lecteur, ou glissez-la à droite (suivant) / à gauche (précédent).",
  },
  {
    icon: ListMusic,
    title: "Playlists & file d'attente",
    visual: <PlaylistVisual />,
    body: "Créez des playlists, ajoutez vos morceaux favoris et organisez la file d'attente depuis le lecteur. Vos playlists sont conservées d'une session à l'autre.",
  },
  {
    icon: Download,
    title: "Téléchargement MP3 / MP4",
    visual: <DownloadVisual />,
    body: "Depuis un résultat de recherche, ouvrez le menu « Plus d'actions » puis téléchargez l'audio (MP3) ou la vidéo (MP4). Les fichiers sont enregistrés dans votre bibliothèque locale.",
  },
  {
    icon: SettingsIcon,
    title: "Personnalisation",
    visual: <CustomVisual />,
    body: "Dans les Paramètres (icône engrenage en bas à droite) : égaliseur, tonalité, lecture aléatoire, répétition, notifications et mode Tor pour la vie privée.",
  },
];

export function Onboarding({ onClose }) {
  const [step, setStep] = useState(0);
  const total = STEPS.length;
  const s = STEPS[step];

  return (
    <div className="fixed inset-0 z-[10070] flex items-center justify-center p-5">
      <div className="absolute inset-0 modal-overlay" onClick={onClose} />
      <div className="relative w-full max-w-sm modal-card rounded-2xl p-6 animate-fade-in-up flex flex-col max-h-[86vh] overflow-y-auto scroll-modern">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          title="Passer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="w-full flex items-center justify-center min-h-[110px] rounded-2xl bg-gradient-to-b from-white/[0.03] to-transparent ring-1 ring-white/[0.06] px-2 py-3">
            {s.visual}
          </div>
          <div className="mt-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05] ring-1 ring-white/[0.08]">
            <s.icon className="w-3.5 h-3.5 text-red" />
            <h2 className="font-mono text-[13px] font-bold tracking-tight text-white">
              {s.title}
            </h2>
          </div>
          <div className="w-8 h-px bg-white/20 my-3" />
          <p className="text-xs text-muted/90 leading-relaxed">
            {s.body}
          </p>
        </div>

        <div className="flex items-center justify-center gap-1.5 mt-5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? "w-5 bg-white/80" : "w-1.5 bg-white/20"
              }`}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-center gap-2.5">
          <button
            onClick={() => setStep((st) => Math.max(0, st - 1))}
            disabled={step === 0}
            className="p-2.5 rounded-xl text-white/60 hover:text-white hover:bg-white/[0.07] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Précédent"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {step < total - 1 ? (
            <button
              onClick={() => setStep((st) => Math.min(total - 1, st + 1))}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-white/[0.09] text-white text-xs font-medium ring-1 ring-white/[0.16] hover:bg-white/[0.15] transition-colors"
            >
              Suivant
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl bg-accent-red text-white text-xs font-medium hover:bg-accent-red/90 transition-colors"
            >
              Commencer
            </button>
          )}
        </div>

        <div className="mt-4 flex items-center justify-center gap-1.5">
          <Logo className="w-3 h-3 opacity-60" />
          <span className="font-mono text-[9px] text-muted/70 tracking-wide">
            <CLIText />
          </span>
        </div>
      </div>
    </div>
  );
}
