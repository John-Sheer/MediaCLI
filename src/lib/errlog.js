const IS_ANDROID = /android/i.test(navigator.userAgent || "");
const ERR_URL = "http://127.0.0.1:8787/errlog";
let lastSent = 0;

function post(tag, payload) {
  if (!IS_ANDROID || typeof fetch !== "function") return;
  const now = Date.now();
  if (now - lastSent < 800) return;
  lastSent = now;
  try {
    if ("sendBeacon" in navigator) {
      const blob = new Blob(["1"], { type: "text/plain" });
      navigator.sendBeacon(ERR_URL, blob);
    }
    const q = new URLSearchParams({ tag: tag, b: location.href, m: String(payload).slice(0, 4000) });
    fetch(ERR_URL + "?" + q.toString()).catch(() => {
      try {
        new Image().src = ERR_URL + "?" + q.toString();
      } catch (_) {}
    });
  } catch {}
}

export function reportError(tag, err) {
  post(tag, (err && (err.stack || err.message)) || String(err));
}

export function reportMessage(tag, msg) {
  post(tag, msg);
}