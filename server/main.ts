import { searchAll } from "./search.ts";
import { downloadAndConvert } from "./download.ts";
import { youtubeiStream } from "./youtubei.ts";
import { createScanFoldersResponse } from "./scanFolders.ts";

const PORT = 8787;
const OUTPUT_DIR = Deno.env.get("MEDIACLI_OUTPUT_DIR") || "C:\\MediaCLI";
const TOR_PROXY = "socks5://127.0.0.1:9050";

const RESOURCE_DIR = (() => {
  const idx = Deno.args.indexOf("--resource-dir");
  return idx !== -1 && idx + 1 < Deno.args.length ? Deno.args[idx + 1] : null;
})();

const YT_DLP_PATH = RESOURCE_DIR ? `${RESOURCE_DIR}\\yt-dlp.exe` : "yt-dlp";
const FFMPEG_PATH = RESOURCE_DIR ? `${RESOURCE_DIR}\\ffmpeg.exe` : "ffmpeg";
const TOR_PATH = RESOURCE_DIR ? `${RESOURCE_DIR}\\tor\\tor.exe` : "tor";
const TOR_GEOIP = RESOURCE_DIR ? `${RESOURCE_DIR}\\tor\\data\\geoip` : "";
const TOR_GEOIP6 = RESOURCE_DIR ? `${RESOURCE_DIR}\\tor\\data\\geoip6` : "";

// Tue tout processus tor.exe orphelin au démarrage
async function killOrphanTor() {
  try {
    const cmd = new Deno.Command("taskkill", { args: ["/F", "/IM", "tor.exe"] });
    await cmd.output();
  } catch {}
}

await killOrphanTor();

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "tauri://localhost", "https://tauri.localhost"];

function getCorsHeaders(reqOrigin?: string | null): Record<string, string> {
  const origin = (reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin)) ? reqOrigin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function isNetworkError(err: unknown): boolean {
  const m = String(err).toLowerCase();
  return m.includes("failed to resolve") || m.includes("getaddrinfo failed") || m.includes("name or service not known") || m.includes("errno 11001") || m.includes("errno 11004") || m.includes("enotfound") || m.includes("econnrefused") || m.includes("econnreset") || m.includes("broken pipe") || m.includes("eof") || m.includes("timed out") || m.includes("connection refused") || m.includes("network is unreachable");
}

// MC-01: Valide qu'un chemin est restreint à OUTPUT_DIR et ses sous-dossiers
function isPathAllowed(requestedPath: string): boolean {
  try {
    const resolved = Deno.realPathSync(requestedPath);
    const allowed = Deno.realPathSync(OUTPUT_DIR);
    // Vérifie que le chemin résolu commence par le répertoire autorisé
    return resolved.toLowerCase().startsWith(allowed.toLowerCase());
  } catch {
    return false;
  }
}

// MC-07: Valide que videoId ne contient que des caractères alphanumériques, '-' et '_'
function isValidVideoId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

// MC-04: Valide une URL d'image YouTube uniquement
function isAllowedThumbUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const allowedHosts = ["img.youtube.com", "i.ytimg.com", "i9.ytimg.com"];
    return allowedHosts.includes(parsed.hostname) && (parsed.protocol === "https:");
  } catch {
    return false;
  }
}

function json(data: unknown, status = 200, reqOrigin?: string | null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...getCorsHeaders(reqOrigin) },
  });
}

const progressMap = new Map<string, number>();
let torEnabled = false;
let torProcess: Deno.ChildProcess | null = null;

const searchCache = new Map<string, { ts: number; data: unknown }>();
const streamCache = new Map<string, { ts: number; url: string }>();

function getSearchCache(key: string) {
  const cached = searchCache.get(key.toLowerCase());
  if (cached && Date.now() - cached.ts < 1000 * 60 * 10) return cached.data;
  return null;
}
function setSearchCache(key: string, data: unknown) {
  // Evict oldest entries instead of clearing entire cache
  if (searchCache.size > 50) {
    let oldestKey = "";
    let oldestTs = Infinity;
    for (const [k, v] of searchCache.entries()) {
      if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    }
    if (oldestKey) searchCache.delete(oldestKey);
  }
  searchCache.set(key.toLowerCase(), { ts: Date.now(), data });
}

function getStreamCache(id: string) {
  const cached = streamCache.get(id);
  if (cached && Date.now() - cached.ts < 1000 * 60 * 20) return cached.url;
  return null;
}
function setStreamCache(id: string, url: string) {
  if (streamCache.size > 100) {
    let oldestKey = "";
    let oldestTs = Infinity;
    for (const [k, v] of streamCache.entries()) {
      if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    }
    if (oldestKey) streamCache.delete(oldestKey);
  }
  streamCache.set(id, { ts: Date.now(), url });
}

function getProxy(): string | undefined {
  return torEnabled ? TOR_PROXY : undefined;
}

async function readStream(stream: ReadableStream<Uint8Array>, label: string) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    if (label === "tor") console.log(`[tor] ${text}`);
  }
}

async function waitForSocksProxy(port = 9050, timeoutMs = 4000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const conn = await Deno.connect({ hostname: "127.0.0.1", port });
      conn.close();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

// ----- Routes -----

Deno.serve({ port: PORT, onListen: () => {} }, async (req) => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) });
  }

  if (url.pathname === "/search" && req.method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    if (!q.trim()) return json({ error: "Paramètre 'q' manquant." }, 400);
    const cached = getSearchCache(q);
    if (cached) return json(cached);
    try {
      const results = await searchAll(q, 15, YT_DLP_PATH, getProxy());
      setSearchCache(q, results);
      return json(results);
    } catch (err) {
      console.error("[search]", err);
      const detail = String(err).split("\n").slice(0, 3).join(" ");
      if (isNetworkError(err))
        return json({ error: "Erreur connexion internet." }, 500);
      const msg = String(err).toLowerCase();
      if (msg.includes("unable to download api page") || msg.includes("http error") || msg.includes("connect") || msg.includes("blocked") || msg.includes("429") || msg.includes("request") || msg.includes("timeout") || msg.includes("econnrefused") || msg.includes("econnreset"))
        return json({ error: `YouTube inaccessible. ${detail}` }, 500);
      return json({ error: `Erreur de recherche. ${detail}` }, 500);
    }
  }

  // MC-04: SSRF protection - Thumbnail proxy restreint aux URLs YouTube autorisées
  if (url.pathname === "/thumb" && req.method === "GET") {
    const target = url.searchParams.get("url");
    if (!target) return json({ error: "Paramètre 'url' manquant." }, 400);
    if (!isAllowedThumbUrl(target)) return json({ error: "URL d'image non autorisée." }, 403);
    try {
      const resp = await fetch(target, {
        headers: { "User-Agent": UA, "Referer": "https://www.youtube.com/" },
      });
      if (!resp.ok) return json({ error: "Image introuvable." }, 404);
      const buf = await resp.arrayBuffer();
      const ct = resp.headers.get("content-type") || "image/jpeg";
      return new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": ct,
          "Cache-Control": "public, max-age=86400",
          ...getCorsHeaders(req.headers.get("origin")),
        },
      });
    } catch {
      return json({ error: "Échec du proxy d'image." }, 502);
    }
  }

  // MC-07: videoId validation for download
  if (url.pathname === "/download" && req.method === "POST") {
    try {
      const { videoId, title, format } = await req.json();
      if (!videoId || !title) return json({ error: "videoId et title requis." }, 400);
      if (!isValidVideoId(videoId)) return json({ error: "videoId invalide." }, 400);
      const statusKey = `${videoId}-${format || "audio"}`;
      progressMap.set(statusKey, 0);
      const result = await downloadAndConvert(videoId, title, OUTPUT_DIR, format || "audio", (progress) => {
        progressMap.set(statusKey, progress);
      }, YT_DLP_PATH, FFMPEG_PATH, getProxy());
      return json(result, result.success ? 200 : 500);
    } catch (err) {
      if (isNetworkError(err)) return json({ error: "Erreur connexion internet." }, 500);
      return json({ error: String(err) }, 500);
    }
  }

  if (url.pathname === "/progress" && req.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "Paramètre 'id' manquant." }, 400);
    return json({ progress: progressMap.get(id) || 0 });
  }

  // MC-01: /open-folder restreint à OUTPUT_DIR
  if (url.pathname === "/open-folder" && req.method === "POST") {
    try {
      const { folder } = await req.json();
      const target = folder === "video"
        ? `${OUTPUT_DIR}\\Video`
        : folder === "all"
          ? OUTPUT_DIR
          : `${OUTPUT_DIR}\\Audio`;
      try { await Deno.mkdir(target, { recursive: true }); } catch {}
      new Deno.Command("explorer", { args: [target] }).output().catch(() => {});
      return json({ ok: true });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  }

  // MC-01: Path traversal protection for list-folder
  if (url.pathname === "/list-folder" && req.method === "GET") {
    const dir = url.searchParams.get("path") ?? "";
    const kind = url.searchParams.get("kind") ?? "audio";
    if (!dir) return json({ error: "Paramètre 'path' manquant." }, 400);
    if (!isPathAllowed(dir)) return json({ error: "Chemin non autorisé." }, 403);
    const audioExt = ["mp3", "m4a", "ogg", "wav", "flac", "aac", "webm"];
    const videoExt = ["mp4", "mkv", "mov", "webm"];
    const wanted = kind === "video" ? videoExt : audioExt;
    try {
      const entries: { name: string; path: string; sizeLabel: string }[] = [];
      const walk = async (base: string) => {
        for await (const entry of Deno.readDir(base)) {
          const full = `${base}\\${entry.name}`;
          if (entry.isDirectory) {
            await walk(full);
          } else if (entry.isFile) {
            const ext = entry.name.toLowerCase().split(".").pop() ?? "";
            if (!wanted.includes(ext)) continue;
            let sizeLabel = "";
            try {
              const st = await Deno.stat(full);
              const mb = st.size / (1024 * 1024);
              sizeLabel = mb >= 1 ? `${mb.toFixed(1)} Mo` : `${(st.size / 1024).toFixed(0)} Ko`;
            } catch {}
            entries.push({ name: entry.name, path: full, sizeLabel });
          }
        }
      };
      await walk(dir);
      entries.sort((a, b) => a.name.localeCompare(b.name));
      return json({ files: entries });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  }

  // MC-01: Path traversal protection for local file serving
  if (url.pathname === "/local" && req.method === "GET") {
    const filePath = url.searchParams.get("path") ?? "";
    if (!filePath) return json({ error: "Paramètre 'path' manquant." }, 400);
    if (!isPathAllowed(filePath)) return json({ error: "Chemin non autorisé." }, 403);
    try {
      const stat = await Deno.stat(filePath);
      if (!stat.isFile) return json({ error: "Fichier introuvable." }, 404);
      const ext = filePath.toLowerCase().split(".").pop() ?? "";
      const allowed = ["mp3", "mp4", "m4a", "webm", "ogg", "wav", "flac", "mkv", "mov", "aac"];
      if (!allowed.includes(ext)) return json({ error: "Type de fichier non supporté." }, 403);

      const mime = ext === "mp3" ? "audio/mpeg"
        : ext === "mp4" || ext === "m4a" || ext === "mov" ? "video/mp4"
        : ext === "webm" || ext === "mkv" ? "video/webm"
        : ext === "ogg" ? "audio/ogg"
        : ext === "wav" ? "audio/wav"
        : ext === "flac" ? "audio/flac"
        : ext === "aac" ? "audio/aac"
        : "application/octet-stream";

      const range = req.headers.get("range");
      const file = await Deno.open(filePath, { read: true });
      if (range) {
        const m = range.match(/bytes=(\d+)-(\d*)/);
        if (m) {
          let start = parseInt(m[1]);
          const end = m[2] ? parseInt(m[2]) : stat.size - 1;
          if (start > end || start >= stat.size) {
            file.close();
            return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
          }
          const chunk = end - start + 1;
          const data = new Uint8Array(chunk);
          await file.seek(start, Deno.SeekMode.Start);
          let bytesRead = 0;
          while (bytesRead < chunk) {
            const n = await file.read(data.subarray(bytesRead));
            if (n === null) break;
            bytesRead += n;
          }
          file.close();
          const body = bytesRead < chunk ? data.subarray(0, bytesRead) : data;
          return new Response(body, {
            status: 206,
            headers: {
              "Content-Type": mime,
              "Content-Range": `bytes ${start}-${start + body.byteLength - 1}/${stat.size}`,
              "Accept-Ranges": "bytes",
              "Content-Length": String(body.byteLength),
              "Cache-Control": "no-store",
              ...getCorsHeaders(req.headers.get("origin")),
            },
          });
        }
      }
      if (stat.size > 100 * 1024 * 1024) {
        file.close();
        return json({ error: "Fichier trop volumineux (>100 Mo). Utilisez les plages HTTP." }, 413);
      }
      const buf = new Uint8Array(stat.size);
      let bytesRead = 0;
      while (bytesRead < stat.size) {
        const n = await file.read(buf.subarray(bytesRead));
        if (n === null) break;
        bytesRead += n;
      }
      file.close();
      const body = (bytesRead > 0 ? buf.subarray(0, bytesRead) : new Uint8Array()) as unknown as BodyInit;
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Accept-Ranges": "bytes",
          "Content-Length": String(bytesRead),
          "Cache-Control": "no-store",
          ...getCorsHeaders(req.headers.get("origin")),
        },
      });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  }

  // MC-07: videoId validation for stream
  if (url.pathname === "/stream" && req.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "Paramètre 'id' manquant." }, 400);
    if (!isValidVideoId(id)) return json({ error: "videoId invalide." }, 400);

    const cachedUrl = getStreamCache(id);
    if (cachedUrl) {
      return new Response(null, {
        status: 302,
        headers: { "Location": cachedUrl, ...getCorsHeaders(req.headers.get("origin")) },
      });
    }

    // 1) Essai youtubei natif (InnerTube) en priorité
    if (!torEnabled) {
      try {
        const info = await youtubeiStream(id);
        if (info?.url) {
          setStreamCache(id, info.url);
          return new Response(null, {
            status: 302,
            headers: { "Location": info.url, ...getCorsHeaders(req.headers.get("origin")) },
          });
        }
      } catch (e) {
        console.warn("[stream] youtubei natif a échoué, repli yt-dlp :", String(e).split("\n")[0]);
      }
    }

    async function tryStream(format: string, timeoutMs: number): Promise<string | null> {
      const args = [
        `https://www.youtube.com/watch?v=${id}`,
        "-f", format, "--get-url", "--no-playlist",
        "--user-agent", UA, "--extractor-args", "youtube:player_client=android",
        ...(torEnabled ? ["--proxy", TOR_PROXY, "--socket-timeout", "60", "--retries", "5"] : []),
      ];
      const proc = new Deno.Command(YT_DLP_PATH, { args, stdout: "piped", stderr: "piped" }).spawn();
      const t = setTimeout(() => { try { proc.kill("SIGTERM"); } catch {} }, timeoutMs);
      const { stdout, success } = await proc.output();
      clearTimeout(t);
      if (!success) return null;
      const url = new TextDecoder().decode(stdout).trim();
      return url || null;
    }

    try {
      const timeout = torEnabled ? 60000 : 20000;
      const directUrl = await tryStream("18", timeout)
        ?? await tryStream("22", torEnabled ? 80000 : 25000)
        ?? await tryStream("best[height<=720][ext=mp4]", torEnabled ? 120000 : 35000);
      if (directUrl) {
        setStreamCache(id, directUrl);
        return new Response(null, {
          status: 302,
          headers: { "Location": directUrl, ...getCorsHeaders(req.headers.get("origin")) },
        });
      }
      return json({ error: "Aucun flux vidéo disponible." }, 502);
    } catch (err) {
      if (isNetworkError(err)) return json({ error: "Erreur connexion internet." }, 502);
      return json({ error: String(err) }, 502);
    }
  }

  // MC-07: videoId validation for stream-tor
  if (url.pathname === "/stream-tor" && req.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "Paramètre 'id' manquant." }, 400);
    if (!isValidVideoId(id)) return json({ error: "videoId invalide." }, 400);

    async function tryStreamTor(format: string, timeoutMs: number): Promise<string | null> {
      const args = [
        `https://www.youtube.com/watch?v=${id}`,
        "-f", format, "--get-url", "--no-playlist",
        "--user-agent", UA, "--extractor-args", "youtube:player_client=android",
        "--proxy", TOR_PROXY, "--socket-timeout", "60", "--retries", "5",
      ];
      const proc = new Deno.Command(YT_DLP_PATH, { args, stdout: "piped", stderr: "piped" }).spawn();
      const t = setTimeout(() => { try { proc.kill("SIGTERM"); } catch {} }, timeoutMs);
      const { stdout, success } = await proc.output();
      clearTimeout(t);
      if (!success) return null;
      const url = new TextDecoder().decode(stdout).trim();
      return url || null;
    }

    try {
      const directUrl = await tryStreamTor("18", 60000)
        ?? await tryStreamTor("22", 80000)
        ?? await tryStreamTor("best[height<=720][ext=mp4]", 120000);
      if (directUrl) {
        return new Response(null, {
          status: 302,
          headers: { "Location": directUrl, ...getCorsHeaders(req.headers.get("origin")) },
        });
      }
      return json({ error: "Aucun flux vidéo disponible via Tor." }, 502);
    } catch (err) {
      if (isNetworkError(err)) return json({ error: "Erreur connexion internet." }, 502);
      return json({ error: String(err) }, 502);
    }
  }

  if (url.pathname === "/proxy" && req.method === "POST") {
    try {
      const { action } = await req.json();
      if (action === "start") {
        if (torEnabled) return json({ enabled: true });
        if (!TOR_PATH) return json({ error: "Tor non configuré." }, 500);
        const args = ["--HTTPTunnelPort", "9080", "--SocksPort", "9050", "--DataDirectory", `${RESOURCE_DIR}\\tor\\data`];
        if (TOR_GEOIP) args.push("--GeoIPFile", TOR_GEOIP);
        if (TOR_GEOIP6) args.push("--GeoIPv6File", TOR_GEOIP6);
        torProcess = new Deno.Command(TOR_PATH, { args, stdout: "piped", stderr: "piped" }).spawn();
        readStream(torProcess.stdout, "tor").catch(() => {});
        readStream(torProcess.stderr, "tor").catch(() => {});
        const proxyReady = await waitForSocksProxy(9050, 4000);
        if (!proxyReady) {
          try { torProcess.kill("SIGTERM"); } catch {} 
          torProcess = null;
          return json({ error: "Tor n'a pas démarré à temps (proxy SOCKS5 introuvable)." }, 500);
        }
        torEnabled = true;
        return json({ enabled: true });
      } else if (action === "stop") {
        torEnabled = false;
        if (torProcess) { try { torProcess.kill("SIGTERM"); } catch {} torProcess = null; }
        return json({ enabled: false });
      }
      return json({ error: "Action inconnue." }, 400);
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  }

  if (url.pathname === "/proxy-status" && req.method === "GET") {
    return json({ enabled: torEnabled, proxy: torEnabled ? TOR_PROXY : null });
  }

  if (url.pathname === "/user-dirs" && req.method === "GET") {
    const home = Deno.env.get("USERPROFILE") || Deno.env.get("HOME") || "";
    return json({
      music: home ? `${home}\\Music` : "",
      videos: home ? `${home}\\Videos` : "",
      downloads: home ? `${home}\\Downloads` : "",
    });
  }

  if (url.pathname === "/scan-folders" && req.method === "GET") {
    const home = Deno.env.get("USERPROFILE") || Deno.env.get("HOME") || "";
    const standard = ["Music", "Videos", "Downloads", "Desktop", "Documents", "Pictures", "Mes Documents", "Ma Musique", "Mes Vidéos", "Mes Images"];
    const roots: string[] = [];
    if (home) {
      for (const d of standard) roots.push(`${home}\\${d}`);
    }
    for (let c = 65; c <= 90; c++) {
      const letter = `${String.fromCharCode(c)}:`;
      if (letter === "C:") continue;
      const ok = await (async () => {
        const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 400));
        const probe = (async () => {
          try {
            for await (const _ of Deno.readDir(letter + "\\")) return true;
            return true;
          } catch {
            return false;
          }
        })();
        return await Promise.race([probe, timeout]).catch(() => false);
      })();
      if (ok) roots.push(`${letter}\\`);
    }
    const DRIVE_DEPTH = 2;
    const exclude = new Set([
      "appdata",
      "application data",
      "local settings",
      "microsoft",
      "windows",
      "program files",
      "program files (x86)",
      "programdata",
      "$recycle.bin",
      "system volume information",
      "msocache",
      "recovery",
      "boot",
      "efi",
      "node_modules",
      ".git",
      ".tauri",
      "cache",
      "temp",
    ]);
    const audioExt = ["mp3", "m4a", "ogg", "wav", "flac", "aac", "webm"];
    const videoExt = ["mp4", "mkv", "mov", "webm", "avi", "m4v"];
    const mediaExt = [...audioExt, ...videoExt];
    const dirs: { path: string; name: string; hasAudio: boolean; hasVideo: boolean; count: number }[] = [];
    const seen = new Map<string, { hasAudio: boolean; hasVideo: boolean; count: number; kids: number }>();
    const MAX = 2000;
    const MAX_DEPTH = 4;

    const readDirSafe = async (base: string): Promise<{ name: string; isDirectory: boolean }[]> => {
      const timeout = new Promise<{ name: string; isDirectory: boolean }[]>((resolve) => setTimeout(() => resolve([]), 1500));
      const run = (async () => {
        const out: { name: string; isDirectory: boolean }[] = [];
        try {
          for await (const entry of Deno.readDir(base)) {
            out.push({ name: entry.name, isDirectory: entry.isDirectory === true });
          }
        } catch {}
        return out;
      })();
      return Promise.race([run, timeout]);
    };

    const walk = async (base: string, depth: number): Promise<boolean> => {
      if (dirs.length >= MAX || depth > MAX_DEPTH) return false;
      let entries: { name: string; isDirectory: boolean }[] = [];
      try {
        entries = await readDirSafe(base);
      } catch {
        return false;
      }
      const info = seen.get(base) ?? { hasAudio: false, hasVideo: false, count: 0, kids: 0 };
      let hasMediaChild = false;
      for (const entry of entries) {
        if (dirs.length >= MAX) break;
        const full = `${base}\\${entry.name}`;
        if (entry.isDirectory) {
          if (exclude.has(entry.name.toLowerCase())) continue;
          const childHasMedia = await walk(full, depth + 1);
          if (childHasMedia) hasMediaChild = true;
        } else if (entry.isDirectory === false) {
          const ext = entry.name.toLowerCase().split(".").pop() ?? "";
          if (mediaExt.includes(ext)) {
            if (audioExt.includes(ext)) info.hasAudio = true;
            if (videoExt.includes(ext)) info.hasVideo = true;
            info.count++;
          }
        }
      }
      info.kids = hasMediaChild ? 1 : 0;
      seen.set(base, info);
      return info.count > 0 || hasMediaChild;
    };

    for (const r of roots) {
      if (dirs.length >= MAX) break;
      const isDrive = /^[A-Z]:\\?$/.test(r);
      await walk(r, isDrive ? DRIVE_DEPTH - 2 : 0);
    }
    for (const [path, info] of seen.entries()) {
      if (dirs.length >= MAX) break;
      if (info.count > 0) {
        dirs.push({ path, name: path.split("\\").pop() || path, hasAudio: info.hasAudio, hasVideo: info.hasVideo, count: info.count });
      }
    }
    dirs.sort((a, b) => a.path.localeCompare(b.path));

    return createScanFoldersResponse(req, dirs);
  }

  if (url.pathname === "/ping" && req.method === "GET") {
    try {
      const v = new Deno.Command(YT_DLP_PATH, { args: ["--version"], stdout: "piped", stderr: "piped" });
      const { stdout, success } = await v.output();
      return json({ ok: true, yt_dlp: success ? new TextDecoder().decode(stdout).trim() : null, tor_enabled: torEnabled, yt_dlp_path: YT_DLP_PATH, resource_dir: RESOURCE_DIR });
    } catch {
      return json({ ok: true, yt_dlp: null, tor_enabled: torEnabled, yt_dlp_path: YT_DLP_PATH, resource_dir: RESOURCE_DIR });
    }
  }

  return json({ error: "Route non trouvée." }, 404);
});

// Nettoyer Tor à l'arrêt
globalThis.addEventListener("unload", () => {
  if (torProcess) {
    try { torProcess.kill("SIGTERM"); } catch {}
  }
});

console.log(`Serveur MédiaCLI lancé sur http://127.0.0.1:${PORT}`);
console.log(`Dossier de téléchargement + conversion MP3 : ${OUTPUT_DIR}`);
console.log(`YT_DLP_PATH: ${YT_DLP_PATH}`);
console.log(`FFMPEG_PATH: ${FFMPEG_PATH}`);
console.log(`RESOURCE_DIR: ${RESOURCE_DIR}`);
console.log(`Tor: ${TOR_PATH}`);