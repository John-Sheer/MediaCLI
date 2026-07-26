import { useEffect, useState, useCallback } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { Download, X, RefreshCw } from "lucide-react";

export default function UpdateManager() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  const checkForUpdates = useCallback(async () => {
    try {
      setError(null);
      const update = await check();
      if (update && !dismissed) {
        setUpdateInfo({
          version: update.version,
          notes: update.body || "Nouvelle version disponible",
          date: update.date,
        });
      }
    } catch (e) {
      console.error("[updater] check failed:", e);
    }
  }, [dismissed]);

  useEffect(() => {
    checkForUpdates();
    const interval = setInterval(checkForUpdates, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkForUpdates]);

  const handleDownload = async () => {
    if (!updateInfo) return;
    setDownloading(true);
    setProgress(0);
    setError(null);
    try {
      const update = await check();
      if (!update) {
        setError("Mise à jour introuvable.");
        setDownloading(false);
        return;
      }
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setProgress(0);
        } else if (event.event === "Progress") {
          const chunk = event.data?.chunkLength || 0;
          setProgress((prev) => Math.min(prev + chunk, 100));
        } else if (event.event === "Finished") {
          setProgress(100);
        }
      });
    } catch (e) {
      console.error("[updater] download failed:", e);
      setError("Échec du téléchargement. Réessayez.");
    } finally {
      setDownloading(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    setUpdateInfo(null);
  };

  if (!updateInfo || dismissed) return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-md animate-fade-in">
      <div className="bg-[#1a1a2e]/95 backdrop-blur-xl border border-purple-500/20 rounded-2xl p-4 shadow-2xl shadow-purple-500/10">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <RefreshCw size={14} className="text-purple-400" />
              <span className="text-xs font-semibold text-purple-400 uppercase tracking-wide">
                Mise à jour
              </span>
              <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full">
                v{updateInfo.version}
              </span>
            </div>
            <p className="text-xs text-gray-400 line-clamp-2">{updateInfo.notes}</p>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 rounded-lg hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        {downloading && (
          <div className="mt-3">
            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-violet-400 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-500 mt-1 text-center">
              Téléchargement...
            </p>
          </div>
        )}

        {error && (
          <p className="mt-2 text-[10px] text-red-400 text-center">{error}</p>
        )}

        <div className="flex gap-2 mt-3">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
          >
            <Download size={13} />
            {downloading ? "Installation..." : "Mettre à jour"}
          </button>
          <button
            onClick={handleDismiss}
            className="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 text-xs font-medium transition-colors"
          >
            Plus tard
          </button>
        </div>
      </div>
    </div>
  );
}
