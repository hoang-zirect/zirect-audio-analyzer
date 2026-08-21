import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Root is correct for local/Vercel previews. The GitHub Pages workflow
  // explicitly builds with --base=/zirect-audio-analyzer/.
  base: "/",
});
