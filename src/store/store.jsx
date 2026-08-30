import { createContext, useContext, useReducer, useEffect, useRef } from "react";
import { api, friendlyError, SERVER_UNREACHABLE } from "../api/client.js";
import { invoke } from "@tauri-apps/api/core";

const initialState = {
  homeTab: "streaming",
  aboutOpen: false,
  vpnModal: null,
  playerFullscreen: false,
  error: null,

  // recherche streaming
  query: "",
  results: [],
  loading: false,
  searchError: null,
  menuSongId: null,

  // lecture
  currentSong: null,
  streamUrl: null,
  isLocal: false,
  playlist: [],
  shuffle: false,
  repeatMode: "off",
  torActive: false,
  progress: 0,

  // bibliothèque locale
  localDirs: [],
  localScanning: false,
  localError: null,
  localFolder: "",
  localFiles: [],
  localFolderError: null,
  localFolderLoading: false,

  // téléchargements
  downloadStatus: {},
  downloadProgress: {},
  downloadPaused: {},
  downloadErrors: {},

  // playlists sauvegardées
  playlists: {},
};

const PLAYLISTS_KEY = "mediacli-playlists";
function loadPlaylists() {
  try {
    const raw = localStorage.getItem(PLAYLISTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function persistPlaylists(p) {
  try { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(p)); } catch {}
}

function cycleRepeat(mode) {
  return mode === "off" ? "all" : mode === "all" ? "one" : "off";
}

function nextIndex(playlist, currentId, isLocal, shuffle, repeatMode) {
  if (playlist.length === 0) return -1;
  if (shuffle && playlist.length > 1) {
    let r;
    let attempts = 0;
    do {
      r = Math.floor(Math.random() * playlist.length);
      attempts++;
    } while (playlist[r] && (isLocal ? (playlist[r].path || playlist[r].id) : playlist[r].id) === currentId && attempts < playlist.length);
    return r;
  }
  const idx = playlist.findIndex((s) => (isLocal ? (s.path || s.id) : s.id) === currentId);
  if (idx === -1) return 0;
  if (idx < playlist.length - 1) return idx + 1;
  if (repeatMode === "all") return 0;
  return -1;
}

function prevIndex(playlist, currentId, isLocal, repeatMode) {
  if (playlist.length === 0) return -1;
  const idx = playlist.findIndex((s) => (isLocal ? (s.path || s.id) : s.id) === currentId);
  if (idx === -1) return 0;
  if (idx > 0) return idx - 1;
  if (repeatMode === "all") return playlist.length - 1;
  return -1;
}

function reducer(state, action) {
  switch (action.type) {
    case "SET_HOME_TAB":
      return { ...state, homeTab: action.tab };

    case "TOGGLE_ABOUT":
      return { ...state, aboutOpen: action.open };

    case "SET_VPN_MODAL":
      return { ...state, vpnModal: action.modal };

    case "SET_PLAYER_FULLSCREEN":
      return { ...state, playerFullscreen: action.value };

    case "SET_ERROR":
      return { ...state, error: action.error };

    case "SET_QUERY":
      return {
        ...state,
        query: action.query,
        ...(action.query.trim() === "" ? { results: [], searchError: null } : {}),
      };

    case "SEARCH_START":
      return { ...state, loading: true, searchError: null, results: [] };

    case "SEARCH_SUCCESS":
      return { ...state, loading: false, results: action.results };

    case "SEARCH_ERROR":
      return { ...state, loading: false, searchError: action.error };

    case "SET_MENU_SONG":
      return { ...state, menuSongId: action.id };

    case "PLAY":
      return {
        ...state,
        isLocal: false,
        currentSong: action.song,
        playlist: action.playlist ?? state.playlist,
        streamUrl: `${api.base}/${state.torActive ? "stream-tor" : "stream"}?id=${encodeURIComponent(action.song.id)}`,
      };

    case "PLAY_LOCAL":
      return {
        ...state,
        isLocal: true,
        currentSong: action.song,
        playlist: action.playlist ?? state.playlist,
        streamUrl: `${api.base}/local?path=${encodeURIComponent(action.path)}`,
      };

    case "PLAY_AT": {
      const item = state.playlist[action.index];
      if (!item) return state;
      if (state.isLocal) {
        const path = item.path || item.id;
        return {
          ...state,
          currentSong: { id: path, title: item.title || item.name, channel: "Local", thumbnail: null, duration: 0 },
          streamUrl: `${api.base}/local?path=${encodeURIComponent(path)}`,
        };
      }
      return {
        ...state,
        currentSong: item,
        streamUrl: `${api.base}/${state.torActive ? "stream-tor" : "stream"}?id=${encodeURIComponent(item.id)}`,
      };
    }

    case "PLAY_NEXT": {
      const idx = nextIndex(state.playlist, state.currentSong?.id, state.isLocal, state.shuffle, state.repeatMode);
      if (idx === -1) return state;
      return reducer(state, { type: "PLAY_AT", index: idx });
    }

    case "PLAY_PREV": {
      const idx = prevIndex(state.playlist, state.currentSong?.id, state.isLocal, state.repeatMode);
      if (idx === -1) return state;
      return reducer(state, { type: "PLAY_AT", index: idx });
    }

    case "PLAY_ENDED": {
      if (state.repeatMode === "one") return reducer(state, { type: "PLAY_AT", index: state.playlist.findIndex((s) => (state.isLocal ? (s.path || s.id) : s.id) === state.currentSong?.id) });
      return reducer(state, { type: "PLAY_NEXT" });
    }

    case "STOP_PLAYBACK":
      return { ...state, currentSong: null, streamUrl: null };

    case "TOGGLE_SHUFFLE":
      return { ...state, shuffle: !state.shuffle };

    case "CYCLE_REPEAT":
      return { ...state, repeatMode: cycleRepeat(state.repeatMode) };

    case "SET_TOR": {
      const next = { ...state, torActive: action.on };
      if (state.currentSong && !state.isLocal) {
        next.streamUrl = `${api.base}/${action.on ? "stream-tor" : "stream"}?id=${encodeURIComponent(state.currentSong.id)}`;
      }
      return next;
    }

    case "LOCAL_SCAN_START":
      return { ...state, localScanning: true, localError: null };

    case "LOCAL_SCAN_PROGRESS": {
      if (state.localDirs.some((d) => d.path === action.folder.path)) return state;
      return { ...state, localDirs: [...state.localDirs, action.folder] };
    }

    case "LOCAL_SCAN_SUCCESS":
      return { ...state, localScanning: false, localDirs: action.folders };

    case "LOCAL_SCAN_ERROR":
      return { ...state, localScanning: false, localError: action.error };

    case "LOCAL_OPEN_FOLDER":
      return { ...state, localFolder: action.path, localFiles: [], localFolderError: null, localFolderLoading: true };

    case "LOCAL_FILES_LOADED":
      return { ...state, localFiles: action.files, localFolderLoading: false };

    case "LOCAL_FOLDER_ERROR":
      return { ...state, localFolderError: action.error, localFolderLoading: false };

    case "LOCAL_RESET_FOLDER":
      return { ...state, localFolder: "", localFiles: [], localFolderError: null };

    case "DOWNLOAD_STATUS":
      return { ...state, downloadStatus: { ...state.downloadStatus, [action.key]: action.status } };

    case "DOWNLOAD_PROGRESS":
      return { ...state, downloadProgress: { ...state.downloadProgress, [action.key]: action.progress } };

    case "DOWNLOAD_PAUSED":
      return { ...state, downloadPaused: { ...state.downloadPaused, [action.key]: action.paused } };

    case "DOWNLOAD_ERROR":
      return { ...state, downloadErrors: { ...state.downloadErrors, [action.key]: action.info } };

    case "CREATE_PLAYLIST": {
      const id = action.id || `pl_${Date.now()}`;
      const next = { ...state.playlists, [id]: { id, name: action.name || "Nouvelle playlist", tracks: [] } };
      persistPlaylists(next);
      return { ...state, playlists: next };
    }

    case "RENAME_PLAYLIST": {
      const pl = state.playlists[action.id];
      if (!pl) return state;
      const next = { ...state.playlists, [action.id]: { ...pl, name: action.name } };
      persistPlaylists(next);
      return { ...state, playlists: next };
    }

    case "DELETE_PLAYLIST": {
      const next = { ...state.playlists };
      delete next[action.id];
      persistPlaylists(next);
      return { ...state, playlists: next };
    }

    case "ADD_TO_PLAYLIST": {
      const pl = state.playlists[action.id];
      if (!pl) return state;
      const exists = pl.tracks.some((t) => t.id === action.track.id);
      if (exists) return state;
      const next = { ...state.playlists, [action.id]: { ...pl, tracks: [...pl.tracks, action.track] } };
      persistPlaylists(next);
      return { ...state, playlists: next };
    }

    case "REMOVE_FROM_PLAYLIST": {
      const pl = state.playlists[action.id];
      if (!pl) return state;
      const next = { ...state.playlists, [action.id]: { ...pl, tracks: pl.tracks.filter((t) => t.id !== action.trackId) } };
      persistPlaylists(next);
      return { ...state, playlists: next };
    }

    case "SAVE_QUEUE_AS_PLAYLIST": {
      const id = `pl_${Date.now()}`;
      const next = { ...state.playlists, [id]: { id, name: action.name || "File d'attente", tracks: action.tracks || [] } };
      persistPlaylists(next);
      return { ...state, playlists: next };
    }

    default:
      return state;
  }
}

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => ({ ...init, playlists: loadPlaylists() }));

  // progression des téléchargements (polling)
  useEffect(() => {
    const active = Object.entries(state.downloadStatus).filter(([, s]) => s === "downloading");
    if (active.length === 0) return;
    const interval = setInterval(async () => {
      for (const [key] of active) {
        try {
          const data = await api.progress(key);
          if (data) {
            dispatch({ type: "DOWNLOAD_PROGRESS", key, progress: data.progress });
            if (typeof data.paused === "boolean") dispatch({ type: "DOWNLOAD_PAUSED", key, paused: data.paused });
          }
        } catch {
          /* noop */
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [state.downloadStatus]);

  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore doit être utilisé dans <StoreProvider>");
  return ctx;
}
