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
