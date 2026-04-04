import { defineConfig } from "vite";
import blogPlugin from "./plugins/vite-plugin-blog.js";

export default defineConfig({
  root: ".",
  plugins: [blogPlugin()],
  build: {
    outDir: "dist",
  },
});
