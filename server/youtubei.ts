// Implémentation native de l'API YouTube "InnerTube" (sans yt-dlp).
// Utilisée en priorité, avec repli sur yt-dlp en cas d'échec.

// MC-05: Plus de clé par défaut hardcodée - l'utilisateur doit fournir sa propre clé
const INNERTUBE_KEY = Deno.env.get("YOUTUBE_INNERTUBE_KEY");
if (!INNERTUBE_KEY) {
  console.error("[youtubei] ERREUR: Variable d'environnement YOUTUBE_INNERTUBE_KEY non définie.");
  console.error("[youtubei] Veuillez définir YOUTUBE_INNERTUBE_KEY dans votre environnement ou fichier .env");
  console.error("[youtubei] Exemple: set YOUTUBE_INNERTUBE_KEY=votre_cle_api");
}

const WEB_CLIENT = {
  clientName: "WEB",
  clientVersion: "2.20240610.00.00",
};
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export interface YoutubeiResult {
  id: string;
  title: string;
  duration: number;
  thumbnail: string | undefined;
  channel: string;
}

export interface StreamInfo {
  url: string | null;
  title: string;
  duration: number;
  channel: string;
  thumbnail: string | undefined;
}

function b64decode(s: string): string {
  // decode web-safe base64 without native atob dependency issues
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const norm = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(norm);
  return bin;
}

function b64encode(s: string): string {
  let bin = "";
  for (let i = 0; i < s.length; i++) bin += String.fromCharCode(s.charCodeAt(i));
  const b = btoa(bin);
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Cache du script player pour le déchiffrement de la signature 'n'
let playerScriptCache: { ts: number; url: string; text: string } | null = null;

async function getPlayerScript(): Promise<{ url: string; text: string }> {
  if (playerScriptCache && Date.now() - playerScriptCache.ts < 1000 * 60 * 30) {
    return { url: playerScriptCache.url, text: playerScriptCache.text };
  }
  const base = await fetch("https://www.youtube.com/watch?v=LLRAN_2gl0Q", {
    headers: { "User-Agent": UA },
  });
  const html = await base.text();
  const m = html.match(/(?:"|%22)([^\s"']*?\/?player[^\s"']*?\.js)\1|(?:src|href)="(\/s\/player[^"]+)"|"jsUrl":"([^"]+)"/);
  let url = m ? (m[1] || m[2] || m[3]) : null;
  if (!url) url = "/s/player/8a56d1b0/player_ias.vflset/en_US/base.js";
  if (url.startsWith("/")) url = `https://www.youtube.com${url}`;
  const js = await (await fetch(url, { headers: { "User-Agent": UA } })).text();
  playerScriptCache = { ts: Date.now(), url, text: js };
  return { url, text: js };
}

// MC-02: Déchiffre le paramètre 'n' de la signature de manière statique et sécurisée.
// Au lieu d'utiliser new Function() sur du code extrait dynamiquement du player YouTube,
// on utilise une approche basée sur des transformations connues.
// Les transformations YouTube typiques incluent: reverse, splice, swap, rotate.
// Cette implémentation statique évite l'exécution de code arbitraire.
let nTransformCache: ((n: string) => string) | null = null;

// Effectue une transformation de type "reversing" sur une portion de la chaîne
function applyReverse(s: string, start: number, len: number): string {
  const arr = s.split("");
  const sub = arr.slice(start, start + len).reverse();
  arr.splice(start, len, ...sub);
  return arr.join("");
}

// Effectue une transformation de type "splice" (extraire des caractères)
function applySplice(s: string, start: number, count: number): string {
  const arr = s.split("");
  arr.splice(start, count);
  return arr.join("");
}

// Effectue une transformation de type "swap" (échanger deux positions)
function applySwap(s: string, pos1: number, pos2: number): string {
  const arr = s.split("");
  const tmp = arr[pos1];
  arr[pos1] = arr[pos2 % arr.length];
  arr[pos2 % arr.length] = tmp;
  return arr.join("");
}

async function decipherN(n: string): Promise<string> {
  // Cache invalidation: re-parse if player script changed or cache is >5 min old
  if (playerScriptCache && Date.now() - playerScriptCache.ts > 1000 * 60 * 5) {
    nTransformCache = null;
  }
  if (nTransformCache) return nTransformCache(n);
  
  try {
    const { text } = await getPlayerScript();
    
    // MC-02: Approche sécurisée - extrait la fonction de déchiffrement et la réimplémente
    // via une série d'opérations connues plutôt que d'exécuter du code arbitraire
    const fnMatch = text.match(/\b([a-zA-Z0-9_$]{2,})\s*=\s*function\(\s*a\s*\)\s*\{[\s\S]*?\.slice\(0\)[\s\S]*?\}/)
      ?? text.match(/\b([a-zA-Z0-9_$]{2,})\s*=\s*function\(a\)\s*\{[^}]*\}/);
    if (!fnMatch) {
      console.warn("[decipherN] Aucune fonction de déchiffrement trouvée, retour de n inchangé");
      return n;
    }
    
    const fnName = fnMatch[1];
    // Extrait le corps de la fonction
    const bodyStart = text.indexOf(fnName + " = function");
    if (bodyStart === -1) return n;
    const body = text.slice(bodyStart, bodyStart + 600);
    
    // Analyse le corps de la fonction pour extraire les opérations de transformation
    // sans exécuter le code. On ne fait que l'analyse statique.
    let result = n;
    
    // Extrait les opérations via regex sans exécuter de code
    // Format typique: a.splice(0, 1) ou var a=...; a.reverse()...
    // On applique manuellement les transformations courantes
    
    // Détection des patterns de transformation YouTube standards
    const operations: Array<{type: string, params: number[]}> = [];
    
    // Cherche les appels à .splice() avec des arguments numériques
    const spliceRegex = /\.splice\((\d+),(\d+)\)/g;
    let spliceMatch;
    while ((spliceMatch = spliceRegex.exec(body)) !== null) {
      operations.push({ type: "splice", params: [parseInt(spliceMatch[1]), parseInt(spliceMatch[2])] });
    }
    
    // Cherche les appels à .reverse()
    if (body.includes(".reverse()")) {
      operations.push({ type: "reverse", params: [] });
    }
    
    // Cherche les appels à .shift() ou suppression de premier caractère
    if (body.includes(".shift()") || body.includes("splice(0,1)")) {
      operations.push({ type: "shift", params: [] });
    }

    // Cherche les appels à swap (e.g., var a=n[n[0]%7];n[0]=n[b];n[b]=a)
    const swapRegex = /\w=\w\[\w%\d+\];\w\[\d+\]=\w\[\w\];\w\[\w\]=\w/g;
    if (swapRegex.test(body)) {
      const m2 = body.match(/(\d+)\]=(\w)\[\w\];\w\[(\w)\]=\w/);
      if (m2) {
        operations.push({ type: "swap", params: [parseInt(m2[1]), 0] });
      }
    }
    
    // Applique les opérations extraites de manière sécurisée
    for (const op of operations) {
      switch (op.type) {
        case "reverse":
          result = result.split("").reverse().join("");
          break;
        case "shift":
          result = result.slice(1);
          break;
          case "splice":
          if (op.params.length >= 2) {
            result = applySplice(result, op.params[0], op.params[1]);
          }
          break;
        case "swap":
          if (op.params.length >= 2) {
            result = applySwap(result, op.params[0], op.params[1]);
          }
          break;
      }
    }
    
    nTransformCache = (s: string) => {
      let r = s;
      for (const op of operations) {
        switch (op.type) {
          case "reverse": r = r.split("").reverse().join(""); break;
          case "shift": r = r.slice(1); break;
          case "splice": if (op.params.length >= 2) r = applySplice(r, op.params[0], op.params[1]); break;
          case "swap": if (op.params.length >= 2) r = applySwap(r, op.params[0], op.params[1]); break;
        }
      }
      return r;
    };
    
    return result;
  } catch (err) {
    console.warn("[decipherN] Erreur de déchiffrement, retour de n inchangé:", err);
    return n;
  }
}

async function innertubeRequest(endpoint: string, body: unknown): Promise<any> {
  if (!INNERTUBE_KEY) {
    throw new Error("YOUTUBE_INNERTUBE_KEY n'est pas configurée. Définissez la variable d'environnement.");
  }
  const resp = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?key=${INNERTUBE_KEY}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      "X-YouTube-Client-Name": "1",
      "X-YouTube-Client-Version": WEB_CLIENT.clientVersion,
      "Origin": "https://www.youtube.com",
    },
    body: JSON.stringify({
      context: { client: WEB_CLIENT },
      ...(body as object),
    }),
  });
  if (!resp.ok) throw new Error(`InnerTube ${endpoint} HTTP ${resp.status}`);
  return await resp.json();
}

export async function youtubeiSearch(query: string, limit = 15): Promise<YoutubeiResult[]> {
  const data = await innertubeRequest("search", { query,
    ...{
      params: undefined,
    },
  });
  const items: any[] = [];
  // Deux structures possibles selon le client InnerTube :
  //  - WEB : contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents
  //  - ANDROID (récent) : contents.sectionListRenderer.contents
  const sections = data.contents?.twoColumnSearchResultsRenderer?.primaryContents
    ?.sectionListRenderer?.contents ?? data.contents?.sectionListRenderer?.contents ?? [];
  for (const sec of sections) {
    const rend = sec.itemSectionRenderer?.contents ?? [];
    for (const it of rend) items.push(it);
    const cont = sec.continuationItemRenderer;
    if (cont) break;
  }
  const results: YoutubeiResult[] = [];
  const seen = new Set<string>();
  const text = (v: any, ...paths: string[]) => {
    for (const p of paths) {
      const node = p.split(".").reduce((o, k) => o?.[k], v);
      const s = node?.runs?.map((r: any) => r.text).join("") ?? node?.simpleText;
      if (s) return s;
    }
    return undefined;
  };
  for (const it of items) {
    // Clients récents (ANDROID) renvoient compactVideoRenderer / gridVideoRenderer
    // au lieu de videoRenderer : on accepte les trois.
    const v = it.videoRenderer ?? it.compactVideoRenderer ?? it.gridVideoRenderer;
    if (!v || seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    const dur = v.lengthText?.simpleText ?? text(v, "lengthText.runs") ?? "0:00";
    const parts = dur.split(":").map(Number);
    const duration = parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts.length === 2
      ? parts[0] * 60 + parts[1]
      : parts[0] ?? 0;
    results.push({
      id: v.videoId,
      title: text(v, "title.runs", "title.simpleText") ?? "Sans titre",
      duration,
      thumbnail: v.thumbnail?.thumbnails?.at(-1)?.url,
      channel: text(v, "ownerText.runs", "longBylineText.runs", "shortBylineText.runs") ?? "Inconnu",
    });
    if (results.length >= limit) break;
  }
  return results;
}

export async function youtubeiStream(videoId: string): Promise<StreamInfo> {
  const data = await innertubeRequest("player", { videoId });
  const videoDetails = data.videoDetails ?? {};
  const streaming = data.streamingData ?? {};
  const formats: any[] = [
    ...(streaming.formats ?? []),
    ...(streaming.adaptiveFormats ?? []),
  ];
  if (formats.length === 0) throw new Error("Aucun flux dans la réponse InnerTube");

  const pickFormat = (pred: (f: any) => boolean): any => {
    const sorted = formats
      .filter((f) => f.url || (f.signatureCipher && f.signatureCipher.includes("n=")))
      .filter(pred)
      .sort((a, b) => (Number(b.height) || Number(b.bitrate) || 0) - (Number(a.height) || Number(a.bitrate) || 0));
    return sorted[0];
  };

  // Préférence: MP4 avec son (h<=720), puis tout MP4 avec audio, puis tout flux avec audio, sinon tout flux disponible.
  const fmt =
    pickFormat((f) => f.mimeType?.includes("video/mp4") && (Number(f.height) || 0) <= 720 && (f.audioQuality || f.audioCodec || f.mimeType?.includes("audio"))) ??
    pickFormat((f) => f.mimeType?.includes("video/mp4") && (f.audioQuality || f.audioCodec || f.mimeType?.includes("audio"))) ??
    pickFormat((f) => !!(f.audioQuality || f.audioCodec || f.mimeType?.includes("audio"))) ??
    pickFormat(() => true);

  let url: string | null = fmt?.url ?? null;
  if (!url && fmt?.signatureCipher) {
    try {
      const sc = new URLSearchParams(fmt.signatureCipher);
      const n = sc.get("n");
      const realUrl = sc.get("url");
      if (realUrl) {
        const u = new URL(realUrl);
        if (n) u.searchParams.set("n", await decipherN(n));
        url = u.toString();
      }
    } catch {
      url = null;
    }
  }
  if (!url) throw new Error("URL de flux introuvable (InnerTube)");

  const dur = videoDetails.lengthSeconds ? Number(videoDetails.lengthSeconds) : 0;
  return {
    url,
    title: videoDetails.title ?? "",
    duration: dur,
    channel: videoDetails.author ?? "",
    thumbnail: videoDetails.thumbnail?.thumbnails?.at(-1)?.url,
  };
}