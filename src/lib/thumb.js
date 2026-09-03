export const THUMB_BASE = "http://127.0.0.1:8787/thumb?url=";

export function thumbUrl(thumb) {
  if (!thumb) return null;
  const url = getThumb(thumb);
  if (!url) return null;
  return THUMB_BASE + encodeURIComponent(url);
}

export function getThumb(thumb) {
  if (!thumb) return null;
  if (typeof thumb === "string") return thumb;
  if (typeof thumb === "object") {
    if (thumb.url) return thumb.url;
    if (Array.isArray(thumb) && thumb.length > 0 && thumb[0]?.url) return thumb[0].url;
  }
  return null;
}
