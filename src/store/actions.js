import { api, friendlyError, SERVER_UNREACHABLE } from "../api/client.js";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./store.jsx";

export function useActions() {
  const { state, dispatch } = useStore();

  const search = async (query) => {
    if (!query.trim()) return;
    dispatch({ type: "SEARCH_START" });
    try {
      const data = await api.search(query);
      if (Array.isArray(data)) dispatch({ type: "SEARCH_SUCCESS", results: data });
      else dispatch({ type: "SEARCH_ERROR", error: friendlyError(data.error) || "Erreur inconnue du serveur" });
    } catch (err) {
      console.error("Erreur de recherche :", err);
      dispatch({ type: "SEARCH_ERROR", error: SERVER_UNREACHABLE });
    }
  };

  const play = (song, playlist) => dispatch({ type: "PLAY", song, playlist });
  const playLocal = (song, path, playlist) => dispatch({ type: "PLAY_LOCAL", song, path, playlist });
  const saveCurrentToResume = () => {
    if (!state.currentSong || !state.streamUrl) return;
    try {
      const existing = JSON.parse(localStorage.getItem("mediacli-resume") || "null");
      if (!existing || existing.url !== state.streamUrl || Math.abs((existing.time || 0) - state.progress) > 2) {
        localStorage.setItem("mediacli-resume", JSON.stringify({ song: state.currentSong, url: state.streamUrl, time: state.progress }));
      } else {
        localStorage.setItem("mediacli-resume", JSON.stringify({ ...existing, time: state.progress }));
      }
    } catch {}
  };

  const playNext = () => {
    saveCurrentToResume();
    dispatch({ type: "PLAY_NEXT" });
  };
  const playPrev = () => {
    saveCurrentToResume();
    dispatch({ type: "PLAY_PREV" });
  };
  const playAt = (index) => {
    saveCurrentToResume();
    dispatch({ type: "PLAY_AT", index });
  };
  const playEnded = () => dispatch({ type: "PLAY_ENDED" });
  const stop = () => dispatch({ type: "STOP_PLAYBACK" });

  const download = async (song, format) => {
    const key = `${song.id}-${format}`;
    dispatch({ type: "DOWNLOAD_STATUS", key, status: "downloading" });
    dispatch({ type: "SET_ERROR", error: null });
    try {
      const { data } = await api.download(song.id, song.title, format);
      if (data.success) dispatch({ type: "DOWNLOAD_STATUS", key, status: "done" });
      else {
        dispatch({ type: "DOWNLOAD_STATUS", key, status: "error" });
        dispatch({ type: "SET_ERROR", error: data.error || "Échec du téléchargement" });
      }
    } catch (err) {
      console.error("Erreur de téléchargement :", err);
      dispatch({ type: "DOWNLOAD_STATUS", key, status: "error" });
      dispatch({ type: "SET_ERROR", error: SERVER_UNREACHABLE });
    }
  };

  const setTor = async (on) => {
    if (on && !state.torActive) {
      try {
        await api.proxy("start");
      } catch {
        /* noop */
      }
    } else if (!on && state.torActive) {
      try {
        await api.proxy("stop");
      } catch {
        /* noop */
      }
    }
    dispatch({ type: "SET_TOR", on });
  };

  const scanFolders = async () => {
    dispatch({ type: "LOCAL_SCAN_START" });
    try {
      if (navigator.userAgent.includes("Android")) {
        try { await invoke("request_android_storage_permission"); } catch {}
      }
      const res = await fetch("http://127.0.0.1:8787/scan-folders");
      const data = await res.json().catch(() => ({}));
      const ok = res.ok;
      if (!ok || data.error) {
        dispatch({ type: "LOCAL_SCAN_ERROR", error: data.error || "Impossible de scanner les dossiers." });
        return;
      }
      const folders = data.folders || [];
      if (folders.length === 0) {
        if (navigator.userAgent.includes("Android")) {
          try { await api.requestPermissions(); } catch {}
        }
        dispatch({
          type: "LOCAL_SCAN_ERROR",
          error: "Aucun dossier trouvé. Sur Android, autorisez l'accès aux fichiers dans les paramètres, puis réessayez.",
        });
      } else {
        folders.forEach(f => dispatch({ type: "LOCAL_SCAN_PROGRESS", folder: f }));
        dispatch({ type: "LOCAL_SCAN_SUCCESS", folders });
      }
    } catch {
      dispatch({ type: "LOCAL_SCAN_ERROR", error: "Impossible de scanner les dossiers." });
    }
  };

  const openFolder = async (path) => {
    dispatch({ type: "LOCAL_OPEN_FOLDER", path });
    try {
      const [a, v] = await Promise.all([api.listFolder(path, "audio"), api.listFolder(path, "video")]);
      const err = a.error || v.error;
      if (err) {
        dispatch({ type: "LOCAL_FOLDER_ERROR", error: err });
        return;
      }
      const merged = [...(a.files || []), ...(v.files || [])].sort((x, y) => x.name.localeCompare(y.name));
      dispatch({ type: "LOCAL_FILES_LOADED", files: merged });
    } catch {
      dispatch({ type: "LOCAL_FOLDER_ERROR", error: "Impossible de lister le dossier." });
    }
  };

  const pickFolder = async () => {
    try {
      const dir = await invoke("select_folder_dialog");
      if (dir && typeof dir === "string") openFolder(dir);
    } catch (err) {
      console.error(err);
      dispatch({ type: "LOCAL_FOLDER_ERROR", error: String(err) });
    }
  };

  const playFolder = async (path) => {
    try {
      const [a, v] = await Promise.all([api.listFolder(path, "audio"), api.listFolder(path, "video")]);
      const err = a.error || v.error;
      if (err) {
        dispatch({ type: "LOCAL_FOLDER_ERROR", error: err });
        return;
      }
      const merged = [...(a.files || []), ...(v.files || [])].sort((x, y) => x.name.localeCompare(y.name));
      if (merged.length === 0) {
        dispatch({ type: "LOCAL_FOLDER_ERROR", error: "Aucun fichier audio ou vidéo dans ce dossier." });
        return;
      }
      const first = merged[0];
      dispatch({
        type: "PLAY_LOCAL",
        song: { id: first.path, title: first.name, channel: "Local", thumbnail: null, duration: 0 },
        path: first.path,
        playlist: merged,
      });
    } catch (err) {
      console.error(err);
      dispatch({ type: "LOCAL_FOLDER_ERROR", error: "Impossible de lire ce dossier." });
    }
  };

  const resetFolder = () => dispatch({ type: "LOCAL_RESET_FOLDER" });

  const createPlaylist = (name) => dispatch({ type: "CREATE_PLAYLIST", name });
  const renamePlaylist = (id, name) => dispatch({ type: "RENAME_PLAYLIST", id, name });
  const deletePlaylist = (id) => dispatch({ type: "DELETE_PLAYLIST", id });
  const addToPlaylist = (id, track) => dispatch({ type: "ADD_TO_PLAYLIST", id, track });
  const removeFromPlaylist = (id, trackId) => dispatch({ type: "REMOVE_FROM_PLAYLIST", id, trackId });
  const saveQueueAsPlaylist = (name, tracks) => dispatch({ type: "SAVE_QUEUE_AS_PLAYLIST", name, tracks });

  return {
    search,
    play,
    playLocal,
    playNext,
    playPrev,
    playAt,
    playEnded,
    stop,
    download,
    setTor,
    scanFolders,
    openFolder,
    playFolder,
    pickFolder,
    resetFolder,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    saveQueueAsPlaylist,
  };
}
