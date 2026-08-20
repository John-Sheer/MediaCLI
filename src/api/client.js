const API_BASE = "http://127.0.0.1:8787";

async function getJson(path, params = {}) {
  const url = new URL(API_BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString());
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function postJson(path, body = {}) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export const api = {
  base: API_BASE,

  async search(query) {
    const { ok, data } = await getJson("/search", { q: query });
    return ok ? data : { error: data.error || "Erreur inconnue du serveur" };
  },

  async streamUrl(id, useTor) {
    return `${API_BASE}/${useTor ? "stream-tor" : "stream"}?id=${encodeURIComponent(id)}`;
  },

  async preloadStream(id) {
    return getJson("/preload-stream", { id });
  },

  async localStreamUrl(path) {
    return `${API_BASE}/local?path=${encodeURIComponent(path)}`;
  },

  async download(videoId, title, format) {
    return postJson("/download", { videoId, title, format });
  },

  async proxy(action) {
    return postJson("/proxy", { action });
  },

  async openFolder(type) {
    return postJson("/open-folder", { folder: type });
  },

  async progress(id) {
    const { ok, data } = await getJson("/progress", { id });
    return ok ? data : null;
  },

  async listFolder(path, kind) {
    const { ok, data } = await getJson("/list-folder", { path, kind });
    return ok ? data : { error: "Impossible de lister le dossier." };
  },

  async scanFolders(onFolder, onDone, onError) {
    try {
      const { ok, data } = await getJson("/scan-folders");
      if (!ok || data.error) {
        onError && onError(data);
        return;
      }
      const folders = data.folders || [];
      folders.forEach(f => onFolder && onFolder(f));
      onDone && onDone({ folders });
    } catch (e) {
      onError && onError({ error: "Impossible de scanner les dossiers." });
    }
  },

  async requestPermissions() {
    return getJson("/request-permissions");
  },
};

export const friendlyError = (msg) => {
  if (/certificate.*verify.*failed|certificate is not yet valid/i.test(msg || "")) {
    return "Erreur de certificat SSL — vérifiez que la date et l'heure de votre PC sont correctes.";
  }
  return msg;
};

export const SERVER_UNREACHABLE =
  "Impossible de contacter le serveur";

// Transforme un message d'erreur (souvent technique) en une info courte :
// { code, message } avec une phrase simple, ex. { code: "RÉSEAU", message: "erreur réseau" }.
export function downloadErrorInfo(msg) {
  const s = (msg || "").toString();
  if (!s || /impossible de contacter|fetch failed|network error|error sending request|connect|timed out|timeout|dns/i.test(s)) {
    return { code: "RÉSEAU", message: "erreur réseau" };
  }
  if (/certificate|ssl|tls/i.test(s)) {
    return { code: "CERT", message: "erreur de certificat" };
  }
  const http = s.match(/HTTP[:\s]*(\d{3})/i);
  if (http) {
    const h = Number(http[1]);
    if (h === 403 || h === 404) return { code: String(h), message: "contenu indisponible" };
    if (h === 429) return { code: "429", message: "trop de requêtes" };
    if (h >= 500) return { code: String(h), message: "erreur serveur" };
    return { code: String(h), message: "erreur de téléchargement" };
  }
  if (/permission|refus|denied|deny/i.test(s)) {
    return { code: "PERM", message: "accès aux fichiers refusé" };
  }
  if (/no space left|disk full|quota exceeded|ENOSPC/i.test(s)) {
    return { code: "STOCK", message: "espace insuffisant" };
  }
  if (/écriture|write error|cannot write/i.test(s)) {
    return { code: "ECR", message: "erreur d'écriture" };
  }
  if (/conversion|encode|decoder|codec|invalid data|mp3/i.test(s)) {
    return { code: "CONV", message: "erreur de conversion" };
  }
  if (/aucun flux|unavailable|not available|introuvable|video id|disponible/i.test(s)) {
    return { code: "VIDEO", message: "vidéo indisponible" };
  }
  if (/invalide|invalid/i.test(s)) {
    return { code: "REQ", message: "requête invalide" };
  }
  if (/téléchargement|download|yt.?dl|fichier temporaire/i.test(s)) {
    return { code: "DL", message: "erreur de téléchargement" };
  }
  return { code: "ERR", message: "erreur inconnue" };
}
