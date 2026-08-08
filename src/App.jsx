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
import { Logo } from "./components/Logo.jsx";
import { useStore } from "./store/store.jsx";
import { useActions } from "./store/actions.js";
import { api } from "./api/client.js";
import { listen } from "@tauri-apps/api/event";


export default function App() {
  const { state, dispatch } = useStore();
  const actions = useActions();
  const IS_ANDROID = /android/i.test(navigator.userAgent || "");
  const scrollRef = useRef(null);
  const vpnPrompted = useRef(state.vpnPrompted);
  const [resumeTime, setResumeTime] = useState(0);
  const [showQueue, setShowQueue] = useState(false);
  const resumeApplied = useRef(false);

  // Reprise automatique de la dernière piste au démarrage
  useEffect(() => {
    try {
      const data = JSON.parse(localStorage.getItem("mediacli-resume") || "null");
      if (data && data.song && data.url && typeof data.song === "object" && typeof data.url === "string") {
        const isLocalResume = data.url.includes("/local?path=");
        if (isLocalResume) {
          const path = decodeURIComponent(data.url.split("path=")[1]);
          dispatch({ type: "PLAY_LOCAL", song: data.song, path, playlist: [] });
        } else {
          dispatch({ type: "PLAY", song: data.song, playlist: [] });
        }
        setResumeTime(data.time || 0);
      }
    } catch (err) {
      console.error("[resume] Erreur :", err);
      if (err instanceof SyntaxError) {
        localStorage.removeItem("mediacli-resume");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Réinitialiser resumeTime quand la piste change (pas au premier chargement)
  useEffect(() => {
    if (resumeApplied.current) {
      setResumeTime(0);
    } else {
      resumeApplied.current = true;
    }
  }, [state.streamUrl]);

  // Thumbbar: listen for previous/next from taskbar buttons
  useEffect(() => {
    const unlisten = listen("thumbbar-action", (e) => {
      if (e.payload === "previous") actions.playPrev();
      if (e.payload === "next") actions.playNext();
    });
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
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
    if (!vpnPrompted.current) {
      dispatch({ type: "SET_VPN_MODAL", modal: { type: "search" } });
      return;
    }
    actions.search(query);
  };

  const confirmVpn = async () => {
    dispatch({ type: "SET_VPN_MODAL", modal: null });
    if (!state.torActive) await actions.setTor(true);
    vpnPrompted.current = true;
    actions.search(state.query);
  };

  const skipVpn = () => {
    dispatch({ type: "SET_VPN_MODAL", modal: null });
    vpnPrompted.current = true;
    actions.search(state.query);
  };

  const playStreaming = (song) => actions.play(song, state.results);

  const playLocalFile = (song, path) => actions.playLocal(song, path, state.localFiles);

  const handleResume = (data) => {
    if (data?.url?.includes("/local?path=")) {
      const path = decodeURIComponent(data.url.split("path=")[1]);
      dispatch({ type: "PLAY_LOCAL", song: data.song, path, playlist: [] });
    } else {
      dispatch({ type: "PLAY", song: data.song, playlist: [] });
    }
    setResumeTime(data.time || 0);
  };

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
    actions.play(first, pl.tracks);
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
      {!state.playerFullscreen && <TitleBar onAbout={() => dispatch({ type: "TOGGLE_ABOUT", open: true })} />}

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
            onToggleTor={(on) => actions.setTor(on)}
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
                onQueryChange={(q) => dispatch({ type: "SET_QUERY", query: q })}
                onMenuToggle={(id) => dispatch({ type: "SET_MENU_SONG", id })}
                onAddToPlaylist={handleAddToPlaylist}
                onCreateAndAdd={handleCreateAndAdd}
                onOpenDownloads={handleOpenDownloads}
                onResume={handleResume}
              />
            )}

            {state.homeTab === "local" && (
              <LocalView state={state} actions={actions} onPlayFile={playLocalFile} />
            )}

            {state.homeTab === "playlists" && (
              <PlaylistsView
                playlists={state.playlists}
                onPlay={handlePlayPlaylist}
                onDelete={handleDeletePlaylist}
                onCreate={() => {
                  const name = window.prompt("Nom de la nouvelle playlist :", "Ma playlist");
                  if (name !== null) dispatch({ type: "CREATE_PLAYLIST", name: name || "Ma playlist" });
                }}
              />
            )}

            <Footer onAbout={() => dispatch({ type: "TOGGLE_ABOUT", open: true })} />
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
        resumeTime={resumeTime}
        playlists={state.playlists}
        onSaveQueue={handleSaveQueue}
        onPlayPlaylist={handlePlayPlaylist}
        onDeletePlaylist={handleDeletePlaylist}
        onRemoveFromPlaylist={handleRemoveFromPlaylist}
        showQueue={showQueue}
        onToggleQueue={() => setShowQueue(v => !v)}
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
      {!IS_ANDROID && <UpdateManager />}
    </div>
  );
}
