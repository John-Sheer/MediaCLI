import { useEffect, useRef, useState } from "react";
import { TitleBar } from "./components/TitleBar.jsx";
import { Footer } from "./components/Footer.jsx";
import { HomeHeader, HomeTabs } from "./components/HomeHeader.jsx";
import { StreamingView } from "./components/StreamingView.jsx";
import { LocalView } from "./components/LocalView.jsx";
import PlaylistsView from "./components/PlaylistsView.jsx";
import { AboutModal } from "./components/AboutModal.jsx";
import { VpnModal } from "./components/VpnModal.jsx";
import UpdateManager from "./components/UpdateManager.jsx";
import Player from "./components/Player.jsx";
import QueuePanel from "./components/QueuePanel.jsx";
import Settings from "./components/Settings.jsx";
import { Logo } from "./components/Logo.jsx";
import { useStore } from "./store/store.jsx";
import { useActions } from "./store/actions.js";
import { api } from "./api/client.js";
import { onThumbbarAction } from "./lib/thumbbar.js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { X } from "lucide-react";


export default function App() {
  const { state, dispatch } = useStore();
  const actions = useActions();
  const IS_ANDROID = /android/i.test(navigator.userAgent || "");
  const scrollRef = useRef(null);
  const [showQueue, setShowQueue] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);

  // Demande de confirmation de quitter l'application : reçue quand une
  // fermeture réelle est déclenchée (croix native Windows, "Quitter" du tray,
  // bouton X de la barre du haut, ou bouton retour Android). On affiche la
  // modale et on n'appelle quit_app qu'après accord de l'utilisateur.
  //
  // IMPORTANT (ANR Android) : avant d'afficher la modale on met la lecture en
  // pause. L'overlay de la modale est semi-transparent ; si la vidéo
  // continue de se dérouler plein écran derrière, Chromium doit recomposer
  // chaque frame (surtout avec un effet de flou), ce qui sature le processeur
  // de rendu et bloque le thread principal ("ne répond pas"). En mettant la
  // lecture en pause on libère le rendu et la modale reste fluide. Si
  // l'utilisateur annule, on reprend la lecture là où elle en était.
  const pausedMediaRef = useRef(null);

  const openQuitConfirm = () => {
    const media = document.querySelector("video, audio");
    if (media && !media.paused && typeof media.pause === "function") {
      try { media.pause(); pausedMediaRef.current = media; } catch {}
    }
    setShowQuitConfirm(true);
  };

  const closeQuitConfirm = () => {
    const media = pausedMediaRef.current;
    pausedMediaRef.current = null;
    setShowQuitConfirm(false);
    if (media && typeof media.play === "function") {
      try { media.play().catch(() => {}); } catch {}
    }
  };

  useEffect(() => {
    const onDomQuit = () => openQuitConfirm();
    window.addEventListener("quit-requested", onDomQuit);
    let unlisten;
    let cancelled = false;
    listen("quit-requested", () => {
      if (!cancelled) openQuitConfirm();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      window.removeEventListener("quit-requested", onDomQuit);
    };
  }, []);

  const confirmQuit = () => {
    pausedMediaRef.current = null;
    setShowQuitConfirm(false);
    invoke("quit_app").catch(() => {});
  };

  // Thumbbar: listen for previous/next from taskbar buttons / notification
  useEffect(() => {
    return onThumbbarAction((action) => {
      if (action === "previous") actions.playPrev();
      if (action === "next") actions.playNext();
      if (action === "stop") actions.stop();
    });
  }, [actions]);

  const handleScrollHover = (e) => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.classList.toggle("scroll-show", e.clientX > rect.right - 20);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onKey = (e) => {
      if (state.playerFullscreen) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;
      const playerEl = document.querySelector("[data-player-root]");
      if (playerEl && playerEl.contains(document.activeElement)) return;
      const hasPlayer = !!document.querySelector("video[src]");
      if (hasPlayer) return;
      if (e.key === "ArrowDown") { e.preventDefault(); el.scrollBy({ top: 60, behavior: "smooth" }); }
      else if (e.key === "ArrowUp") { e.preventDefault(); el.scrollBy({ top: -60, behavior: "smooth" }); }
      else if (e.key === "Home") { e.preventDefault(); el.scrollTo({ top: 0, behavior: "smooth" }); }
      else if (e.key === "End") { e.preventDefault(); el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state.playerFullscreen]);

  const [showTorMsg, setShowTorMsg] = useState(false);
  const torMsgTimer = useRef(null);

  useEffect(() => {
    if (state.torActive) {
      setShowTorMsg(true);
      if (torMsgTimer.current) clearTimeout(torMsgTimer.current);
      torMsgTimer.current = setTimeout(() => setShowTorMsg(false), 4000);
    } else {
      setShowTorMsg(false);
    }
    return () => { if (torMsgTimer.current) clearTimeout(torMsgTimer.current); };
  }, [state.torActive]);

  const runSearch = (query) => {
    actions.search(query);
  };

  const confirmVpn = async () => {
    dispatch({ type: "SET_VPN_MODAL", modal: null });
    if (!state.torActive) await actions.setTor(true);
  };

  const skipVpn = () => {
    dispatch({ type: "SET_VPN_MODAL", modal: null });
  };

  const handleVpnToggle = () => {
    if (state.torActive) {
      actions.setTor(false);
    } else {
      dispatch({ type: "SET_VPN_MODAL", modal: { type: "manual" } });
    }
  };

  const playStreaming = (song) => actions.play(song, state.results);

  const playLocalFile = (song, path) => actions.playLocal(song, path, state.localFiles);

  const handleAddToPlaylist = (id, track) => actions.addToPlaylist(id, track);

  const handleCreateAndAdd = (track) => {
    const name = window.prompt("Nom de la nouvelle playlist :", "Ma playlist");
    if (name === null) return;
    const finalName = name || "Ma playlist";
    const id = `pl_${Date.now()}`;
    dispatch({ type: "CREATE_PLAYLIST", name: finalName, id });
    setTimeout(() => {
      actions.addToPlaylist(id, track);
    }, 0);
  };

  const handleSaveQueue = (name, tracks) => actions.saveQueueAsPlaylist(name, tracks);

  const handleOpenDownloads = async () => {
    try {
      const { ok, data } = await api.openFolder("all");
      if (ok && IS_ANDROID && data?.path) {
        dispatch({ type: "SET_HOME_TAB", tab: "local" });
        actions.openFolder(data.path);
      }
    } catch {
      /* noop */
    }
  };

  const handlePlayPlaylist = (id, trackId) => {
    const pl = state.playlists[id];
    if (!pl || pl.tracks.length === 0) return;
    const start = trackId ? pl.tracks.findIndex((t) => t.id === trackId) : 0;
    const first = pl.tracks[start >= 0 ? start : 0];
    const isLocalTrack = first.channel === "Local";
    if (isLocalTrack) {
      actions.playLocal(first, first.id, pl.tracks);
    } else {
      actions.play(first, pl.tracks);
    }
  };

  const handleDeletePlaylist = (id) => actions.deletePlaylist(id);

  const handleRemoveFromPlaylist = (id, trackId) => actions.removeFromPlaylist(id, trackId);

  const switchTab = (tab) => dispatch({ type: "SET_HOME_TAB", tab });

  const homeIdle =
    (state.homeTab === "streaming" && state.results.length === 0 && !state.loading && !state.searchError) ||
    (state.homeTab === "local" && !state.localFolder) ||
    (state.homeTab === "playlists" && Object.keys(state.playlists).length === 0);

  return (
    <div className="h-screen flex flex-col bg-gradient-to-b from-bg via-[#07070d] to-bg">
      <div className="fixed -top-px left-0 right-0 h-px bg-bg z-[9999]" />
      <div className="fixed inset-0 bg-grain pointer-events-none" />
          {!state.playerFullscreen && <TitleBar onAbout={() => dispatch({ type: "TOGGLE_ABOUT", open: true })} onClose={openQuitConfirm} />}

      <div
        className={`${state.playerFullscreen ? "hidden" : "flex-1 min-h-0 flex flex-col"}`}
      >
        <div className="relative max-w-2xl w-full mx-auto px-5">
          {homeIdle && (
            <div className="pointer-events-none select-none fixed inset-0 flex items-center justify-center pt-16 opacity-[0.06] z-0">
              <Logo className="w-[200px] h-auto" />
            </div>
          )}
          <HomeHeader
            torActive={state.torActive}
            onToggleTor={handleVpnToggle}
            onAbout={() => dispatch({ type: "TOGGLE_ABOUT", open: true })}
          />
          <HomeTabs homeTab={state.homeTab} onSwitch={switchTab} playlistCount={Object.keys(state.playlists).length} />
        </div>

        <div
          ref={scrollRef}
          onMouseMove={handleScrollHover}
          onMouseLeave={() => scrollRef.current?.classList.remove("scroll-show")}
          className="flex-1 min-h-0 overflow-y-auto scroll-smooth scroll-modern"
        >
          <div className="relative max-w-2xl mx-auto px-5 pb-20 min-h-full">
            {showTorMsg && (
              <div className="absolute top-0 left-0 right-0 z-20 flex justify-center pt-2 animate-fade-in pointer-events-none">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-500/[0.10] text-[10px] text-yellow-400/90 whitespace-nowrap">
                  Tor actif — les recherches peuvent être plus lentes
                </div>
              </div>
            )}
            {state.homeTab === "streaming" && (
              <StreamingView
                state={state}
                onSearch={runSearch}
                onPlay={playStreaming}
                onDownload={actions.download}
                onTogglePause={actions.togglePause}
                onQueryChange={(q) => dispatch({ type: "SET_QUERY", query: q })}
                onMenuToggle={(id) => dispatch({ type: "SET_MENU_SONG", id })}
                onAddToPlaylist={handleAddToPlaylist}
                onCreateAndAdd={handleCreateAndAdd}
                onOpenDownloads={handleOpenDownloads}
                onAuthorize={() => api.requestPermissions()}
              />
            )}

            {state.homeTab === "local" && (
              <LocalView state={state} actions={actions} onPlayFile={playLocalFile} playlists={state.playlists} onAddToPlaylist={handleAddToPlaylist} onCreateAndAdd={handleCreateAndAdd} />
            )}

            {state.homeTab === "playlists" && (
              <PlaylistsView
                playlists={state.playlists}
                onPlay={handlePlayPlaylist}
                onDelete={handleDeletePlaylist}
                onRename={(id, name) => dispatch({ type: "RENAME_PLAYLIST", id, name })}
                onCreate={(name) => dispatch({ type: "CREATE_PLAYLIST", name })}
                localDirs={state.localDirs}
                onAddToPlaylist={handleAddToPlaylist}
              />
            )}

            <Footer onAbout={() => dispatch({ type: "TOGGLE_ABOUT", open: true })} onSettings={() => setShowSettings(true)} />
          </div>
        </div>
      </div>

      <Player
        currentSong={state.currentSong}
        streamUrl={state.streamUrl}
        onFullscreenChange={(v) => dispatch({ type: "SET_PLAYER_FULLSCREEN", value: v })}
        onClose={actions.stop}
        onNext={actions.playNext}
        onPrevious={actions.playPrev}
        onEnded={actions.playEnded}
        shuffle={state.shuffle}
        repeatMode={state.repeatMode}
        onToggleShuffle={() => dispatch({ type: "TOGGLE_SHUFFLE" })}
        onCycleRepeat={() => dispatch({ type: "CYCLE_REPEAT" })}
        playlist={state.playlist}
        onPlayAt={actions.playAt}
        playlists={state.playlists}
        onSaveQueue={handleSaveQueue}
        onPlayPlaylist={handlePlayPlaylist}
        onDeletePlaylist={handleDeletePlaylist}
        onRemoveFromPlaylist={handleRemoveFromPlaylist}
        showQueue={showQueue}
        onToggleQueue={() => setShowQueue(v => !v)}
        onDownload={actions.download}
      />

      <QueuePanel
        visible={showQueue}
        onClose={() => setShowQueue(false)}
        playlist={state.playlist}
        currentSong={state.currentSong}
        onPlayAt={actions.playAt}
        playlists={state.playlists}
        onSaveQueue={handleSaveQueue}
        onPlayPlaylist={handlePlayPlaylist}
        onDeletePlaylist={handleDeletePlaylist}
        onRemoveFromPlaylist={handleRemoveFromPlaylist}
      />

      {state.aboutOpen && <AboutModal onClose={() => dispatch({ type: "TOGGLE_ABOUT", open: false })} />}
      {state.vpnModal && (
        <VpnModal torActive={state.torActive} onConfirm={confirmVpn} onSkip={skipVpn} />
      )}
      <UpdateManager />
      {showSettings && <Settings open={showSettings} onClose={() => setShowSettings(false)} />}
      {showQuitConfirm && (
        <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-black/80 animate-fade-in">
          <div className="w-[min(20rem,calc(100vw-48px))] rounded-2xl bg-surface border border-white/10 p-5 shadow-2xl">
            <div className="flex justify-end -mt-1 -mr-1">
              <button onClick={closeQuitConfirm} className="p-1.5 rounded-lg hover:bg-white/[0.08] text-white/60 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-base font-semibold text-white text-center">Quitter MediaCLI ?</p>
            <p className="mt-1 text-[11px] text-white/70 text-center leading-snug">
              La lecture en cours sera arrêtée.
            </p>
            <div className="mt-5 flex gap-2.5">
              <button
                onClick={confirmQuit}
                className="flex-1 py-2.5 rounded-xl bg-accent-red text-white text-sm font-medium hover:bg-accent-red/90 transition-colors"
              >
                Quitter
              </button>
              <button
                onClick={closeQuitConfirm}
                className="flex-1 py-2.5 rounded-xl bg-white/[0.08] text-white/90 text-sm hover:bg-white/[0.14] transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
