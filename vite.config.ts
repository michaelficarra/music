import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so built asset URLs resolve under any GitHub Pages project
  // subpath (e.g. https://user.github.io/<repo>/) without hard-coding the repo name.
  base: "./",
  build: {
    outDir: "dist",
  },
});
