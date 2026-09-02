import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Play, Pause, SkipBack, SkipForward, X, Maximize2, Minimize2, Loader2, RefreshCw, Volume2, VolumeX, Shuffle, Repeat, Repeat1, Music, ListMusic, Timer, Mic, Forward, Rewind, Download, EyeOff } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { onThumbbarAction } from "../lib/thumbbar.js";
import useSwipeGesture from "../hooks/useSwipeGesture";

const IS_ANDROID = /android/i.test(navigator.userAgent || "");

function VolumeControl({ volume, onMute, onVolume, showVolume, showVolumeNow, showVolumeWithDelay, hideVolumeWithDelay, size = 14, sliderH = 22 }) {
  const toggle = (e) => {
    e?.stopPropagation();
    if (showVolume) hideVolumeWithDelay();
    else if (showVolumeNow) showVolumeNow();
    else showVolumeWithDelay();
  };
  const volPct = Math.round((volume ?? 0) * 100);
  return (
    <div className="relative" onMouseEnter={showVolumeWithDelay} onMouseLeave={hideVolumeWithDelay}>
      <button
        onClick={toggle}
        className="bg-black/60 backdrop-blur-sm rounded-full p-1.5 text-white/85 hover:text-white transition-colors"
        title="Volume"
      >
        {volume === 0 ? <VolumeX size={size} /> : <Volume2 size={size} />}
      </button>
      {showVolume && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 pb-1 z-50"
          onMouseEnter={showVolumeWithDelay}
          onMouseLeave={hideVolumeWithDelay}
        >
          <div className="bg-black/70 backdrop-blur-md rounded-xl px-2.5 py-2 shadow-xl ring-1 ring-white/[0.08] flex flex-col items-center gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); onMute && onMute(); }}
              className="text-white/85 hover:text-white shrink-0"
              title={volume === 0 ? "Activer le son" : "Couper le son"}
            >
              {volume === 0 ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
            <div className="w-full flex justify-center py-0.5">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onInput={onVolume}
                onMouseDown={(e) => e.stopPropagation()}
                className="vol-line cursor-pointer touch-none"
                style={{
                  writingMode: "vertical-lr",
                  direction: "rtl",
                  height: `${sliderH * 4}px`,
                  background: 'rgba(255,255,255,0.14)',
                }}
              />
            </div>
            <span className="text-[9px] font-mono text-white/85 leading-none tabular-nums">{volPct}%</span>
          </div>
        </div>
      )}
    </div>
  );
}


export default function Player({ currentSong, streamUrl, onClose, onNext, onPrevious, onEnded, shuffle, repeatMode, onToggleShuffle, onCycleRepeat, onFullscreenChange, playlist = [], onPlayAt, resumeTime = 0, playlists = {}, onSaveQueue, onPlayPlaylist, onDeletePlaylist, onRemoveFromPlaylist, showQueue = false, onToggleQueue, onDownload, revealSignal = 0 }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const rafRef = useRef(null);
  const lastVolumeRef = useRef(0.4);
  const lastSaveRef = useRef(0);
  const lastBgPushRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [streamError, setStreamError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [showFsControls, setShowFsControls] = useState(true);

  const [hasVideo, setHasVideo] = useState(false);
  const canFsRef = useRef(false);
  useEffect(() => { canFsRef.current = hasVideo; }, [hasVideo]);

  useEffect(() => {
    if (revealSignal > 0) {
      setHidden(false);
      showControlsTempRef.current?.();
    }
  }, [revealSignal]);
  const [lyrics, setLyrics] = useState(null);
  const [lyricLines, setLyricLines] = useState([]);
  const fsTimer = useRef(null);
  const [hoverTime, setHoverTime] = useState(0);
  const [hoverPct, setHoverPct] = useState(0);
  const [showHoverTime, setShowHoverTime] = useState(false);
  const [volume, setVolume] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem("mediacli-settings") || "{}");
      return s.defaultVolume ?? 0.4;
    } catch { return 0.4; }
  });
  const [videoMuted, setVideoMuted] = useState(true);
  const [showVolume, setShowVolume] = useState(false);
  const [showVolPct, setShowVolPct] = useState(false);
  const volPctTimer = useRef(null);
  const volumeTimerRef = useRef(null);
  const loadTimerRef = useRef(null);
  const seekRef = useRef(null);
  const resumePosRef = useRef(0);
  const pausePosRef = useRef(0);
  const userPauseRef = useRef(false);
  const currentSongRef = useRef(currentSong);
  useEffect(() => { currentSongRef.current = currentSong; }, [currentSong]);
  const playingRef = useRef(playing);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  const [pos, setPos] = useState(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 640) return { x: (w - Math.min(384, w - 24)) / 2, y: Math.max(12, h - 380) };
    return { x: w - 400, y: Math.max(20, h - 340) };
  });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const sleepTimerRef = useRef(null);
  const sleepEndRef = useRef(0);
  const [showSleep, setShowSleep] = useState(false);
  const playerEl = useRef(null);
  const audioCtxRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const eqNodesRef = useRef(null);
  const audioGraphBuiltRef = useRef(false);
  const [eqOpen, setEqOpen] = useState(false);
  const [bass, setBass] = useState(() => {
    try { const r = JSON.parse(localStorage.getItem("mediacli-eq")); return r?.bass ?? 0; } catch { return 0; }
  });
  const [mid, setMid] = useState(() => {
    try { const r = JSON.parse(localStorage.getItem("mediacli-eq")); return r?.mid ?? 0; } catch { return 0; }
  });
  const [treble, setTreble] = useState(() => {
    try { const r = JSON.parse(localStorage.getItem("mediacli-eq")); return r?.treble ?? 0; } catch { return 0; }
  });
  const [pitch, setPitch] = useState(() => {
    try { const r = JSON.parse(localStorage.getItem("mediacli-eq")); return r?.pitch ?? 1; } catch { return 1; }
  });
  const [eqPreset, setEqPreset] = useState(() => {
    try { const r = JSON.parse(localStorage.getItem("mediacli-eq")); return r?.preset ?? "Flat"; } catch { return "Flat"; }
  });

  const [showLyrics, setShowLyrics] = useState(true);
  const [showFsPlaylist, setShowFsPlaylist] = useState(false);
  const [customSleep, setCustomSleep] = useState("");
  const [showControls, setShowControls] = useState(true);
  const controlsTimer = useRef(null);
  const showControlsTempRef = useRef(null); // référence stable pour éviter le TDZ dans swipeHandlers
  const [swipeFeedback, setSwipeFeedback] = useState(null);
  const swipeFeedbackTimer = useRef(null);
  const pillRef = useRef(null);
  const pillSwipe = useRef(null);
  const pillSuppressClick = useRef(false);
  const autoCollapseTimerRef = useRef(null);
  const EQ_PRESETS = {
    "Flat":      { bass: 0,   mid: 0,   treble: 0 },
    "Rock":      { bass: 5,   mid: -1,  treble: 4 },
    "Pop":       { bass: -1,  mid: 2.5, treble: 1 },
    "Jazz":      { bass: 3,   mid: 0,   treble: 3 },
    "Classique": { bass: 2,   mid: -2,  treble: 4 },
    "Bass+":     { bass: 8,   mid: -2,  treble: 0 },
  };

  useEffect(() => {
    try {
      localStorage.setItem("mediacli-eq", JSON.stringify({ bass, mid, treble, pitch, preset: eqPreset }));
    } catch {}
  }, [bass, mid, treble, pitch, eqPreset]);

  const setupAudioGraph = () => {
    try {
      const el = videoRef.current;
      if (!el || audioGraphBuiltRef.current) return;
      // Sur Android WebView, router l'élément via MediaElementSource fait perdre
      // le son après une pause (bug Chromium non corrigé). On joue directement :
      // pause/reprise d'un élément <video> classique est fiable sur Android.
      if (IS_ANDROID) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      // Un SEUL AudioContext pour toute l'app : sur Android WebView, un contexte
      // créé hors geste utilisateur démarre "suspended" et avale le son (muet).
      // On réutilise le contexte existant (déjà running) et on n'attache qu'un
      // nouveau MediaElementSource sur l'élément (neuf après remount).
      const ctx = audioCtxRef.current || new Ctx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaElementSource(el);
      const bassNode = ctx.createBiquadFilter();
      bassNode.type = "lowshelf";
      bassNode.frequency.value = 200;
      const midNode = ctx.createBiquadFilter();
      midNode.type = "peaking";
      midNode.frequency.value = 1000;
      midNode.Q.value = 1;
      const trebleNode = ctx.createBiquadFilter();
      trebleNode.type = "highshelf";
      trebleNode.frequency.value = 4000;
      source.connect(bassNode);
      bassNode.connect(midNode);
      midNode.connect(trebleNode);
      trebleNode.connect(ctx.destination);
      audioCtxRef.current = ctx;
      sourceNodeRef.current = source;
      eqNodesRef.current = { bass: bassNode, mid: midNode, treble: trebleNode };
      audioGraphBuiltRef.current = true;
      applyEq();
      const resume = () => { if (ctx.state === "suspended") ctx.resume().catch(() => {}); };
      el.addEventListener("play", resume);
      el.addEventListener("playing", resume);
      document.addEventListener("touchstart", resume, { once: true });
      document.addEventListener("pointerdown", resume, { once: true });
    } catch (err) {
      console.error("[eq] setup failed:", err);
    }
  };

  const applyEq = () => {
    const nodes = eqNodesRef.current;
    if (!nodes) return;
    try {
      if (nodes.bass) nodes.bass.gain.value = bass;
      if (nodes.mid) nodes.mid.gain.value = mid;
      if (nodes.treble) nodes.treble.gain.value = treble;
    } catch {}
  };

  useEffect(() => {
    if (eqOpen) setupAudioGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eqOpen]);

  useEffect(() => { applyEq(); }, [bass, mid, treble]);

  const applyPreset = (name) => {
    setEqPreset(name);
    const p = EQ_PRESETS[name];
    if (p) { setBass(p.bass); setMid(p.mid); setTreble(p.treble); }
  };

  useEffect(() => {
    const p = EQ_PRESETS[eqPreset];
    if (p && (bass !== p.bass || mid !== p.mid || treble !== p.treble)) {
      setEqPreset("Flat");
    }
  }, [bass, mid, treble]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = pitch;
  }, [pitch]);

  const handleSeekHover = (e) => {
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    setHoverPct(pct);
    setHoverTime(pct * (duration || 0));
    setShowHoverTime(true);
  };

  const handleSeekLeave = () => setShowHoverTime(false);

  const [sleepTick, setSleepTick] = useState(0);
  const startSleepTimer = (mins) => {
    if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
    if (mins <= 0) { setSleepMinutes(0); sleepEndRef.current = 0; setShowSleep(false); return; }
    sleepEndRef.current = Date.now() + mins * 60000;
    setSleepMinutes(mins);
    setShowSleep(false);
    sleepTimerRef.current = setInterval(() => {
      if (Date.now() >= sleepEndRef.current) {
        clearInterval(sleepTimerRef.current);
        sleepTimerRef.current = null;
        setSleepMinutes(0);
        sleepEndRef.current = 0;
        if (videoRef.current && !videoRef.current.paused) {
          // VRAIE pause (la vidéo se fige) à l'arrivée du minuteur sommeil.
          userPauseRef.current = true;
          pausePosRef.current = videoRef.current.currentTime || 0;
          videoRef.current.pause();
          setPlaying(false);
        }
      } else {
        setSleepTick((t) => t + 1);
      }
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (sleepTimerRef.current) { clearInterval(sleepTimerRef.current); sleepTimerRef.current = null; }
      if (fsTimer.current) { clearTimeout(fsTimer.current); fsTimer.current = null; }
      if (controlsTimer.current) { clearTimeout(controlsTimer.current); controlsTimer.current = null; }
      if (loadTimerRef.current) { clearTimeout(loadTimerRef.current); loadTimerRef.current = null; }
      if (volPctTimer.current) { clearTimeout(volPctTimer.current); volPctTimer.current = null; }
    };
  }, []);

  const sleepRemaining = () => {
    if (!sleepEndRef.current) return 0;
    return Math.max(0, Math.ceil((sleepEndRef.current - Date.now()) / 1000));
  };

  const clearLoadTimer = () => {
    if (loadTimerRef.current) { clearTimeout(loadTimerRef.current); loadTimerRef.current = null; }
  };

  useEffect(() => {
    if (streamUrl) {
      pausePosRef.current = 0;
      setBuffering(true);
      setStreamError(null);
      setProgress(0);
      setDuration(0);
      clearLoadTimer();
      setPlaying(false);
      loadTimerRef.current = setTimeout(() => setStreamError("Le flux met trop de temps à répondre."), 90000);
      return () => clearLoadTimer();
    }
    if (!streamUrl && videoRef.current) {
      userPauseRef.current = true;
      videoRef.current.pause();
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
      setPlaying(false);
      setBuffering(false);
      setStreamError(null);
      setProgress(0);
      setDuration(0);
    }
  }, [streamUrl]);

  // Comportement lecture : une VIDEO ouvre le lecteur normal puis se réduit en
  // pillule (pour montrer qu'on écoute une video) ; un AUDIO reste en pillule
  // seule, sans jamais ouvrir le lecteur complet.
  const AUDIO_ONLY_RE = /\.(mp3|m4a|flac|ogg|oga|opus|wav|aac)$/i;
  const VIDEO_RE = /\.(mp4|mkv|mov|webm)$/i;
  const autoOpenRef = useRef(false);
  const collapseTimerRef = useRef(null);

  useEffect(() => {
    setHasVideo(false);
    canFsRef.current = false;
    clearTimeout(collapseTimerRef.current);
    autoOpenRef.current = false;
    if (!currentSong || !streamUrl) return;

    const isLocal = streamUrl.includes("/local?path=");
    const title = currentSong.title || "";
    const path = currentSong.path || "";
    const urlPath = isLocal ? decodeURIComponent((streamUrl.split("path=")[1] || "").split("&")[0]) : "";
    const isAudioFile = AUDIO_ONLY_RE.test(title) || AUDIO_ONLY_RE.test(path) || AUDIO_ONLY_RE.test(urlPath);
    const isVideoFile = VIDEO_RE.test(title) || VIDEO_RE.test(path) || VIDEO_RE.test(urlPath);

    if (isAudioFile || (isLocal && !isVideoFile)) {
      // audio local : pillule seule, jamais le lecteur complet.
      setHidden(true);
      return;
    }

    if (isLocal && isVideoFile) {
      // video locale : ouvre le lecteur puis le replie en pillule (on montre qu'on ecoute une video).
      autoOpenRef.current = true;
      setHidden(false);
      showControlsTempRef.current?.();
      collapseTimerRef.current = setTimeout(() => {
        if (!autoOpenRef.current) return;
        setHidden(true);
      }, 3200);
      return () => clearTimeout(collapseTimerRef.current);
    }

    // Source non locale (streaming / video internet) : on ne connait pas encore
    // le type. Ne JAMAIS ouvrir le lecteur par avance, sinon un flux audio
    // affiche un flash de lecteur normal. La decision est prise dans
    // onLoadedMetadata via e.target.videoWidth.
    autoOpenRef.current = true;
    return () => clearTimeout(collapseTimerRef.current);
  }, [currentSong?.id, streamUrl]);

  useEffect(() => {
    return () => {
      userPauseRef.current = true;
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute("src");
        videoRef.current.load();
      }
    };
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (!IS_ANDROID && document.visibilityState === "hidden" && videoRef.current && !videoRef.current.paused) {
        userPauseRef.current = true;
        pausePosRef.current = videoRef.current.currentTime || 0;
        videoRef.current.pause();
        setPlaying(false);
        setBuffering(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Android WebView : rejoue un court échantillon audio HTML5 silencieux pour
  // forcer la ré-acquisition du focus audio (sinon l'audio ressort muet après
  // une pause). Workaround officiel recommandé pour WebView + WebAudio.
  const kickAudioFocus = () => {
    try {
      const el = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAADAAAAAAA==");
      el.volume = 0.0001;
      const t = el.play();
      if (t && t.catch) t.catch(() => {});
      window.setTimeout(() => { try { el.pause(); el.src = ""; } catch {} }, 500);
    } catch {}
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (streamError) {
      setStreamError(null);
      setBuffering(true);
      videoRef.current.load();
      videoRef.current.volume = volume;
      videoRef.current.muted = true;
      videoRef.current.play()
        .then(() => { setVideoMuted(false); setPlaying(true); })
        .catch(() => setBuffering(false));
      return;
    }
    if (playing) {
      // VRAIE pause : la vidéo se fige, le son s'arrête avec elle.
      const v = videoRef.current;
      userPauseRef.current = true;
      pausePosRef.current = v.currentTime || 0;
      v.pause();
      setPlaying(false);
      return;
    }
    const v = videoRef.current;
    setBuffering(true);
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    kickAudioFocus();
    userPauseRef.current = false;
    if (v.paused || v.ended || !v.src) {
      // Tentative 1 : simple play() — fiable sur la plupart des appareils,
      // ne provoque pas d'interruption/rechargement du flux.
      v.muted = false;
      const promise = v.play();
      if (promise && promise.then) {
        promise
          .then(() => { setVideoMuted(false); setPlaying(true); setBuffering(false); })
          .catch(() => {
            // Tentative 2 (fallback Android WebView) : reload + seek + play.
            resumePosRef.current = pausePosRef.current || (v.currentTime || 0);
            pausePosRef.current = 0;
            v.muted = true;
            v.load();
          });
      } else {
        setVideoMuted(false);
        setPlaying(true);
        setBuffering(false);
      }
      return;
    }
    // Cas rare : l'élément est encore en lecture → simple dé-mute.
    v.muted = false;
    setVideoMuted(false);
    setPlaying(true);
    setBuffering(false);
  };

  const handleSeek = (e) => {
    const val = Number(e.target.value);
    if (videoRef.current) videoRef.current.currentTime = val;
    setProgress(val);
  };

  const flashVolumePct = () => {
    setShowVolPct(true);
    if (volPctTimer.current) clearTimeout(volPctTimer.current);
    volPctTimer.current = setTimeout(() => setShowVolPct(false), 800);
  };

  const showSwipeFeedback = (icon, label) => {
    setSwipeFeedback({ icon, label });
    if (swipeFeedbackTimer.current) clearTimeout(swipeFeedbackTimer.current);
    swipeFeedbackTimer.current = setTimeout(() => setSwipeFeedback(null), 700);
  };

  const swipeHandlers = useSwipeGesture({
    onSwipeRight: () => {
      if (!videoRef.current?.src) return;
      const newProgress = Math.min(duration || 0, progress + 10);
      handleSeekRef.current({ target: { value: newProgress } });
      showSwipeFeedback(Forward, `+10s`);
    },
    onSwipeLeft: () => {
      if (!videoRef.current?.src) return;
      const newProgress = Math.max(0, progress - 10);
      handleSeekRef.current({ target: { value: newProgress } });
      showSwipeFeedback(Rewind, `-10s`);
    },
    onSwipeUp: () => {
      if (!videoRef.current?.src) return;
      const newVol = Math.min(1, volume + 0.08);
      handleVolumeRef.current({ target: { value: newVol } });
      flashVolumePct();
      showSwipeFeedback(Volume2, `${Math.round(newVol * 100)}%`);
    },
    onSwipeDown: () => {
      if (!videoRef.current?.src) return;
      const newVol = Math.max(0, volume - 0.08);
      handleVolumeRef.current({ target: { value: newVol } });
      flashVolumePct();
      showSwipeFeedback(Volume2, `${Math.round(newVol * 100)}%`);
    },
    onTap: () => {
      // Le tap affiche ou masque les commandes, rien d'autre (pas de pause/lecture).
      if (showControls) {
        setShowControls(false);
        if (controlsTimer.current) clearTimeout(controlsTimer.current);
      } else {
        showControlsTempRef.current?.();
      }
    },
    onDoubleTap: () => {
      if (canFsRef.current) setFullscreen((f) => !f);
    },
  });

  const handleVolume = (e) => {
    const v = Number(e.target.value);
    setVolume(v);
    if (v > 0) lastVolumeRef.current = v;
    if (videoRef.current) { videoRef.current.volume = v; setVideoMuted(v === 0); }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    if (volume === 0) {
      const v = lastVolumeRef.current || 0.4;
      setVolume(v);
      videoRef.current.volume = v;
      setVideoMuted(false);
    } else {
      lastVolumeRef.current = volume > 0 ? volume : lastVolumeRef.current;
      setVolume(0);
      videoRef.current.volume = 0;
      setVideoMuted(true);
    }
  };

  const togglePlayRef = useRef(togglePlay);
  const handleSeekRef = useRef(handleSeek);
  const handleVolumeRef = useRef(handleVolume);
  const toggleMuteRef = useRef(toggleMute);
  const fullscreenRef = useRef(fullscreen);
  const fsOrientationRef = useRef(false);
  const onNextRef = useRef(onNext);
  const onPreviousRef = useRef(onPrevious);
  const onCloseRef = useRef(onClose);
  const onEndedRef = useRef(onEnded);

  useEffect(() => { togglePlayRef.current = togglePlay; }, [togglePlay]);
  useEffect(() => { handleSeekRef.current = handleSeek; }, [handleSeek]);
  useEffect(() => { handleVolumeRef.current = handleVolume; }, [handleVolume]);
  useEffect(() => { toggleMuteRef.current = toggleMute; }, [toggleMute]);
  useEffect(() => { fullscreenRef.current = fullscreen; }, [fullscreen]);
  useEffect(() => { onNextRef.current = onNext; }, [onNext]);
  useEffect(() => { onPreviousRef.current = onPrevious; }, [onPrevious]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { onEndedRef.current = onEnded; }, [onEnded]);

  const requestExit = (e) => {
    e?.stopPropagation();
    setConfirmExit(true);
  };
  const confirmExitNow = () => {
    setConfirmExit(false);
    onCloseRef.current?.();
  };

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;

      const playerActive = !!videoRef.current?.src;
      const focusedInPlayer = playerRef.current?.contains(document.activeElement) || fullscreenRef.current;
      const canVolume = playerActive;

      switch (e.key) {
        case " ":
        case "k":
          if (!videoRef.current?.src) return;
          e.preventDefault();
          togglePlayRef.current();
          break;
        case "ArrowRight":
          if (!focusedInPlayer) return;
          e.preventDefault();
          if (videoRef.current) handleSeekRef.current({ target: { value: Math.min((duration || 0), progress + 5) } });
          break;
        case "ArrowLeft":
          if (!focusedInPlayer) return;
          e.preventDefault();
          if (videoRef.current) handleSeekRef.current({ target: { value: Math.max(0, progress - 5) } });
          break;
        case "ArrowUp":
          if (!canVolume) return;
          e.preventDefault();
          handleVolumeRef.current({ target: { value: Math.min(1, volume + 0.05) } });
          flashVolumePct();
          break;
        case "ArrowDown":
          if (!canVolume) return;
          e.preventDefault();
          handleVolumeRef.current({ target: { value: Math.max(0, volume - 0.05) } });
          flashVolumePct();
          break;
        case "f":
          if (canFsRef.current) setFullscreen((f) => !f);
          break;
        case "m":
          toggleMuteRef.current();
          break;
        case "n":
          onNext && onNext();
          break;
        case "p":
          onPrevious && onPrevious();
          break;
        case "q":
          onToggleQueue && onToggleQueue();
          break;
        case "l":
          if (fullscreenRef.current) fetchLyrics(currentSong?.title, currentSong?.channel);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duration, progress, volume, currentSong, onNext, onPrevious, onToggleQueue]);

  const showVolumeWithDelay = () => {
    if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
    if (showVolPct) return;
    volumeTimerRef.current = setTimeout(() => setShowVolume(true), 700);
  };

  const hideVolumeWithDelay = () => {
    volumeTimerRef.current = setTimeout(() => setShowVolume(false), 250);
  };

  const handleSeekStart = () => setIsSeeking(true);
  const handleSeekEnd = (e) => {
    const val = Number(e.target.value);
    if (videoRef.current) videoRef.current.currentTime = val;
    setProgress(val);
    setIsSeeking(false);
  };

  const format = (t) => {
    if (!t || isNaN(t)) return "0:00";
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const fetchLyrics = async (title, artist) => {
    if (!title) return;
    try {
      const q = `https://lrclib.net/api/get?track=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist || "")}`;
      const res = await fetch(q);
      if (!res.ok) { setLyrics(null); setLyricLines([]); return; }
      const data = await res.json();
      const synced = data && data.syncedLyrics;
      if (!synced) { setLyrics(null); setLyricLines([]); return; }
      const lines = synced.split("\n").map((l) => {
        const m = l.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
        if (!m) return null;
        return { t: parseInt(m[1]) * 60 + parseFloat(m[2]), text: m[3].trim() };
      }).filter(Boolean);
      setLyricLines(lines);
      setLyrics(true);
    } catch {
      setLyrics(null); setLyricLines([]);
    }
  };

  useEffect(() => {
    if (fullscreen && currentSong) fetchLyrics(currentSong.title, currentSong.channel);
    else { setLyrics(null); setLyricLines([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen, currentSong?.id]);

  const toggleFullscreen = () => {
    if (!playerRef.current) return;
    if (!fullscreen) {
      setFullscreen(true);
      setShowFsControls(true);
      clearTimeout(fsTimer.current);
      fsTimer.current = setTimeout(() => setShowFsControls(false), 2000);
      if (!IS_ANDROID) getCurrentWindow().setFullscreen(true).catch(() => {});
    } else {
      if (!IS_ANDROID) getCurrentWindow().setFullscreen(false).catch(() => {});
    }
  };

  useEffect(() => {
    if (IS_ANDROID) return;
    const unlisten = getCurrentWindow().onResized(() => {
      getCurrentWindow().isFullscreen().then((fs) => setFullscreen(fs)).catch(() => {});
    });
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  }, []);

  const handleFsMouseMove = () => {
    setShowFsControls(true);
    clearTimeout(fsTimer.current);
    fsTimer.current = setTimeout(() => setShowFsControls(false), 2000);
  };

  const handleDragStart = useCallback((e) => {
    const t = e.touches ? e.touches[0] : e;
    dragging.current = true;
    const rect = playerRef.current?.getBoundingClientRect();
    if (rect) {
      dragOffset.current = { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    const el = playerRef.current;
    if (el) {
      el.style.transition = 'none';
      el.style.willChange = 'left, top';
    }
  }, []);

  // Déplacement du lecteur en posant le doigt n'importe où sur sa surface,
  // sans détourner les appuis sur les contrôles (boutons, sliders, champs…).
  const playerDragStart = useCallback((e) => {
    const el = e.target;
    if (el && el.closest && el.closest("button, input, select, a, textarea, [role='button'], [role='slider'], [role='tab']")) return;
    if (e.touches) e.preventDefault();
    handleDragStart(e);
  }, [handleDragStart]);

  const setPillTransform = (dx, transition) => {
    const el = pillRef.current;
    if (!el) return;
    el.style.transition = transition;
    el.style.transform = `translate(calc(-50% + ${dx}px), 0)`;
    el.style.willChange = 'transform';
  };

  const setPillReveal = (dy) => {
    const el = pillRef.current;
    if (!el) return;
    el.style.transition = 'transform 0.15s ease-in';
    el.style.transform = `translate(-50%, ${dy}px)`;
    el.style.willChange = 'transform';
  };

  const pillTouchStart = (e) => {
    const t = e.touches ? e.touches[0] : e;
    pillSwipe.current = { startX: t.clientX, startY: t.clientY, dx: 0, dy: 0, moved: false };
  };

  const pillTouchMove = (e) => {
    const sw = pillSwipe.current;
    if (!sw) return;
    if (e.touches) e.preventDefault();
    const t = e.touches[0];
    sw.dx = t.clientX - sw.startX;
    sw.dy = t.clientY - sw.startY;
    if (Math.abs(sw.dx) > 4 || Math.abs(sw.dy) > 4) sw.moved = true;
    // Axe dominant : horizontal = pilule qui suit en X, vertical = suit en Y.
    if (Math.abs(sw.dy) > Math.abs(sw.dx)) {
      const el = pillRef.current;
      if (el) {
        el.style.transition = 'none';
        el.style.willChange = 'transform';
        el.style.transform = `translate(-50%, ${sw.dy}px)`;
      }
    } else {
      setPillTransform(sw.dx, 'none');
    }
  };

  const pillTouchEnd = () => {
    const sw = pillSwipe.current;
    pillSwipe.current = null;
    if (!sw) return;
    const THRESHOLD_UP = 70;   // ouverture du lecteur (geste vers le haut)
    const THRESHOLD_DOWN = 35; // pause/lecture (geste vers le bas) : plus sensible
    const dx = sw.dx;
    const dy = sw.dy;
    const back = (transition) => {
      const el = pillRef.current;
      if (el) {
        el.style.transition = transition || 'transform 0.25s cubic-bezier(0.22,1,0.36,1)';
        el.style.transform = 'translate(-50%, 0)';
      }
    };
    const backAfter = (ms, transition) => setTimeout(() => back(transition), ms);
    const threshold = dy < 0 ? THRESHOLD_UP : THRESHOLD_DOWN;
    // Gesture verticale (haut = déplier le lecteur, bas = play/pause).
    if (sw.moved && Math.abs(dy) > threshold && Math.abs(dy) > Math.abs(dx)) {
      pillSuppressClick.current = true;
      if (dy < 0) {
        autoOpenRef.current = false;
        clearTimeout(collapseTimerRef.current);
        setPillReveal(-46);
        setTimeout(() => {
          setHidden(false);
          showControlsTempRef.current?.();
        }, 150);
        backAfter(160);
        setTimeout(() => { pillSuppressClick.current = false; }, 400);
      } else {
        setPillReveal(40);
        backAfter(180);
        setTimeout(() => { pillSuppressClick.current = false; }, 400);
        togglePlayRef.current();
      }
      return;
    }
    const triggerNext = sw.moved && dx > THRESHOLD_UP;
    const triggerPrev = sw.moved && dx < -THRESHOLD_UP;
    if (!triggerNext && !triggerPrev) {
      back();
      return;
    }
    const off = triggerNext ? 60 : -60;
    setPillTransform(off, 'transform 0.15s ease-in');
    pillSuppressClick.current = true;
    setTimeout(() => setPillTransform(0, 'transform 0.25s cubic-bezier(0.22,1,0.36,1)'), 170);
    setTimeout(() => { pillSuppressClick.current = false; }, 400);
    setTimeout(() => {
      if (triggerNext && onNextRef.current) onNextRef.current();
      if (triggerPrev && onPreviousRef.current) onPreviousRef.current();
    }, 170);
  };

  const showControlsTemp = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (playing) setShowControls(false);
    }, 3000);
  }, [playing]);
  // Mettre à jour la référence stable à chaque render
  showControlsTempRef.current = showControlsTemp;

  useEffect(() => {
    if (!fullscreen && currentSong) {
      showControlsTemp();
    }
    return () => clearTimeout(controlsTimer.current);
  }, [currentSong, fullscreen, showControlsTemp]);

  useEffect(() => {
    if (buffering && !fullscreen && currentSong) {
      setShowControls(true);
      clearTimeout(controlsTimer.current);
    }
  }, [buffering, fullscreen, currentSong]);

  const renderModeButtons = (size, gapClass) => (
    <>
      <button
        onClick={onToggleShuffle}
        title="Lecture aléatoire"
        className={`transition-colors p-0.5 ${shuffle ? "text-accent-red" : "text-white/80 hover:text-white"}`}
      >
        <Shuffle size={size} />
      </button>
      <button
        onClick={onCycleRepeat}
        title={repeatMode === "one" ? "Répéter le titre" : repeatMode === "all" ? "Répéter la liste" : "Pas de répétition"}
        className={`transition-colors p-0.5 ${repeatMode !== "off" ? "text-accent-red" : "text-white/80 hover:text-white"}`}
      >
        {repeatMode === "one" ? <Repeat1 size={size} /> : <Repeat size={size} />}
      </button>
    </>
  );

  useEffect(() => {
    const getPoint = (e) => (e.touches ? e.touches[0] : e);
    const onMove = (e) => {
      if (!dragging.current) return;
      if (e.touches) e.preventDefault();
      const t = getPoint(e);
      const el = playerRef.current;
      if (!el) return;
      const w = el.offsetWidth || 384;
      const h = el.offsetHeight || 300;
      const grip = 40;
      const maxX = Math.max(grip, window.innerWidth - w - grip);
      const maxY = Math.max(grip, window.innerHeight - h - grip);
      const nx = Math.min(Math.max(t.clientX - dragOffset.current.x, grip), maxX);
      const ny = Math.min(Math.max(t.clientY - dragOffset.current.y, grip), maxY);
      el.style.left = `${nx}px`;
      el.style.top = `${ny}px`;
    };
    const onUp = () => {
      dragging.current = false;
      const el = playerRef.current;
      if (el) {
        el.style.transition = '';
        el.style.willChange = '';
        const nx = parseFloat(el.style.left);
        const ny = parseFloat(el.style.top);
        if (!isNaN(nx) && !isNaN(ny)) setPos({ x: nx, y: ny });
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
    return () => {
      if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape" && fullscreen) {
        setFullscreen(false);
        if (!IS_ANDROID) getCurrentWindow().setFullscreen(false).catch(() => {});
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [fullscreen]);

  useEffect(() => {
    onFullscreenChange?.(fullscreen);
  }, [fullscreen, onFullscreenChange]);

  // Arrière-plan : signale l'état de lecture réel au backend
  // (boutons thumbbar + notification média).
  useEffect(() => {
    console.log("[bg] IS_ANDROID=" + IS_ANDROID + " UA=" + (navigator.userAgent || ""));
    const v = videoRef.current;
    const dur = v && Number.isFinite(v.duration) ? v.duration : 0;
    const pos = v && Number.isFinite(v.currentTime) ? v.currentTime : 0;
    invoke("set_playing_state", {
      playing,
      title: currentSong?.title ?? "",
      artist: currentSong?.channel ?? "",
      artwork: currentSong?.thumbnail
        ? "http://127.0.0.1:8787/thumb?url=" + encodeURIComponent(currentSong.thumbnail)
        : "",
      position_ms: Math.round(pos * 1000),
      duration_ms: Math.round(dur * 1000),
    }).catch(() => {});
  }, [playing, currentSong]);

  // Notification média : mise à jour périodique de la position pour la
  // barre de progression dans la notification Android.
  useEffect(() => {
    if (!IS_ANDROID || !playing) return;
    const id = setInterval(() => {
      const v = videoRef.current;
      if (v && v.src && !v.paused) {
        const dur = Number.isFinite(v.duration) ? v.duration : 0;
        const pos = Number.isFinite(v.currentTime) ? v.currentTime : 0;
        if (dur > 0) {
          console.log("[bg] interval push dur=" + dur);
          invoke("update_position", {
            position_ms: Math.round(pos * 1000),
            duration_ms: Math.round(dur * 1000),
          }).catch(() => {});
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [playing]);

  // Thumbbar / notification média : actions provenant du système (clavier
  // média, boutons de la notification du BackgroundService, etc.).
  useEffect(() => {
    return onThumbbarAction((action) => {
      if (action === "toggle-play") togglePlayRef.current();
      else if (action === "next") onNextRef.current?.();
      else if (action === "previous") onPreviousRef.current?.();
      else if (action === "stop") onCloseRef.current?.();
      else if (action === "ended") onEndedRef.current?.();
    });
  }, []);

  useEffect(() => {
    if (!currentSong) return;
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentSong.title,
        artist: currentSong.channel || 'MédiaCLI',
        artwork: currentSong.thumbnail
          ? [{ src: 'http://127.0.0.1:8787/thumb?url=' + encodeURIComponent(currentSong.thumbnail), sizes: '512x512', type: 'image/jpeg' }]
          : []
      });
      navigator.mediaSession.setActionHandler('play', () => togglePlayRef.current());
      navigator.mediaSession.setActionHandler('pause', () => togglePlayRef.current());
      navigator.mediaSession.setActionHandler('previoustrack', () => onPrevious?.());
      navigator.mediaSession.setActionHandler('nexttrack', () => onNext?.());
    }
  }, [currentSong]);

  useEffect(() => {
    if ('mediaSession' in navigator && currentSong) {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }
  }, [playing, currentSong]);

  // Rotation automatique Android : paysage dès que le lecteur passe en
  // plein écran, retour portrait à la sortie (y compris à la fermeture).
  useEffect(() => {
    if (!IS_ANDROID) return;
    if (fsOrientationRef.current !== fullscreen) {
      fsOrientationRef.current = fullscreen;
      invoke("set_orientation", { landscape: fullscreen }).catch(() => {});
    }
    return () => {
      if (IS_ANDROID && fsOrientationRef.current) {
        fsOrientationRef.current = false;
        invoke("set_orientation", { landscape: false }).catch(() => {});
      }
    };
  }, [fullscreen]);

  if (!currentSong) return null;

  const poster = currentSong.thumbnail || undefined;

  const isLocalPlayback = !!streamUrl && streamUrl.includes("/local?path=");

  return createPortal(<>
    {!fullscreen && hidden && currentSong && (
      <button
        ref={pillRef}
        onClick={(e) => {
          if (pillSuppressClick.current) return;
          autoOpenRef.current = false;
          setHidden(false);
        }}
        title="Afficher le lecteur"
        style={{ bottom: "calc(52px + var(--sab, 0px))", transform: "translate(-50%, 0)" }}
        onTouchStart={pillTouchStart}
        onTouchMove={pillTouchMove}
        onTouchEnd={pillTouchEnd}
        onTouchCancel={pillTouchEnd}
        className="fixed left-1/2 z-[9999] flex items-center gap-2 rounded-full pl-1 pr-4 py-1.5 bg-accent-red text-white ring-1 ring-white/15 shadow-[0_6px_20px_-4px_rgba(0,0,0,0.5)] hover:brightness-110 active:scale-95 transition-all duration-200 touch-none animate-pill-in"
      >
        <span className="w-8 h-8 rounded-full overflow-hidden shrink-0 bg-black/40 flex items-center justify-center ring-2 ring-white/20">
          {currentSong.thumbnail ? (
            <img src={"http://127.0.0.1:8787/thumb?url=" + encodeURIComponent(currentSong.thumbnail)} className="w-full h-full object-cover" alt="" draggable="false" />
          ) : (
            <Music className="w-4 h-4 text-white/85" />
          )}
        </span>
        <span className="max-w-[170px] truncate text-[11px] font-medium leading-tight">{currentSong.title}</span>
        <span className="w-1.5 h-1.5 rounded-full bg-white/95 shadow-[0_0_8px_rgba(255,255,255,0.9)] animate-pulse" />
      </button>
    )}
    <div
      ref={playerRef}
      data-player-root
      tabIndex={0}
      style={fullscreen ? {} : { position: 'fixed', left: pos.x, top: pos.y, zIndex: 9998 }}
      onTouchStart={fullscreen ? swipeHandlers.handleTouchStart : playerDragStart}
      onTouchEnd={fullscreen ? swipeHandlers.handleTouchEnd : undefined}
      onMouseDown={fullscreen ? undefined : playerDragStart}
      className={`
        z-50 origin-bottom transition-[width,height,opacity,transform] duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]
          ${hidden && !fullscreen
            ? 'opacity-0 scale-[0.045] translate-y-[46vh] pointer-events-none'
            : fullscreen
              ? `fixed inset-0 z-[9999] bg-black flex flex-col ${!showFsControls ? 'cursor-none' : ''}`
              : 'bg-black w-[min(24rem,calc(100vw-24px))] max-h-[calc(100dvh-16px)] border border-accent-red/60 shadow-[0_0_22px_-6px_rgba(200,30,58,0.4)]'
          }
      `}
    >
      <div className={fullscreen ? 'flex-1 bg-black relative' : 'relative aspect-video min-h-[180px] overflow-auto overscroll-contain'} onMouseMove={showControlsTemp}>
        <video
          key={streamUrl}
          ref={videoRef}
          src={streamUrl}
          poster={poster}
          autoPlay
          muted={videoMuted}
          playsInline
          onPause={(e) => {
            if (!userPauseRef.current) {
              setPlaying(false);
            }
          }}
          className={`bg-black cursor-pointer ${fullscreen ? 'absolute inset-0 w-full h-full object-cover' : 'max-h-[45vh] w-full object-cover aspect-video'}`}
          onTimeUpdate={(e) => {
            if (isSeeking) return;
            const t = e.target.currentTime;
            setProgress(t);
            const now = Date.now();
            if (now - lastSaveRef.current > 3000 && currentSong && streamUrl && t > 1) {
              lastSaveRef.current = now;
              try {
                localStorage.setItem("mediacli-resume", JSON.stringify({ song: currentSong, url: streamUrl, time: t }));
              } catch {}
            }
            const dd = Number.isFinite(e.target.duration) ? e.target.duration : 0;
            if (IS_ANDROID && now - lastBgPushRef.current > 1500 && dd > 0) {
              lastBgPushRef.current = now;
              invoke("update_position", { position_ms: Math.round(t * 1000), duration_ms: Math.round(dd * 1000) }).catch(() => {});
            }
          }}
          onLoadedMetadata={(e) => { clearLoadTimer(); setDuration(e.target.duration); setBuffering(false); setStreamError(null); setHasVideo(e.target.videoWidth > 0); if (!streamUrl.includes("/local?path=") && autoOpenRef.current) { if (e.target.videoWidth > 0) { autoOpenRef.current = true; setHidden(false); showControlsTempRef.current?.(); collapseTimerRef.current = setTimeout(() => { if (autoOpenRef.current) setHidden(true); }, 3200); } else { autoOpenRef.current = false; clearTimeout(collapseTimerRef.current); setHidden(true); } } if (videoRef.current) { videoRef.current.volume = volume; videoRef.current.playbackRate = pitch; } const rp = resumePosRef.current > 0 ? resumePosRef.current : resumeTime; if (rp > 1 && videoRef.current) { try { videoRef.current.currentTime = rp; } catch {} } resumePosRef.current = 0; const dur2 = Number.isFinite(e.target.duration) ? e.target.duration : 0; if (IS_ANDROID && dur2 > 0) { invoke("update_position", { position_ms: Math.round((e.target.currentTime || 0) * 1000), duration_ms: Math.round(dur2 * 1000) }).catch(() => {}); } if (videoRef.current) { setVideoMuted(true); videoRef.current.play().then(() => { setVideoMuted(false); setPlaying(true); }).catch(() => setBuffering(false)); } }}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => { clearLoadTimer(); userPauseRef.current = false; setPlaying(true); setBuffering(false); setStreamError(null); }}
          onEnded={() => {
            if (repeatMode === "one" && videoRef.current) {
              videoRef.current.currentTime = 0;
              videoRef.current.play().then(() => setPlaying(true)).catch(() => {});
              return;
            }
            setPlaying(false);
            onEnded && onEnded();
          }}
          onError={() => {
            setBuffering(false);
            setStreamError("Impossible de lire ce flux.");
            try {
              const v = videoRef.current;
              const code = v && v.error ? v.error.code : -1;
              const detail = v && v.error && v.error.message ? v.error.message : "";
              const nstate = v ? v.networkState : -1;
              const rstate = v ? v.readyState : -1;
              const cnt = v ? JSON.stringify({ code, msg: detail, net: nstate, ready: rstate, url: streamUrl, vol: v.muted ? "muted" : "loud" }) : "no-video";
              fetch("http://127.0.0.1:8787/errlog?tag=playonerr&m=" + encodeURIComponent(cnt)).catch(() => {});
            } catch {}
          }}
        />
        {!hasVideo && (
          <>
            <div className="absolute inset-0 z-0 bg-black" />
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none px-4">
              <Music className="w-10 h-10 text-accent-red/90 mb-3 drop-shadow-[0_0_12px_rgba(255,59,92,0.5)]" />
              <p className="text-sm font-semibold text-white/90 text-center line-clamp-2 leading-snug drop-shadow-lg">{currentSong?.title}</p>
              <p className="text-[11px] text-white/80 mt-1">{currentSong?.channel}</p>
            </div>
          </>
        )}
        {swipeFeedback && (
          <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-2xl px-5 py-3 ring-1 ring-white/10 animate-fade-in">
              <swipeFeedback.icon className="w-6 h-6 text-white/90" />
              <span className="text-xs font-medium text-white/90">{swipeFeedback.label}</span>
            </div>
          </div>
        )}
      </div>

      {!fullscreen && (buffering || streamError) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-30">
          {streamError ? (
            <div className="flex flex-col items-center gap-2">
              <span className="text-xs text-red-400 font-medium">{streamError}</span>
              <button onClick={() => { setStreamError(null); setBuffering(true); if (videoRef.current) { videoRef.current.load(); setVideoMuted(true); videoRef.current.play().then(() => { setVideoMuted(false); setPlaying(true); }).catch(() => setBuffering(false)); } }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-accent-red ring-1 ring-accent-red/30 hover:bg-accent-red/10 transition-all duration-200 active:scale-95">
                <RefreshCw className="w-3 h-3" />
                Réessayer
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-accent-red animate-spin" />
              <span className="text-xs text-muted font-medium">Chargement...</span>
            </div>
          )}
        </div>
      )}

      {!fullscreen && (
        <>
          {showControls && (
          <div className="absolute bottom-2 left-2 right-2 flex flex-col gap-1.5 z-40 transition-opacity duration-300">
            <div className="flex-1 flex items-center gap-1 px-1">
              <span className="text-[10px] font-mono text-white/85 shrink-0">{format(progress)}</span>
              <input type="range" min={0} max={duration || 0} value={progress} onInput={handleSeek} onMouseDown={handleSeekStart} onMouseUp={handleSeekEnd} onMouseMove={handleSeekHover} onMouseLeave={handleSeekLeave} className="flex-1 cursor-pointer" style={{ background: 'rgba(255,255,255,0.14)' }} />
              <span className="text-[10px] font-mono text-white/85 shrink-0">{format(duration)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 px-1">
              <div className="flex items-center justify-center gap-1 flex-1">
                <button onClick={onToggleShuffle} className={`bg-black/60 backdrop-blur-sm rounded-full p-2.5 transition-colors ${shuffle ? "text-accent-red" : "text-white/80 hover:text-white"}`} title="Lecture aléatoire">
                  <Shuffle size={18} />
                </button>
                <button onClick={onCycleRepeat} className={`bg-black/60 backdrop-blur-sm rounded-full p-2.5 transition-colors ${repeatMode !== "off" ? "text-accent-red" : "text-white/80 hover:text-white"}`} title="Répétition">
                  {repeatMode === "one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
                </button>
              </div>
              <div className="flex items-center justify-center gap-2 flex-1">
                <button onClick={onPrevious} className="bg-black/60 backdrop-blur-sm rounded-full p-2.5 text-white/90 hover:text-white transition-colors">
                  <SkipBack size={20} />
                </button>
                <button onClick={togglePlay} className="w-11 h-11 flex items-center justify-center rounded-full text-white bg-white/[0.15] hover:bg-white/[0.25] transition-all duration-200">
                  {streamError ? <RefreshCw size={20} /> : buffering ? <Loader2 size={20} className="animate-spin" /> : playing ? <Pause size={20} /> : <Play className="ml-0.5" size={20} />}
                </button>
                <button onClick={onNext} className="bg-black/60 backdrop-blur-sm rounded-full p-2.5 text-white/90 hover:text-white transition-colors">
                  <SkipForward size={20} />
                </button>
              </div>
              <div className="flex items-center justify-center gap-1 flex-1">
                <button onClick={() => onToggleQueue && onToggleQueue()} className={`bg-black/60 backdrop-blur-sm rounded-full p-2 text-white/85 hover:text-white transition-colors ${showQueue ? "text-accent-red" : ""}`} title="File d'attente">
                  <ListMusic size={17} />
                </button>
                <VolumeControl
                  volume={volume}
                  onMute={toggleMute}
                  onVolume={handleVolume}
                  showVolume={showVolume}
                  showVolumeNow={() => setShowVolume(true)}
                  showVolumeWithDelay={showVolumeWithDelay}
                  hideVolumeWithDelay={hideVolumeWithDelay}
                  size={17}
                  sliderH={22}
                />
                {!isLocalPlayback && (
                  <button onClick={() => { if (currentSong && onDownload) onDownload(currentSong, "video"); }} className="bg-black/60 backdrop-blur-sm rounded-full p-2.5 text-white/85 hover:text-white transition-colors" title="Télécharger (vidéo)">
                    <Download size={17} />
                  </button>
                )}
              </div>
            </div>
          </div>
          )}

          <div className="absolute top-2 left-2 right-2 flex items-center justify-between z-40 transition-opacity duration-300">
            <div className="flex items-center gap-2 min-w-0 cursor-grab active:cursor-grabbing" style={{ touchAction: 'none' }} onMouseDown={handleDragStart} onTouchStart={(e) => { e.stopPropagation(); handleDragStart(e); }}>
              <div className="w-6 h-6 overflow-hidden shrink-0 bg-white/[0.06] ring-1 ring-white/[0.08]">
                {currentSong.thumbnail ? (
                  <img src={"http://127.0.0.1:8787/thumb?url=" + encodeURIComponent(currentSong.thumbnail)} className="w-full h-full object-cover" alt="" draggable="false" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><Music className="w-3 h-3 text-white/80" /></div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium truncate text-white/90">{currentSong.title}</p>
                <p className="text-[9px] text-white/80 truncate">{currentSong.channel}</p>
              </div>
            </div>
            {showControls && (
            <div className="flex items-center gap-1">
              {hasVideo && (
                <button onClick={toggleFullscreen} className="bg-black/60 backdrop-blur-sm rounded-full p-2.5 text-white/85 hover:text-white transition-colors" title="Plein écran">
                  <Maximize2 className="w-4 h-4" />
                </button>
              )}
              <button onClick={() => setHidden(true)} className="bg-black/60 backdrop-blur-sm rounded-full p-2.5 text-white/85 hover:text-white transition-colors" title="Masquer le lecteur">
                <EyeOff className="w-4 h-4" />
              </button>
              <button onClick={requestExit} className="bg-black/60 backdrop-blur-sm rounded-full p-2.5 text-white/85 hover:text-white transition-colors" title="Fermer">
                <X className="w-4 h-4" />
              </button>
            </div>
            )}
          </div>
        </>
      )}

      {fullscreen && (
        <div className="absolute inset-0 z-20" onMouseMove={handleFsMouseMove}>
          <div style={{ paddingTop: `calc(var(--sat, 24px) + 12px)` }} className={`absolute top-0 left-0 right-0 pb-8 px-4 transition-opacity duration-200 pointer-events-none ${showFsControls ? 'opacity-100' : 'opacity-0'}`}>
            <div className={`${showFsControls ? 'pointer-events-auto' : 'pointer-events-none'} flex items-center justify-between`}>
              <div className="min-w-0 flex-1 mr-4">
                <p className="text-sm font-medium text-white/90 truncate">{currentSong?.title}</p>
                <p className="text-[11px] text-white/85 truncate">{currentSong?.channel}</p>
              </div>
              <button onClick={() => { setFullscreen(false); if (!IS_ANDROID) getCurrentWindow().setFullscreen(false).catch(() => {}); }} className="bg-black/60 backdrop-blur-sm rounded-full p-2 text-white/90 hover:text-white transition-colors shrink-0">
                <Minimize2 className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div style={{ paddingBottom: `calc(var(--sab, 20px) + 16px)` }} className={`absolute bottom-0 left-0 right-0 pt-12 px-4 transition-opacity duration-200 pointer-events-none ${showFsControls ? 'opacity-100' : 'opacity-0'}`}>
            <div className={`${showFsControls ? 'pointer-events-auto' : 'pointer-events-none'}`}>
              <div className="relative mb-2">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[12px] font-mono text-white/85 shrink-0">{format(progress)}</span>
                  <div className="flex-1">
                    <input type="range" min={0} max={duration || 0} value={progress} onInput={handleSeek} onMouseDown={handleSeekStart} onMouseUp={handleSeekEnd} onMouseMove={handleSeekHover} onMouseLeave={handleSeekLeave} className="w-full cursor-pointer" style={{ background: 'rgba(255,255,255,0.14)' }} />
                    {showHoverTime && (
                      <div className="absolute -top-7 -translate-x-1/2 pointer-events-none text-[12px] font-mono text-white/90 bg-surface rounded-md px-1.5 py-0.5 shadow-lg" style={{ left: `${hoverPct * 100}%` }}>
                        {format(hoverTime)}
                      </div>
                    )}
                  </div>
                  <span className="text-[12px] font-mono text-white/85 shrink-0">{format(duration)}</span>
                </div>
              </div>
<div className="flex items-center justify-between gap-3">
                <div className="flex items-center justify-center gap-2 flex-1">
                  <button onClick={onToggleShuffle} className={`bg-black/60 backdrop-blur-sm rounded-full p-2.5 transition-colors ${shuffle ? "text-accent-red" : "text-white/85 hover:text-white"}`} title="Lecture aléatoire">
                    <Shuffle size={18} />
                  </button>
                  <button onClick={onCycleRepeat} className={`bg-black/60 backdrop-blur-sm rounded-full p-2.5 transition-colors ${repeatMode !== "off" ? "text-accent-red" : "text-white/85 hover:text-white"}`} title="Répétition">
                    {repeatMode === "one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
                  </button>
                </div>
                <div className="flex items-center justify-center gap-4 flex-1">
                  <button onClick={onPrevious} className="bg-black/60 backdrop-blur-sm rounded-full p-2.5 text-white/85 hover:text-white transition-colors">
                    <SkipBack size={18} />
                  </button>
                  <button onClick={togglePlay} className="w-14 h-14 flex items-center justify-center rounded-full text-white bg-black/60 backdrop-blur-sm hover:bg-white/[0.12] transition-all duration-200">
                    {streamError ? <RefreshCw size={18} /> : playing ? <Pause size={22} /> : <Play className="ml-1" size={22} />}
                  </button>
                  <button onClick={onNext} className="bg-black/60 backdrop-blur-sm rounded-full p-2.5 text-white/85 hover:text-white transition-colors">
                    <SkipForward size={18} />
                  </button>
                </div>
                <div className="flex items-center justify-center gap-2 flex-1">
                  <VolumeControl
                    volume={volume}
                    onMute={toggleMute}
                    onVolume={handleVolume}
                    showVolume={showVolume}
                    showVolumeNow={() => setShowVolume(true)}
                    showVolumeWithDelay={showVolumeWithDelay}
                    hideVolumeWithDelay={hideVolumeWithDelay}
                    size={16}
                    sliderH={20}
                  />
                  {lyricLines.length > 0 && (
                    <button onClick={() => { setShowLyrics(v => !v); setShowFsPlaylist(false); }} className={`relative bg-black/60 backdrop-blur-sm rounded-full p-2.5 transition-colors ${showLyrics ? "text-accent-red" : "text-white/85 hover:text-white"}`} title="Paroles synchronisées">
                      <Mic size={18} />
                    </button>
                  )}
                  <button onClick={() => setShowSleep((o) => !o)} className={`relative bg-black/60 backdrop-blur-sm rounded-full p-2.5 transition-colors ${sleepMinutes > 0 || showSleep ? "text-accent-red" : "text-white/85 hover:text-white"}`} title="Minuterie de sommeil">
                    <Timer size={18} />
                  </button>
                  <button onClick={() => { setShowFsPlaylist(v => !v); setShowLyrics(false); }} className={`relative bg-black/60 backdrop-blur-sm rounded-full p-2.5 transition-colors ${showFsPlaylist ? "text-accent-red" : "text-white/85 hover:text-white"}`} title="Playlist">
                    <ListMusic size={18} />
                  </button>
                  {!isLocalPlayback && (
                    <button onClick={() => { if (currentSong && onDownload) onDownload(currentSong, "video"); }} className="bg-black/60 backdrop-blur-sm rounded-full p-2.5 text-white/85 hover:text-white transition-colors" title="Télécharger (vidéo)">
                      <Download size={18} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          {showLyrics && lyricLines.length > 0 && (() => {
            let activeIdx = 0;
            for (let i = 0; i < lyricLines.length; i++) if (progress >= lyricLines[i].t) activeIdx = i;
            return (
              <div className="absolute left-0 right-0 z-10 flex justify-center px-6 pointer-events-none" style={{ bottom: `calc(var(--sab, 20px) + 112px)` }}>
                <div className="max-w-2xl text-center">
                  {lyricLines.map((l, i) => {
                    const near = i >= activeIdx - 2 && i <= activeIdx + 2;
                    if (!near) return null;
                    return (
                      <p key={i} className={`text-lg leading-relaxed transition-all duration-200 ${i === activeIdx ? "text-white font-semibold drop-shadow-[0_0_10px_rgba(255,59,92,0.6)]" : "text-white/80"}`}>
                        {l.text || "♪"}
                      </p>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          {showFsPlaylist && playlist.length > 0 && (() => {
            const currentId = currentSong?.id;
            return (
              <div style={{ bottom: `calc(var(--sab, 20px) + 112px)` }} className="absolute left-0 right-0 z-10 flex justify-center px-4 pointer-events-none">
                <div onMouseMove={(e) => e.stopPropagation()} className={`relative max-w-lg w-full rounded-2xl bg-black/70 backdrop-blur-md border border-white/[0.08] pointer-events-auto py-3 pl-3 pr-1.5 animate-fade-in ${!showFsControls ? 'cursor-none' : ''}`}>
                  <button onClick={() => setShowFsPlaylist(false)} className="absolute top-2 right-2 z-30 p-1 rounded-md text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors" title="Fermer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <p className="text-xs uppercase tracking-wider text-white/80 mb-2 pr-8">File d'attente ({playlist.length})</p>
                  <div onScroll={(e) => e.stopPropagation()} className="max-h-[calc(40vh-40px)] overflow-y-auto scroll-modern pr-2 pl-0">
                    {playlist.map((track, i) => {
                      const isActive = (track.id) === currentId;
                      return (
                        <button
                          key={track.id + i}
                          onClick={(e) => { e.stopPropagation(); onPlayAt && onPlayAt(i); }}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${isActive ? "bg-white/[0.18]" : "hover:bg-white/[0.08]"}`}
                        >
                          {isActive && <span className="text-white text-[10px] font-bold shrink-0">▶</span>}
                          {!isActive && <span className="text-white/80 text-[10px] w-3 text-center shrink-0">{i + 1}</span>}
                          <div className="flex-1 min-w-0">
                            <p className={`text-[12px] font-medium truncate ${isActive ? "text-white font-semibold" : "text-white/90"}`}>{track.title}</p>
                            <p className={`text-[10px] truncate ${isActive ? "text-white/80" : "text-green-400/85"}`}>{track.channel}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
          {showSleep && (
            <div style={{ bottom: `calc(var(--sab, 20px) + 112px)` }} className="absolute left-4 z-20 w-56 p-4 pt-3 rounded-2xl bg-black/70 backdrop-blur-md border border-white/[0.08] pointer-events-auto animate-fade-in">
              <button onClick={() => setShowSleep(false)} className="absolute top-2 right-2 z-30 p-1 rounded-md text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors" title="Fermer">
                <X className="w-3.5 h-3.5" />
              </button>
              <p className="text-xs uppercase tracking-wider text-white/80 mb-3">Minuterie de sommeil</p>
              <div className="grid grid-cols-2 gap-2">
                {[15, 30, 45, 60].map((m) => (
                  <button key={m} onClick={() => startSleepTimer(m)} className={`py-2 rounded-lg text-sm transition-colors ${sleepMinutes === m ? "bg-white/[0.16] ring-1 ring-white/25 text-white font-semibold" : "bg-white/[0.08] hover:bg-white/[0.14] text-white/90"}`}>
                    {m} min
                  </button>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <input
                  type="number"
                  min={1}
                  max={480}
                  placeholder="min"
                  value={customSleep}
                  onChange={(e) => setCustomSleep(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { const v = parseInt(customSleep); if (v > 0) startSleepTimer(v); } }}
                  className="flex-1 bg-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-white/90 text-white/85 outline-none focus:ring-1 focus:ring-accent-red/50"
                />
                <button
                  onClick={() => { const v = parseInt(customSleep); if (v > 0) startSleepTimer(v); }}
                  className="px-3 py-1.5 rounded-lg bg-white/[0.10] hover:bg-white/[0.16] text-white/90 text-xs font-medium ring-1 ring-white/12 transition-colors"
                >
                  OK
                </button>
              </div>
              {sleepMinutes > 0 && (
                <div className="mt-3 text-center">
                  <p className="text-2xl font-mono text-accent-red drop-shadow-[0_0_10px_rgba(255,59,92,0.5)]">{Math.floor(sleepRemaining() / 60)}:{String(sleepRemaining() % 60).padStart(2, "0")}</p>
                  <button onClick={() => startSleepTimer(0)} className="mt-2 w-full text-[11px] py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-white/90 transition-colors">Annuler</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {showVolPct && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center pointer-events-none">
          <span className="text-4xl font-mono font-bold text-white bg-accent-red/20 px-6 py-2 rounded-2xl backdrop-blur-sm">
            {Math.round(volume * 100)}%
          </span>
        </div>
      )}
    </div>
    {confirmExit && (
      <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
        <div className="w-[min(20rem,calc(100vw-48px))] rounded-2xl bg-surface border border-white/10 p-5 shadow-2xl">
          <p className="text-base font-semibold text-white text-center">Quitter le lecteur ?</p>
          <p className="mt-1 text-[11px] text-white/70 text-center leading-snug">
            La lecture en cours sera arrêtée.
          </p>
          <div className="mt-5 flex gap-2.5">
            <button
              onClick={confirmExitNow}
              className="flex-1 py-2.5 rounded-xl bg-accent-red text-white text-sm font-medium hover:bg-accent-red/90 transition-colors"
            >
              Quitter
            </button>
            <button
              onClick={() => setConfirmExit(false)}
              className="flex-1 py-2.5 rounded-xl bg-white/[0.08] text-white/90 text-sm hover:bg-white/[0.14] transition-colors"
            >
              Annuler
            </button>
          </div>
        </div>
      </div>
    )}
  </>, document.body);
}
