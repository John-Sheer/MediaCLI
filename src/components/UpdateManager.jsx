import { useEffect, useState, useCallback } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { Download, X, RefreshCw } from "lucide-react";

const IS_ANDROID = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent || "");
const MANIFEST_URL = "https://mediacli-app.web.app/updates/latest.json";
const DISMISSED_KEY = "mediacli-update-dismissed";

const compareVersions = (a, b) => {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
};

export default function UpdateManager() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [downloadedPath, setDownloadedPath] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISSED_KEY) || null; } catch { return null; }
  });

  const checkForUpdates = useCallback(async () => {
    try {
      setError(null);
      if (IS_ANDROID) {
        const response = await fetch(MANIFEST_URL, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const manifest = await response.json();
        const entry = manifest.platforms?.["android-arm64"];
        if (!entry) return;
        const current = await getVersion();
        if (compareVersions(manifest.version, current) <= 0) {
          try { localStorage.removeItem(DISMISSED_KEY); } catch {}
          setDismissed(null);
          return;
        }
        const mVersion = manifest.version;
        let stored = null;
        try { stored = localStorage.getItem(DISMISSED_KEY); } catch {}
        if (stored === mVersion) return;
        setUpdateInfo({
          version: mVersion,
          notes: manifest.notes || "Nouvelle version disponible",
          url: entry.url,
        });
      } else {
        const update = await check();
        if (update) {
          let stored = null;
          try { stored = localStorage.getItem(DISMISSED_KEY); } catch {}
          if (stored === update.version) return;
          setUpdateInfo({
            version: update.version,
            notes: update.body || "Nouvelle version disponible",
            date: update.date,
          });
        }
      }
    } catch (e) {
      console.error("[updater] check failed:", e);
    }
  }, []);

  useEffect(() => {
    checkForUpdates();
    const interval = setInterval(checkForUpdates, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkForUpdates]);

  const handleDownloadAndroid = async () => {
    let unlisten = null;
    try {
      unlisten = await listen("apk-download-progress", (event) => {
        setProgress(typeof event.payload === "number" ? event.payload : 0);
      });
      const path = await invoke("download_apk", { url: updateInfo.url });
      setDownloadedPath(path);
      setProgress(100);
      setDownloaded(true);
    } catch (e) {
      console.error("[updater] android download failed:", e);
      const msg =
        typeof e === "string" ? e : e?.message || JSON.stringify(e);
      setError(`Échec du téléchargement : ${msg}`);
    } finally {
      if (unlisten) unlisten();
      setDownloading(false);
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    setError(null);
    try {
      let can = await invoke("can_install_apk");
      if (!can) {
        await invoke("request_install_permission");
        setError(
          "Autorisez « Installer des applications inconnues » dans les paramètres, puis retouchez Installer."
        );
        return;
      }
      await invoke("install_apk", { path: downloadedPath });
      setError("Suivez l'installation à l'écran système, puis revenez ici.");
    } catch (e) {
      console.error("[updater] android install failed:", e);
      const msg =
        typeof e === "string" ? e : e?.message || JSON.stringify(e);
      setError(`Échec de l'installation : ${msg}`);
    } finally {
      setInstalling(false);
    }
  };

  const handleDownload = async () => {
    if (!updateInfo) return;
    try { localStorage.setItem(DISMISSED_KEY, updateInfo.version); } catch {}
    setDownloading(true);
    setDownloaded(false);
    setProgress(0);
    setError(null);
    if (IS_ANDROID) {
      await handleDownloadAndroid();
      return;
    }
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
      await invoke("relaunch_app");
    } catch (e) {
      console.error("[updater] download failed:", e);
      setError("Échec du téléchargement. Réessayez.");
    } finally {
      setDownloading(false);
    }
  };

  const handleDismiss = () => {
    if (updateInfo?.version) {
      try { localStorage.setItem(DISMISSED_KEY, updateInfo.version); } catch {}
    }
    setDismissed(updateInfo?.version || "dismissed");
    setUpdateInfo(null);
  };

  if (!updateInfo || (dismissed && dismissed === updateInfo.version)) return null;

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
              {IS_ANDROID ? "Téléchargement de l'APK..." : "Téléchargement..."}
            </p>
          </div>
        )}

        {downloaded && !downloading && (
          <p className="mt-3 text-xs text-emerald-400 text-center font-medium">
            MAJ v{updateInfo.version} téléchargée. Touchez « Installer » pour
            continuer.
          </p>
        )}

        {error && (
          <p className="mt-2 text-[10px] text-red-400 text-center">{error}</p>
        )}

        <div className="flex gap-2 mt-3">
          <button
            onClick={downloaded ? handleInstall : handleDownload}
            disabled={downloading || installing}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
          >
            <Download size={13} />
            {downloading
              ? IS_ANDROID
                ? "Téléchargement de l'APK..."
                : "Téléchargement..."
              : downloaded
                ? "Installer"
                : "Mettre à jour"}
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
