import { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, SkipBack, SkipForward, X, ChevronDown, ChevronUp, Maximize2, Minimize2, Loader2, RefreshCw, Volume2, VolumeX, Shuffle, Repeat, Repeat1, Music, Video, ListMusic, PictureInPicture2, SlidersHorizontal, Timer, Mic, Forward, Rewind } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import useSwipeGesture from "../hooks/useSwipeGesture";

const IS_ANDROID = /android/i.test(navigator.userAgent || "");

function VolumeControl({ volume, onMute, onVolume, showVolume, showVolumeNow, showVolumeWithDelay, hideVolumeWithDelay, size = 14, sliderH = 20 }) {
  const toggle = (e) => {
    e?.stopPropagation();
    if (showVolume) hideVolumeWithDelay();
    else if (showVolumeNow) showVolumeNow();
    else showVolumeWithDelay();
  };
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
          className="absolute bottom-full left-1/2 -translate-x-1/2 pb-0.5 flex items-end z-50"
          onMouseEnter={showVolumeWithDelay}
          onMouseLeave={hideVolumeWithDelay}
        >
          <div className="bg-black/60 backdrop-blur-sm rounded-lg p-2.5 shadow-xl flex items-center justify-center ring-1 ring-white/[0.08] gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onMute && onMute(); }}
              className="text-white/85 hover:text-white shrink-0"
              title={volume === 0 ? "Activer le son" : "Couper le son"}
            >
              {volume === 0 ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onInput={onVolume}
              onMouseDown={(e) => e.stopPropagation()}
              className="vol-line cursor-pointer"
              style={{ writingMode: "vertical-lr", direction: "rtl", height: `${sliderH * 4}px` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}


export default function Player({ currentSong, streamUrl, onClose, onNext, onPrevious, onEnded, shuffle, repeatMode, onToggleShuffle, onCycleRepeat, onFullscreenChange, playlist = [], onPlayAt, resumeTime = 0, playlists = {}, onSaveQueue, onPlayPlaylist, onDeletePlaylist, onRemoveFromPlaylist, showQueue = false, onToggleQueue }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const rafRef = useRef(null);
  const lastVolumeRef = useRef(0.4);
  const lastSaveRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [streamError, setStreamError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showFsControls, setShowFsControls] = useState(true);

  const [hasVideo, setHasVideo] = useState(false);
  const [lyrics, setLyrics] = useState(null);
  const [lyricLines, setLyricLines] = useState([]);
  const fsTimer = useRef(null);
  const [hoverTime, setHoverTime] = useState(0);
  const [hoverPct, setHoverPct] = useState(0);
  const [showHoverTime, setShowHoverTime] = useState(false);
  const [volume, setVolume] = useState(0.4);
  const [videoMuted, setVideoMuted] = useState(true);
  const [showVolume, setShowVolume] = useState(false);
  const [showVolPct, setShowVolPct] = useState(false);
  const volPctTimer = useRef(null);
  const volumeTimerRef = useRef(null);
  const loadTimerRef = useRef(null);
  const seekRef = useRef(null);
  const resumePosRef = useRef(0);
  const pausePosRef = useRef(0);
  const [pos, setPos] = useState(() => ({ x: window.innerWidth - 400, y: Math.max(20, window.innerHeight - 340) }));
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
      setPlaying(false);
      setProgress(0);
      setDuration(0);
      clearLoadTimer();
      loadTimerRef.current = setTimeout(() => setStreamError("Le flux met trop de temps à répondre."), 90000);
      return () => clearLoadTimer();
    }
    if (!streamUrl && videoRef.current) {
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

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
    }
  }, [streamUrl, volume]);

  useEffect(() => {
    return () => {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute("src");
        videoRef.current.load();
      }
    };
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && videoRef.current && !videoRef.current.paused) {
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
      setFullscreen((f) => !f);
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

  useEffect(() => { togglePlayRef.current = togglePlay; }, [togglePlay]);
  useEffect(() => { handleSeekRef.current = handleSeek; }, [handleSeek]);
  useEffect(() => { handleVolumeRef.current = handleVolume; }, [handleVolume]);
  useEffect(() => { toggleMuteRef.current = toggleMute; }, [toggleMute]);
  useEffect(() => { fullscreenRef.current = fullscreen; }, [fullscreen]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;

      const playerActive = !!videoRef.current?.src && !minimized;
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
          setFullscreen((f) => !f);
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

  const togglePip = () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) document.exitPictureInPicture();
      else v.requestPictureInPicture();
    } catch {}
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
    if (!minimized && !fullscreen && currentSong) {
      showControlsTemp();
    }
    return () => clearTimeout(controlsTimer.current);
  }, [currentSong, minimized, fullscreen, showControlsTemp]);

  useEffect(() => {
    if (buffering && !fullscreen && !minimized && currentSong) {
      setShowControls(true);
      clearTimeout(controlsTimer.current);
    }
  }, [buffering, fullscreen, minimized, currentSong]);

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

  // Thumbbar: update buttons when playback state changes
  useEffect(() => {
    invoke("set_thumbbar_playing", { playing: !!currentSong }).catch(() => {});
  }, [currentSong]);

  // Thumbbar: listen for button clicks from taskbar
  useEffect(() => {
    const unlisten = listen("thumbbar-action", (e) => {
      if (e.payload === "toggle-play") togglePlay();
    });
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  }, [playing, currentSong, streamError, buffering]);

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

  if (!currentSong) return null;

  const poster = currentSong.thumbnail || undefined;

  return (<>
    <div
      ref={playerRef}
      data-player-root
      tabIndex={0}
      style={fullscreen ? {} : { position: 'fixed', left: pos.x, top: pos.y }}
      onTouchStart={swipeHandlers.handleTouchStart}
      onTouchEnd={swipeHandlers.handleTouchEnd}
      className={`
        z-50 transition-[width,height,opacity,transform] duration-300
          ${fullscreen
            ? `fixed inset-0 z-[9999] bg-black flex flex-col ${!showFsControls ? 'cursor-none' : ''}`
            : minimized
              ? 'bg-transparent w-[min(20rem,calc(100vw-24px))] border border-accent-red/60 shadow-[0_0_18px_-6px_rgba(200,30,58,0.4)]'
              : 'w-[min(24rem,calc(100vw-24px))] max-h-[calc(100dvh-16px)] overflow-y-auto scroll-modern overscroll-contain border border-accent-red/60 shadow-[0_0_22px_-6px_rgba(200,30,58,0.4)]'
          }
      `}
    >
      <div className={fullscreen ? 'flex-1 bg-black relative' : minimized ? 'hidden' : 'relative aspect-video min-h-[180px]'} onMouseMove={showControlsTemp}>
        <video
          key={streamUrl}
          ref={videoRef}
          src={streamUrl}
          poster={poster}
          autoPlay
          muted={videoMuted}
          playsInline
          onPause={() => setPlaying(false)}
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
          }}
          onLoadedMetadata={(e) => { clearLoadTimer(); setDuration(e.target.duration); setBuffering(false); setStreamError(null); setHasVideo(e.target.videoWidth > 0); if (videoRef.current) { videoRef.current.volume = volume; videoRef.current.playbackRate = pitch; } const rp = resumePosRef.current > 0 ? resumePosRef.current : resumeTime; if (rp > 1 && videoRef.current) { try { videoRef.current.currentTime = rp; } catch {} } resumePosRef.current = 0; if (videoRef.current) { setVideoMuted(true); videoRef.current.play().then(() => { setVideoMuted(false); setPlaying(true); }).catch(() => setBuffering(false)); } }}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => { clearLoadTimer(); setPlaying(true); setBuffering(false); setStreamError(null); }}
          onEnded={() => {
            if (repeatMode === "one" && videoRef.current) {
              videoRef.current.currentTime = 0;
              videoRef.current.play().then(() => setPlaying(true)).catch(() => {});
              return;
            }
            setPlaying(false);
            onEnded && onEnded();
          }}
          onError={() => { setBuffering(false); setStreamError("Impossible de lire ce flux."); }}
        />
        {!hasVideo && (
          <>
            <div className="absolute inset-0 z-0 bg-surface" />
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

      {!fullscreen && !minimized && (buffering || streamError) && (
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

      {!fullscreen && !minimized && (
        <>
          {showControls && (
          <div className="absolute bottom-2 left-2 right-2 flex flex-col gap-1.5 z-40 transition-opacity duration-300">
            <div className="flex-1 flex items-center gap-1 px-1">
              <span className="text-[10px] font-mono text-white/85 shrink-0">{format(progress)}</span>
              <input type="range" min={0} max={duration || 0} value={progress} onInput={handleSeek} onMouseDown={handleSeekStart} onMouseUp={handleSeekEnd} onMouseMove={handleSeekHover} onMouseLeave={handleSeekLeave} className="flex-1 cursor-pointer" style={{ background: `linear-gradient(to right, #c81e3a ${duration ? (progress/duration)*100 : 0}%, rgba(225,29,72,0.25) ${duration ? (progress/duration)*100 : 0}%)` }} />
              <span className="text-[10px] font-mono text-white/85 shrink-0">{format(duration)}</span>
            </div>
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1">
                <button onClick={onToggleShuffle} className={`bg-black/60 backdrop-blur-sm rounded-full p-2.5 transition-colors ${shuffle ? "text-accent-red" : "text-white/80 hover:text-white"}`} title="Lecture aléatoire">
                  <Shuffle size={18} />
                </button>
                <button onClick={onCycleRepeat} className={`bg-black/60 backdrop-blur-sm rounded-full p-2.5 transition-colors ${repeatMode !== "off" ? "text-accent-red" : "text-white/80 hover:text-white"}`} title="Répétition">
                  {repeatMode === "one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
                </button>
              </div>
              <div className="flex items-center gap-2">
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
              <div className="flex items-center gap-1">
                <VolumeControl
                  volume={volume}
                  onMute={toggleMute}
                  onVolume={handleVolume}
                  showVolume={showVolume}
                  showVolumeNow={() => setShowVolume(true)}
                  showVolumeWithDelay={showVolumeWithDelay}
                  hideVolumeWithDelay={hideVolumeWithDelay}
                  size={17}
                  sliderH={20}
                />
                {hasVideo && (
                  <button onClick={togglePip} className="bg-black/60 backdrop-blur-sm rounded-full p-2.5 text-white/85 hover:text-white transition-colors" title="Picture-in-Picture">
                    <PictureInPicture2 size={17} />
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
              <button onClick={() => onToggleQueue && onToggleQueue()} className={`bg-black/60 backdrop-blur-sm rounded-full p-2.5 transition-colors ${showQueue ? "text-accent-red" : "text-white/85 hover:text-white"}`} title="File d'attente">
                <ListMusic className="w-4 h-4" />
              </button>
              <button onClick={toggleFullscreen} className="bg-black/60 backdrop-blur-sm rounded-full p-2.5 text-white/85 hover:text-white transition-colors" title="Plein écran">
                <Maximize2 className="w-4 h-4" />
              </button>
              <button onClick={() => setMinimized(true)} className="bg-black/60 backdrop-blur-sm rounded-full p-2.5 text-white/85 hover:text-white transition-colors" title="Réduire">
                <ChevronDown className="w-4 h-4" />
              </button>
              <button onClick={onClose} className="bg-black/60 backdrop-blur-sm rounded-full p-2.5 text-white/85 hover:text-white transition-colors" title="Fermer">
                <X className="w-4 h-4" />
              </button>
            </div>
            )}
          </div>
        </>
      )}

      {!fullscreen && minimized && (
        <div className="select-none border border-white/[0.15] bg-black" style={{ touchAction: 'none' }} onMouseDown={handleDragStart} onTouchStart={(e) => { e.stopPropagation(); handleDragStart(e); }}>
          <div className="flex items-center gap-3 px-3.5 py-2.5">
            <div className="w-10 h-10 overflow-hidden shrink-0 bg-white/[0.04] ring-1 ring-white/[0.06]">
              {currentSong.thumbnail ? (
                <img src={"http://127.0.0.1:8787/thumb?url=" + encodeURIComponent(currentSong.thumbnail)} className="w-full h-full object-cover" alt="" draggable="false" />
              ) : hasVideo ? (
                <div className="w-full h-full flex items-center justify-center bg-white/[0.03]">
                  <Video className="w-4 h-4 text-white/80" />
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-white/[0.03]">
                  <Music className="w-4 h-4 text-white/80" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold truncate text-white/90 leading-tight">{currentSong.title}</p>
              <p className="text-[10px] text-white/80 truncate mt-0.5 leading-tight">{currentSong.channel}</p>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} className="p-1.5 rounded-md text-white/80 hover:text-white/90 hover:bg-white/[0.06] transition-colors" title="Plein écran">
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); setMinimized(false); }} className="p-1.5 rounded-md text-white/80 hover:text-white/90 hover:bg-white/[0.06] transition-colors" title="Agrandir">
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-1.5 rounded-md text-white/80 hover:text-white/90 hover:bg-white/[0.06] transition-colors" title="Fermer">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="px-3.5 pb-1">
            <div className="relative group/seek">
              <input
                type="range"
                min={0}
                max={duration || 0}
                value={progress}
                onInput={handleSeek}
                onMouseDown={handleSeekStart}
                onMouseUp={handleSeekEnd}
                onMouseMove={handleSeekHover}
                onMouseLeave={handleSeekLeave}
                className="compact-progress w-full"
                style={{ background: `linear-gradient(to right, #c81e3a ${duration ? (progress/duration)*100 : 0}%, rgba(255,255,255,0.08) ${duration ? (progress/duration)*100 : 0}%)` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2.5 px-3.5 pb-2.5">
            <span className="text-[9px] font-mono text-white/80 tabular-nums w-8 text-right">{format(progress)}</span>
            <div className="flex items-center gap-0.5 shrink-0">
              <button onClick={(e) => { e.stopPropagation(); onPrevious(); }} className="text-white/80 hover:text-white/90 transition-colors p-1 rounded-md hover:bg-white/[0.06]" title="Précédent">
                <SkipBack size={14} fill="currentColor" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className="w-8 h-8 flex items-center justify-center rounded-full text-white bg-white/[0.08] hover:bg-white/[0.14] transition-colors" title={playing ? "Pause" : "Lecture"}>
                {streamError ? <RefreshCw className="w-3.5 h-3.5" /> : buffering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : playing ? <Pause className="w-3.5 h-3.5" fill="currentColor" /> : <Play className="w-3.5 h-3.5 ml-px" fill="currentColor" />}
              </button>
              <button onClick={(e) => { e.stopPropagation(); onNext(); }} className="text-white/80 hover:text-white/90 transition-colors p-1 rounded-md hover:bg-white/[0.06]" title="Suivant">
                <SkipForward size={14} fill="currentColor" />
              </button>
            </div>
            <span className="text-[9px] font-mono text-white/80 tabular-nums w-8">{format(duration)}</span>
            <div className="flex-1" />
            <VolumeControl
              volume={volume}
              onMute={(e) => { e?.stopPropagation(); toggleMute(); }}
              onVolume={handleVolume}
              showVolume={showVolume}
              showVolumeNow={() => setShowVolume(true)}
              showVolumeWithDelay={showVolumeWithDelay}
              hideVolumeWithDelay={hideVolumeWithDelay}
              size={13}
              sliderH={16}
            />
          </div>
        </div>
      )}

      {fullscreen && (
        <div className="absolute inset-0 z-20" onMouseMove={handleFsMouseMove}>
          <div className={`absolute top-0 left-0 right-0 pt-3 pb-8 px-4 transition-opacity duration-200 pointer-events-none ${showFsControls ? 'opacity-100' : 'opacity-0'}`}>
            <div className="pointer-events-auto flex items-center justify-between">
              <div className="min-w-0 flex-1 mr-4">
                <p className="text-sm font-medium text-white/90 truncate">{currentSong?.title}</p>
                <p className="text-[11px] text-white/85 truncate">{currentSong?.channel}</p>
              </div>
              <button onClick={() => { setFullscreen(false); if (!IS_ANDROID) getCurrentWindow().setFullscreen(false).catch(() => {}); }} className="bg-black/60 backdrop-blur-sm rounded-full p-2 text-white/90 hover:text-white transition-colors shrink-0">
                <Minimize2 className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div className={`absolute bottom-0 left-0 right-0 pt-12 pb-4 px-4 transition-opacity duration-200 pointer-events-none ${showFsControls ? 'opacity-100' : 'opacity-0'}`}>
            <div className="pointer-events-auto">
              <div className="relative mb-2">
                <input type="range" min={0} max={duration || 0} value={progress} onInput={handleSeek} onMouseDown={handleSeekStart} onMouseUp={handleSeekEnd} onMouseMove={handleSeekHover} onMouseLeave={handleSeekLeave} className="w-full cursor-pointer" style={{ background: `linear-gradient(to right, #c81e3a ${duration ? (progress/duration)*100 : 0}%, rgba(225,29,72,0.25) ${duration ? (progress/duration)*100 : 0}%)` }} />
                {showHoverTime && (
                  <div className="absolute -top-7 -translate-x-1/2 pointer-events-none text-[10px] font-mono text-white/90 bg-surface rounded-md px-1.5 py-0.5 shadow-lg" style={{ left: `${hoverPct * 100}%` }}>
                    {format(hoverTime)}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-center gap-5">
                <button onClick={onToggleShuffle} className={`bg-black/60 backdrop-blur-sm rounded-full p-2.5 transition-colors ${shuffle ? "text-accent-red" : "text-white/85 hover:text-white"}`} title="Lecture aléatoire">
                  <Shuffle size={18} />
                </button>
                <button onClick={onCycleRepeat} className={`bg-black/60 backdrop-blur-sm rounded-full p-2.5 transition-colors ${repeatMode !== "off" ? "text-accent-red" : "text-white/85 hover:text-white"}`} title="Répétition">
                  {repeatMode === "one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
                </button>
                <button onClick={onPrevious} className="bg-black/60 backdrop-blur-sm rounded-full p-2.5 text-white/85 hover:text-white transition-colors">
                  <SkipBack size={18} />
                </button>
                 <button onClick={togglePlay} className="w-14 h-14 flex items-center justify-center rounded-full text-white bg-black/60 backdrop-blur-sm hover:bg-white/[0.12] transition-all duration-200">
                   {streamError ? <RefreshCw size={18} /> : playing ? <Pause size={22} /> : <Play className="ml-1" size={22} />}
                 </button>
                <button onClick={onNext} className="bg-black/60 backdrop-blur-sm rounded-full p-2.5 text-white/85 hover:text-white transition-colors">
                  <SkipForward size={18} />
                </button>
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
                {hasVideo && (
                  <button onClick={togglePip} className="bg-black/60 backdrop-blur-sm rounded-full p-2.5 text-white/85 hover:text-white transition-colors" title="Picture-in-Picture">
                    <PictureInPicture2 size={18} />
                  </button>
                )}
                {lyricLines.length > 0 && (
                  <button onClick={() => setShowLyrics(v => !v)} className={`bg-black/60 backdrop-blur-sm rounded-full p-2.5 transition-colors ${showLyrics ? "text-accent-red" : "text-white/85 hover:text-white"}`} title="Paroles synchronisées">
                    <Mic size={18} />
                  </button>
                )}
                <button onClick={() => setEqOpen((o) => !o)} className={`bg-black/60 backdrop-blur-sm rounded-full p-2.5 transition-colors ${eqOpen ? "text-accent-red" : "text-white/85 hover:text-white"}`} title="Égaliseur & tonalité">
                  <SlidersHorizontal size={18} />
                </button>
                <button onClick={() => setShowSleep((o) => !o)} className={`bg-black/60 backdrop-blur-sm rounded-full p-2.5 transition-colors ${sleepMinutes > 0 || showSleep ? "text-accent-red" : "text-white/85 hover:text-white"}`} title="Minuterie de sommeil">
                  <Timer size={18} />
                </button>
                <button onClick={() => { setShowFsPlaylist(v => !v); setShowLyrics(false); }} className={`bg-black/60 backdrop-blur-sm rounded-full p-2.5 transition-colors ${showFsPlaylist ? "text-accent-red" : "text-white/85 hover:text-white"}`} title="Playlist">
                  <ListMusic size={18} />
                </button>
              </div>
            </div>
          </div>
          {showLyrics && lyricLines.length > 0 && (() => {
            let activeIdx = 0;
            for (let i = 0; i < lyricLines.length; i++) if (progress >= lyricLines[i].t) activeIdx = i;
            return (
              <div className="absolute left-0 right-0 bottom-28 z-10 flex justify-center px-6 pointer-events-none">
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
              <div className="absolute left-0 right-0 bottom-28 z-10 flex justify-center px-4 pointer-events-none">
                <div onMouseMove={(e) => e.stopPropagation()} onScroll={(e) => e.stopPropagation()} className={`max-w-lg w-full max-h-[40vh] overflow-y-auto scroll-modern rounded-2xl bg-black/70 backdrop-blur-md border border-white/[0.08] pointer-events-auto p-3 ${!showFsControls ? 'cursor-none' : ''}`}>
                  <p className="text-xs uppercase tracking-wider text-white/80 mb-2">File d'attente ({playlist.length})</p>
                  {playlist.map((track, i) => {
                    const isActive = (track.id) === currentId;
                    return (
                      <button
                        key={track.id + i}
                        onClick={(e) => { e.stopPropagation(); onPlayAt && onPlayAt(i); }}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${isActive ? "bg-accent-red/20" : "hover:bg-white/[0.08]"}`}
                      >
                        {isActive && <span className="text-accent-red text-[10px] font-bold shrink-0">▶</span>}
                        {!isActive && <span className="text-white/80 text-[10px] w-3 text-center shrink-0">{i + 1}</span>}
                        <div className="flex-1 min-w-0">
                          <p className={`text-[12px] font-medium truncate ${isActive ? "text-white" : "text-white/90"}`}>{track.title}</p>
                          <p className={`text-[10px] truncate ${isActive ? "text-green-400/90" : "text-green-400/85"}`}>{track.channel}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          {eqOpen && (
            <div className="absolute right-4 bottom-28 z-20 w-72 p-4 rounded-2xl bg-black/70 backdrop-blur-md border border-white/[0.08] pointer-events-auto">
              <p className="text-xs uppercase tracking-wider text-white/80 mb-3">Égaliseur & tonalité</p>
              {IS_ANDROID && (
                <p className="text-[10px] text-white/60 mb-3 leading-snug">
                  Égaliseur désactivé sur Android (le routage WebAudio y coupe le son après une pause).
                </p>
              )}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {Object.keys(EQ_PRESETS).map((name) => (
                  <button
                    key={name}
                    onClick={() => applyPreset(name)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                      eqPreset === name
                        ? "bg-accent-red text-white"
                        : "bg-white/[0.06] text-white/80 hover:bg-white/[0.1] hover:text-white/90"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-[11px] text-white/85 mb-1"><span>Basses</span><span>{bass > 0 ? "+" : ""}{bass.toFixed(1)}</span></div>
                  <input type="range" min={-12} max={12} step={0.5} value={bass} onChange={(e) => setBass(parseFloat(e.target.value))} className="w-full accent-red-600" />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-white/85 mb-1"><span>Médiums</span><span>{mid > 0 ? "+" : ""}{mid.toFixed(1)}</span></div>
                  <input type="range" min={-12} max={12} step={0.5} value={mid} onChange={(e) => setMid(parseFloat(e.target.value))} className="w-full accent-red-600" />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-white/85 mb-1"><span>Aigus</span><span>{treble > 0 ? "+" : ""}{treble.toFixed(1)}</span></div>
                  <input type="range" min={-12} max={12} step={0.5} value={treble} onChange={(e) => setTreble(parseFloat(e.target.value))} className="w-full accent-red-600" />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-white/85 mb-1"><span>Tonalité (pitch)</span><span>{pitch.toFixed(2)}x</span></div>
                  <input type="range" min={0.5} max={1.5} step={0.01} value={pitch} onChange={(e) => setPitch(parseFloat(e.target.value))} className="w-full accent-red-600" />
                </div>
                <button onClick={() => { setBass(0); setMid(0); setTreble(0); setPitch(1); setEqPreset("Flat"); }} className="w-full mt-1 text-[11px] py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-white/90 transition-colors">Réinitialiser</button>
              </div>
            </div>
          )}
          {showSleep && (
            <div className="absolute left-4 bottom-28 z-20 w-56 p-4 rounded-2xl bg-black/70 backdrop-blur-md border border-white/[0.08] pointer-events-auto">
              <p className="text-xs uppercase tracking-wider text-white/80 mb-3">Minuterie de sommeil</p>
              <div className="grid grid-cols-2 gap-2">
                {[15, 30, 45, 60].map((m) => (
                  <button key={m} onClick={() => startSleepTimer(m)} className={`py-2 rounded-lg text-sm transition-colors ${sleepMinutes === m ? "bg-accent-red text-white" : "bg-white/[0.08] hover:bg-white/[0.14] text-white/90"}`}>
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
                  className="px-3 py-1.5 rounded-lg bg-accent-red/20 hover:bg-accent-red/30 text-accent-red text-xs font-medium transition-colors"
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
      {showVolPct && !minimized && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center pointer-events-none">
          <span className="text-4xl font-mono font-bold text-white bg-accent-red/20 px-6 py-2 rounded-2xl backdrop-blur-sm">
            {Math.round(volume * 100)}%
          </span>
        </div>
      )}
    </div>
  </>);
}
