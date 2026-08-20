import { listen } from "@tauri-apps/api/event";

// Écoute les actions média provenant du système (boutons de la notification
// du BackgroundService sur Android, clavier média / thumbbar sur desktop).
//
// Deux canaux coexistent :
//  - Desktop / Rust : événement Tauri "thumbbar-action" (payload dans e.payload).
//  - Android : le BackgroundService injecte un CustomEvent DOM sur window
//    (l'action est dans e.detail).
export function onThumbbarAction(handler) {
  const domHandler = (e) => {
    const action = typeof e.detail === "string" ? e.detail : e.detail?.action;
    if (action) handler(action);
  };
  window.addEventListener("thumbbar-action", domHandler);
  const unlistenP = listen("thumbbar-action", (e) => {
    const action = e?.payload;
    if (typeof action === "string" && action) handler(action);
  });
  return () => {
    window.removeEventListener("thumbbar-action", domHandler);
    unlistenP.then((fn) => fn()).catch(() => {});
  };
}
