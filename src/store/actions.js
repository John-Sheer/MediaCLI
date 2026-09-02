import { api, friendlyError, SERVER_UNREACHABLE, downloadErrorInfo } from "../api/client.js";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./store.jsx";

const mergeFolderFiles = (lists) => {
  const seen = new Map();
  for (const files of lists) {
    for (const f of files || []) {
      if (!seen.has(f.path)) seen.set(f.path, f);
    }
  }
  // Trie par date de modification décroissante : le dernier téléchargé en
  // premier (même entre audio et vidéo fusionnés).
  return [...seen.values()].sort((x, y) => (y.modified ?? 0) - (x.modified ?? 0));
};

export function useActions() {
  const { state, dispatch } = useStore();

  let warmToken = 0;
  let openFolderSeq = 0;

  const warmStreams = async (results) => {
    if (state.torActive) return;
    const token = ++warmToken;
    const ids = (results || [])
      .map((r) => r.id)
      .filter((id) => id && /^[A-Za-z0-9_-]{11}$/.test(id))
      .slice(0, 10);
    if (!ids.length) return;
    let i = 0;
    const worker = async () => {
      while (i < ids.length) {
        const id = ids[i++];
        if (token !== warmToken) return;
        try {
          await api.preloadStream(id);
        } catch {}
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  };

  const search = async (query) => {
    if (!query.trim()) return;
    dispatch({ type: "SEARCH_START" });
    try {
      const data = await api.search(query);
      if (Array.isArray(data)) {
        dispatch({ type: "SEARCH_SUCCESS", results: data });
        warmStreams(data);
      } else dispatch({ type: "SEARCH_ERROR", error: friendlyError(data.error) || "Erreur inconnue du serveur" });
    } catch (err) {
      console.error("Erreur de recherche :", err);
      dispatch({ type: "SEARCH_ERROR", error: SERVER_UNREACHABLE });
    }
  };

  // Mode de lecture demandé à l'écran (boutons) : "loop" = répéter la liste,
// "shuffle" = aléatoire, sinon on applique {shuffle:false, repeatMode:"off"}.
const modeFlags = (mode) => {
  switch (mode) {
    case "loop": return { shuffle: false, repeatMode: "all" };
    case "shuffle": return { shuffle: true, repeatMode: "off" };
    default: return {};
  }
};

  const play = (song, playlist, mode) => dispatch({ type: "PLAY", song, playlist, ...modeFlags(mode) });
  const playLocal = (song, path, playlist, mode) => dispatch({ type: "PLAY_LOCAL", song, path, playlist, ...modeFlags(mode) });
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
  const streamPlay = (song, playlist, mode) => {
    if (!song) return;
    const local = !!song && (song.channel === "Local" || typeof song.path === "string");
    let resumeTime = 0;
    try {
      // Position réelle de la dernière lecture (écrite par le lecteur toutes les ~3s).
      const r = JSON.parse(localStorage.getItem("mediacli-resume") || "null");
      if (r && r.song) {
        const key = song.path || song.id;
        if (r.song.id === key || r.song.path === key) resumeTime = Number.isFinite(r.time) ? r.time : 0;
      }
    } catch {}
    dispatch({
      type: "STREAM_PLAY",
      song,
      playlist,
      local,
      path: local ? (song.path || song.id) : undefined,
      resumeTime,
      ...modeFlags(mode),
    });
  };

  const download = async (song, format) => {
    const key = `${song.id}-${format}`;
    dispatch({ type: "DOWNLOAD_STATUS", key, status: "downloading" });
    dispatch({ type: "DOWNLOAD_ERROR", key, info: null });
    try {
      const { data } = await api.download(song.id, song.title, format);
      if (data.success) dispatch({ type: "DOWNLOAD_STATUS", key, status: "done" });
      else {
        dispatch({ type: "DOWNLOAD_STATUS", key, status: "error" });
        dispatch({ type: "DOWNLOAD_ERROR", key, info: downloadErrorInfo(data.error) });
      }
    } catch (err) {
      console.error("Erreur de téléchargement :", err);
      dispatch({ type: "DOWNLOAD_STATUS", key, status: "error" });
      dispatch({ type: "DOWNLOAD_ERROR", key, info: downloadErrorInfo(SERVER_UNREACHABLE) });
    }
  };

  const togglePause = async (song, format) => {
    const key = `${song.id}-${format}`;
    const paused = !!state.downloadPaused?.[key];
    dispatch({ type: "DOWNLOAD_PAUSED", key, paused: !paused });
    try {
      if (paused) await api.resumeDownload(key);
      else await api.pauseDownload(key);
    } catch (err) {
      console.error("Erreur pause/reprise :", err);
      dispatch({ type: "DOWNLOAD_PAUSED", key, paused });
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
    const isAndroid = navigator.userAgent.includes("Android");

    // Lit une réponse SSE ou JSON depuis /scan-folders.
    // Retourne { folders } ou { error }.
    const doScan = async () => {
      let res;
      try {
        res = await fetch("http://127.0.0.1:8787/scan-folders", {
          headers: { Accept: "application/json, text/event-stream" },
        });
      } catch {
        return { error: "Impossible de contacter le serveur de scan." };
      }
      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream")) {
        // Lecture streaming ligne par ligne via ReadableStream
        const folders = [];
        try {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            // Traiter les blocs SSE séparés par \n\n
            const blocks = buf.split("\n\n");
            buf = blocks.pop() ?? ""; // conserver le dernier bloc incomplet
            for (const block of blocks) {
              const line = block.split("\n").find((l) => l.startsWith("data: "));
              if (!line) continue;
              try {
                const data = JSON.parse(line.slice(6));
                if (Array.isArray(data?.folders)) folders.push(...data.folders);
                else if (data?.path) folders.push(data);
              } catch {}
            }
          }
          // Traiter le reste du buffer
          if (buf) {
            const line = buf.split("\n").find((l) => l.startsWith("data: "));
            if (line) {
              try {
                const data = JSON.parse(line.slice(6));
                if (Array.isArray(data?.folders)) folders.push(...data.folders);
                else if (data?.path) folders.push(data);
              } catch {}
            }
          }
        } catch {}
        return { folders };
      }

      // Réponse JSON classique
      let payload = {};
      try { payload = await res.json(); } catch {}
      if (!res.ok || payload.error) {
        return { error: payload.error || "Impossible de scanner les dossiers." };
      }
      return { folders: payload.folders || [] };
    };

    const applyFolders = (folders) => {
      folders.forEach((f) => dispatch({ type: "LOCAL_SCAN_PROGRESS", folder: f }));
      dispatch({ type: "LOCAL_SCAN_SUCCESS", folders });
    };
    const waitVisible = () =>
      new Promise((resolve) => {
        if (document.visibilityState === "visible") return resolve();
        const onVis = () => {
          if (document.visibilityState === "visible") {
            document.removeEventListener("visibilitychange", onVis);
            resolve();
          }
        };
        document.addEventListener("visibilitychange", onVis);
        setTimeout(resolve, 30000);
      });

    try {
      if (isAndroid) {
        // Demande la permission média (READ_MEDIA_AUDIO/VIDEO) une seule fois.
        try { await invoke("request_android_storage_permission"); } catch {}
      }
      const first = await doScan();
      if (first.error) {
        dispatch({ type: "LOCAL_SCAN_ERROR", error: first.error });
        return;
      }
      if (first.folders.length > 0) {
        applyFolders(first.folders);
        return;
      }
      // Scan vide : sur Android, ouvrir les réglages "Tous les fichiers" puis
      // rescan APRÈS le retour dans l'app (le WebView est suspendu tant que la
      // page de réglages est affichée, un fetch direct serait décalé).
      if (isAndroid) {
        if (await api.hasAllFilesAccess()) {
          try { await api.requestPermissions(); } catch {}
        } else {
          try { await api.requestAllFilesAccess(); } catch {}
        }
        await waitVisible();
        const second = await doScan();
        if (second.error) {
          dispatch({ type: "LOCAL_SCAN_ERROR", error: second.error });
          return;
        }
        if (second.folders.length > 0) {
          applyFolders(second.folders);
          return;
        }
      }
      dispatch({
        type: "LOCAL_SCAN_ERROR",
        error: "Aucun dossier trouvé. Sur Android, autorisez l'accès « Tous les fichiers » dans les paramètres ouverts, puis réessayez (redémarrez l'app si nécessaire).",
      });
    } catch {
      dispatch({ type: "LOCAL_SCAN_ERROR", error: "Impossible de scanner les dossiers." });
    }
  };

  const openFolder = async (path) => {
    const seq = ++openFolderSeq;
    dispatch({ type: "LOCAL_OPEN_FOLDER", path });
    try {
      const [a, v] = await Promise.all([api.listFolder(path, "audio"), api.listFolder(path, "video")]);
      if (seq !== openFolderSeq) return;
      const err = a.error || v.error;
      if (err) {
        dispatch({ type: "LOCAL_FOLDER_ERROR", error: err });
        return;
      }
      const merged = mergeFolderFiles([a.files, v.files]);
      dispatch({ type: "LOCAL_FILES_LOADED", files: merged });
    } catch {
      if (seq !== openFolderSeq) return;
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
      const merged = mergeFolderFiles([a.files, v.files]);
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

  const playAllFolders = async (mode) => {
    const dirs = state.localDirs || [];
    const all = [];
    for (const d of dirs) {
      try {
        const [a, v] = await Promise.all([api.listFolder(d.path, "audio"), api.listFolder(d.path, "video")]);
        if (a.error || v.error) continue;
        all.push(...mergeFolderFiles([a.files, v.files]));
      } catch { /* ignore unreadable folder */ }
    }
    if (all.length === 0) {
      dispatch({ type: "LOCAL_FOLDER_ERROR", error: "Aucun fichier audio ou vidéo trouvé." });
      return;
    }
    const first = all[0];
    dispatch({
      type: "PLAY_LOCAL",
      song: { id: first.path, title: first.name, channel: "Local", thumbnail: null, duration: 0 },
      path: first.path,
      playlist: all,
      ...modeFlags(mode),
    });
  };

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
    streamPlay,
    download,
    togglePause,
    setTor,
    scanFolders,
    openFolder,
    playFolder,
    playAllFolders,
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
