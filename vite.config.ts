import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Tự khớp với GitHub Pages khi repository có tên zirect-audio-analyzer.
  base: "/zirect-audio-analyzer/",
});
