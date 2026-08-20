import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const cacheBust = Date.now();

export default defineConfig({
  plugins: [
    react(),
    {
      name: "cache-bust",
      enforce: "post",
      transformIndexHtml(html) {
        return html
          .replace(/(src="\/assets\/index-[^"]+\.js)"/g, `$1?v=${cacheBust}"`)
          .replace(/(href="\/assets\/index-[^"]+\.css)"/g, `$1?v=${cacheBust}"`);
      },
    },
  ],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/target/**"],
    },
  },
});
