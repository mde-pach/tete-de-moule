// @ts-check
import { defineConfig } from "astro/config";

// Project page on GitHub Pages: https://mde-pach.github.io/tete-de-moule/
const REPOSITORY = "tete-de-moule";

export default defineConfig({
  site: `https://mde-pach.github.io/${REPOSITORY}`,
  base: `/${REPOSITORY}`,
  trailingSlash: "ignore",
  build: { format: "directory" },
  vite: {
    // Verovio ships a large WebAssembly payload: keep it in its own chunk so
    // the landing page stays light and the engraver loads only on demand.
    build: { chunkSizeWarningLimit: 4096 },
    optimizeDeps: { exclude: ["verovio"] },
  },
});
