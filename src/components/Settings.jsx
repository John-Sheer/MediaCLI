import { useState, useEffect } from "react";
import { X, Volume2, Play, FolderOpen, Bell, RotateCcw, Info, ChevronRight, Check } from "lucide-react";

const SETTINGS_KEY = "mediacli-settings";

const DEFAULTS = {
  defaultVolume: 0.4,
  resumeOnStart: true,
  defaultShuffle: false,
  defaultRepeat: "off",
  crossfadeDuration: 0,
  showNotifications: true,
  proxyEnabled: false,
  fontSize: 14,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

export function getSettings() {
  return loadSettings();
}

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
        checked ? "bg-accent-red" : "bg-white/[0.15]"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? "translate-x-5" : ""
        }`}
      />
    </button>
  );
}

function Slider({ value, onChange, min, max, step = 1, unit = "" }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-red-600"
      />
      <span className="text-xs text-white/80 w-10 text-right tabular-nums">{value}{unit}</span>
    </div>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={14} className="text-accent-red/80" />
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-white/80">{title}</h3>
      </div>
      <div className="space-y-3 pl-6">{children}</div>
    </div>
  );
}

function SettingRow({ label, description, children }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs text-white/90">{label}</p>
        {description && <p className="text-[10px] text-white/50 mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function Settings({ open, onClose }) {
  const [settings, setSettings] = useState(loadSettings);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    if (open) setSettings(loadSettings());
  }, [open]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  if (!open) return null;

  const update = (key, value) => setSettings((s) => ({ ...s, [key]: value }));

  const resetAll = () => {
    setSettings({ ...DEFAULTS });
    setShowResetConfirm(false);
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md max-h-[85vh] mx-4 bg-[#0c0c14] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h2 className="text-sm font-semibold text-white/90">Paramètres</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.08] text-white/70 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scroll-modern px-5 py-4" style={{ fontSize: `${settings.fontSize}px` }}>
          <Section icon={Volume2} title="Audio">
            <SettingRow label="Volume par défaut" description={`Valeur de départ : ${Math.round(settings.defaultVolume * 100)}%`}>
              <div className="w-32">
                <Slider value={Math.round(settings.defaultVolume * 100)} onChange={(v) => update("defaultVolume", v / 100)} min={0} max={100} step={5} unit="%" />
              </div>
            </SettingRow>
            <SettingRow label="Fondu entre pistes" description="Durée de transition (0 = désactivé)">
              <div className="w-32">
                <Slider value={settings.crossfadeDuration} onChange={(v) => update("crossfadeDuration", v)} min={0} max={10} step={1} unit="s" />
              </div>
            </SettingRow>
          </Section>

          <Section icon={Play} title="Lecture">
            <SettingRow label="Reprise automatique" description="Reprendre la dernière position au lancement">
              <Toggle checked={settings.resumeOnStart} onChange={(v) => update("resumeOnStart", v)} />
            </SettingRow>
            <SettingRow label="Lecture aléatoire par défaut">
              <Toggle checked={settings.defaultShuffle} onChange={(v) => update("defaultShuffle", v)} />
            </SettingRow>
            <SettingRow label="Répétition par défaut">
              <div className="flex gap-1">
                {["off", "all", "one"].map((m) => (
                  <button
                    key={m}
                    onClick={() => update("defaultRepeat", m)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                      settings.defaultRepeat === m
                        ? "bg-accent-red text-white"
                        : "bg-white/[0.06] text-white/70 hover:bg-white/[0.1]"
                    }`}
                  >
                    {m === "off" ? "Non" : m === "all" ? "Toutes" : "1"}
                  </button>
                ))}
              </div>
            </SettingRow>
          </Section>

          <Section icon={FolderOpen} title="Fichiers">
            <SettingRow label="Proxy Tor (yt-dlp)" description="Utiliser le proxy pour les téléchargements">
              <Toggle checked={settings.proxyEnabled} onChange={(v) => update("proxyEnabled", v)} />
            </SettingRow>
          </Section>

          <Section icon={Bell} title="Système">
            <SettingRow label="Notifications" description="Afficher les notifications de lecture">
              <Toggle checked={settings.showNotifications} onChange={(v) => update("showNotifications", v)} />
            </SettingRow>
          </Section>

          <Section icon={RotateCcw} title="Maintenance">
            {showResetConfirm ? (
              <div className="bg-white/[0.05] rounded-xl p-3">
                <p className="text-xs text-white/80 mb-3">Réinitialiser tous les paramètres aux valeurs par défaut ?</p>
                <div className="flex gap-2">
                  <button onClick={resetAll} className="flex-1 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors">
                    Confirmer
                  </button>
                  <button onClick={() => setShowResetConfirm(false)} className="flex-1 py-1.5 rounded-lg bg-white/[0.08] text-white/80 text-xs font-medium hover:bg-white/[0.12] transition-colors">
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowResetConfirm(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
              >
                <RotateCcw size={14} className="text-white/60" />
                <span className="text-xs text-white/80">Réinitialiser les paramètres</span>
                <ChevronRight size={12} className="text-white/40 ml-auto" />
              </button>
            )}
          </Section>

          <Section icon={Info} title="À propos">
            <div className="bg-white/[0.03] rounded-xl p-3 text-[11px] text-white/60 leading-relaxed">
              <p className="font-semibold text-white/80 mb-1">MediaCLI v0.1.12</p>
              <p>Lecteur média streaming & local avec téléchargement yt-dlp.</p>
              <p className="mt-1">&copy; 2026 Sheer. Tous droits réservés.</p>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
