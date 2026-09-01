const RECENT_KEY = "mediacli-recent-searches";

export function addRecentSearch(q) {
  try {
    const s = (q || "").trim();
    if (!s) return;
    const list = getRecentSearches();
    const next = [s, ...list.filter((x) => x.toLowerCase() !== s.toLowerCase())].slice(0, 10);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

export function getRecentSearches() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

// Dédoublonne des titres de pistes de playlists en un terme de recherche propre.
// Ex. "Enya - Only Time (Official Video)" -> "Enya" (avant le " - ").
function cleanTitle(raw) {
  let t = (raw || "").toString();
  t = t.replace(/\.(mp3|mp4|m4a|m4v|webm|ogg|flac|mov)$/i, "");
  t = t.replace(/\([^)]*\)/g, " ");
  t = t.replace(/\s{2,}/g, " ").trim();
  if (!t) return "";
  const first = t.split(" - ")[0].trim();
  return (first || t).slice(0, 40);
}

// Profil de goûts de l'utilisateur : recherches récentes + artistes/titres des
// playlists, sans doublons, dans l'ordre (récentes d'abord).
export function getPreferenceTerms(playlists) {
  const terms = [];
  const seen = new Set();
  const push = (t) => {
    const s = (t || "").trim();
    if (!s || s.length < 2 || s.length > 60) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(s);
  };
  getRecentSearches().forEach(push);
  Object.values(playlists || {}).forEach((pl) => {
    (pl.tracks || []).forEach((tr) => push(cleanTitle(tr.title || tr.name)));
  });
  return terms;
}