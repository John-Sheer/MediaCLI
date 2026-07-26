import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useWindow() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const minimize = () => getCurrentWindow().minimize().catch(() => {});
  const close = () => getCurrentWindow().close().catch(() => {});
  const toggleMaximize = async () => {
    const win = getCurrentWindow();
    const isMax = await win.isMaximized().catch(() => false);
    if (isMax) win.unmaximize().catch(() => {});
    else win.maximize().catch(() => {});
  };

  return { maximized, minimize, close, toggleMaximize };
}
