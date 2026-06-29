import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    // The Monaco vendor chunk is intentionally large; raise the limit so the
    // (now well-organized) split doesn't re-trigger the >500 kB advisory.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Split static vendors into their own cacheable chunks so `index` shrinks
        // and deps cache independently across deploys. mermaid is intentionally
        // omitted — it is dynamic-imported (AiMarkdown.tsx) and Rollup auto-splits
        // it; naming it here could break that lazy load.
        manualChunks: {
          react: ["react", "react-dom"],
          monaco: ["monaco-editor", "@monaco-editor/react"],
          markdown: [
            "react-markdown",
            "rehype-highlight",
            "rehype-katex",
            "remark-gfm",
            "remark-math",
            "katex",
            "highlight.js"
          ]
        }
      }
    }
  }
});
