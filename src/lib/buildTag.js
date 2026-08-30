export function detectBuildTag() {
  try {
    const srcs = Array.from(document.querySelectorAll("script[src]")).map((s) => s.src);
    for (const u of srcs) {
      const m = u.match(/index-([A-Za-z0-9_-]+)\.js$/);
      if (m) return m[1].slice(0, 8);
    }
  } catch {}
  return null;
}